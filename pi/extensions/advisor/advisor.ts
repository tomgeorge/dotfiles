import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Message } from "@earendil-works/pi-ai";

export interface AdvisorConfig { provider: string; model: string }

export function readConfig(path: string): AdvisorConfig | undefined {
  if (!existsSync(path)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const invalid = new Error(`${path} must contain {"provider": "...", "model": "..."}`);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid;
  if (Object.keys(raw).length === 0) return undefined; // "off"
  if (!("provider" in raw) || !("model" in raw)
    || typeof raw.provider !== "string" || typeof raw.model !== "string" || !raw.provider || !raw.model) {
    throw invalid;
  }
  return { provider: raw.provider, model: raw.model };
}

/** "provider/model", or "off" when no advisor is set: the form /advisor takes and shows. */
export function modelRef(config: AdvisorConfig | undefined): string {
  return config ? `${config.provider}/${config.model}` : "off";
}

/** Split at the first "/", since model ids can themselves contain slashes. */
export function parseModelRef(ref: string): AdvisorConfig {
  const cut = ref.indexOf("/");
  return { provider: ref.slice(0, cut), model: ref.slice(cut + 1) };
}

export function writeConfig(path: string, config: AdvisorConfig | undefined): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config ?? {}, null, 2)}\n`);
}

/**
 * Keep the start (the task and early decisions) and the recent end of a long
 * transcript, dropping the middle. Sharing the whole context is Cognition's
 * 80/20 for a "smart friend"; this only bounds the extreme case.
 */
export function trimTranscript(text: string, max: number, head = Math.floor(max * 0.1)): string {
  if (text.length <= max) return text;
  const tail = max - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${dropped} characters of the middle of the conversation omitted ...]\n\n${text.slice(-tail)}`;
}

export function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
}

/**
 * Pi's serializeConversation is built for compaction summaries and cuts every tool
 * result to 2,000 characters. The advisor needs what the agent saw, so keep it whole;
 * trimTranscript bounds the total.
 */
export function serializeTranscript(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = textOf(msg.content);
      if (text) parts.push(`[User]: ${text}`);
    } else if (msg.role === "assistant") {
      const thinking = msg.content.flatMap((c) => (c.type === "thinking" ? [c.thinking] : []));
      const text = msg.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
      const calls = msg.content.flatMap((c) => (c.type === "toolCall"
        ? [`${c.name}(${Object.entries(c.arguments).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`]
        : []));
      if (thinking.length) parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      if (text.length) parts.push(`[Assistant]: ${text.join("\n")}`);
      if (calls.length) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    } else if (msg.role === "toolResult") {
      const text = textOf(msg.content);
      if (text) parts.push(`[Tool result${msg.isError ? " (error)" : ""}]: ${text}`);
    }
  }
  return parts.join("\n\n");
}

export function advisorPrompt(transcript: string, question: string): string {
  return `## Conversation so far\n\n${transcript}\n\n## The agent's question\n\n${question}`;
}

// Cognition: tell the advisor to send the agent to look rather than theorize, and to
// look beyond the narrow question ("over-scoped smart friend").
export const ADVISOR_SYSTEM_PROMPT = `You are a senior engineer advising a coding agent mid-task. You see its full conversation: the user's requests, its reasoning, every tool call and result.

Answer its question, then add anything important it didn't ask about: a wrong assumption, a simpler approach, a risk, a step it skipped, or a reason it's not actually done.

Rules:
- Be decisive and specific. Name files, functions, and commands. Recommend one path, not a menu.
- Disagree with the agent or its plan when the evidence warrants it.
- If answering depends on something not in the transcript, such as a file it never read, say exactly what to read or run, and to ask you again. Don't guess.
- Respect the user's instructions in the transcript, even where you'd choose differently.
- Keep it short: a few paragraphs or bullets. No preamble.`;

