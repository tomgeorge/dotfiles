"""Routing backends. Each ranks a task against named routes and returns scores that sum to 1.

`routes` maps route name -> short description. Every backend adds an implicit `other` route so
an off-topic task has somewhere to go besides the least-bad engineering route.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import torch

OTHER = "other"
OTHER_DESCRIPTION = "Not a software engineering task: writing, chat, or general knowledge"


@dataclass
class Ranking:
    ranked: list[tuple[str, float]]  # best first
    latency_ms: float
    extra: dict = field(default_factory=dict)


def default_device() -> str:
    return "mps" if torch.backends.mps.is_available() else "cpu"


class LayaBackend:
    """Laya `choice` question; the distribution over options is the ranking."""

    INSTRUCTIONS = "Which kind of software engineering work does this task ask for?"

    REPO = "convaiinnovations/laya"

    def __init__(self, checkpoint: str = "english", device: str | None = None, revision: str | None = None):
        from laya import Router

        self.checkpoint = checkpoint
        self.name = f"laya-{checkpoint}"
        self.device = device or default_device()
        self.model_id = f"{self.REPO}:{checkpoint}"
        self.revision = revision
        self.router = Router(device=self.device, max_loaded=1, revision=revision)
        self.router.preload([checkpoint])

    def rank(self, task: str, routes: dict[str, str], greedy: bool = False) -> Ranking:
        del greedy  # Laya has no generative answer to compare against
        criteria = dict(routes)
        criteria[OTHER] = OTHER_DESCRIPTION
        questions = {"route": {"type": "choice", "instructions": self.INSTRUCTIONS, "criteria": criteria}}
        start = time.perf_counter()
        result = self.router.predict(task, questions, model=self.checkpoint)
        latency = (time.perf_counter() - start) * 1000
        probs = result["answers"]["route"]["probabilities"]
        usage = result.get("usage", {})
        return Ranking(
            ranked=sorted(probs.items(), key=lambda kv: kv[1], reverse=True),
            latency_ms=latency,
            extra={"truncated": bool(usage.get("truncated")),
                   "state_tokens_dropped": usage.get("state_tokens_dropped", 0)},
        )


# Upstream's prompt, verbatim: the model card says it works best with this exact format.
ARCH_TASK_INSTRUCTION = """
You are a helpful assistant designed to find the best suited route.
You are provided with route description within <routes></routes> XML tags:
<routes>

{routes}

</routes>

<conversation>

{conversation}

</conversation>
"""

ARCH_FORMAT_PROMPT = """
Your task is to decide which route is best suit with user intent on the conversation in <conversation></conversation> XML tags.  Follow the instruction:
1. If the latest intent from user is irrelevant or user intent is full filled, response with other route {"route": "other"}.
2. You must analyze the route descriptions and find the best match route for user latest intent. 
3. You only response the name of the route that best matches the user's request, use the exact name in the <routes></routes>.

Based on your analysis, provide your response in the following JSON formats if you decide to match any route:
{"route": "route_name"} 
"""


class ArchRouterBackend:
    """Arch-Router generates one route name. To rank, score every candidate completion by its
    total log-probability and softmax across routes. The greedy answer is kept too, to check
    that the scoring agrees with what the model would generate.

    The prompt asks for JSON but the model usually answers with a Python dict literal
    (`{'route': 'debug'}`), so both spellings are scored and combined per route.
    """

    SPELLINGS = ('{{"route": "{}"}}', "{{'route': '{}'}}")

    MODEL = "katanemo/Arch-Router-1.5B"

    def __init__(self, device: str | None = None, revision: str | None = None):
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.name = "arch-router"
        self.device = device or default_device()
        self.model_id = self.MODEL
        self.revision = revision
        self.tok = AutoTokenizer.from_pretrained(self.MODEL, revision=revision)
        self.model = AutoModelForCausalLM.from_pretrained(
            self.MODEL, revision=revision, dtype=torch.bfloat16
        ).to(self.device)
        self.model.eval()

    def _prompt_ids(self, task: str, routes: dict[str, str]) -> list[int]:
        route_config = [{"name": n, "description": d} for n, d in routes.items()]
        conversation = [{"role": "user", "content": task}]
        content = ARCH_TASK_INSTRUCTION.format(
            routes=json.dumps(route_config), conversation=json.dumps(conversation)
        ) + ARCH_FORMAT_PROMPT
        ids = self.tok.apply_chat_template(
            [{"role": "user", "content": content}], add_generation_prompt=True, tokenize=True
        )
        # transformers 5 returns a BatchEncoding here; 4.x returned a list.
        return list(ids["input_ids"] if hasattr(ids, "keys") else ids)

    @torch.no_grad()
    def rank(self, task: str, routes: dict[str, str], greedy: bool = False) -> Ranking:
        """`greedy` also generates the model's own answer; it roughly doubles latency."""
        start = time.perf_counter()
        prompt = self._prompt_ids(task, routes)
        names = list(routes) + [OTHER]
        # `other` is not listed in <routes>: upstream's prompt names it as the fallback instead.
        conts = [self.tok.encode(s.format(n), add_special_tokens=False) for n in names for s in self.SPELLINGS]

        # Encode the shared prompt once, then score every continuation from its KV cache.
        prompt_t = torch.tensor([prompt], device=self.device)
        out = self.model(prompt_t, use_cache=True)
        first_logp = torch.log_softmax(out.logits[0, -1].float(), dim=-1)

        width = max(len(c) for c in conts)
        pad = self.tok.pad_token_id if self.tok.pad_token_id is not None else 0
        batch = torch.full((len(conts), width), pad, device=self.device)
        for i, c in enumerate(conts):
            batch[i, : len(c)] = torch.tensor(c, device=self.device)
        cache = out.past_key_values
        cache.batch_repeat_interleave(len(conts))
        attn = torch.ones((len(conts), len(prompt) + width), device=self.device, dtype=torch.long)
        cont_out = self.model(batch, past_key_values=cache, attention_mask=attn)
        logp = torch.log_softmax(cont_out.logits.float(), dim=-1)

        scores = []
        for i, c in enumerate(conts):
            total = first_logp[c[0]].item()
            for j in range(1, len(c)):
                total += logp[i, j - 1, c[j]].item()
            scores.append(total)
        per_route = torch.tensor(scores).view(len(names), len(self.SPELLINGS)).logsumexp(dim=1)
        probs = torch.softmax(per_route, dim=0).tolist()

        extra = {"prompt_tokens": len(prompt)}
        if greedy:
            greedy_ids = self.model.generate(prompt_t, max_new_tokens=16, do_sample=False)[0, len(prompt):]
            extra["greedy"] = self.tok.decode(greedy_ids, skip_special_tokens=True).strip()
        latency = (time.perf_counter() - start) * 1000
        return Ranking(
            ranked=sorted(zip(names, probs), key=lambda kv: kv[1], reverse=True),
            latency_ms=latency,
            extra=extra,
        )
