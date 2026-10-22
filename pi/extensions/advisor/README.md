# advisor

Lets the agent consult a second model that sees **the whole conversation**: user
requests, reasoning, every tool call and result. This follows Claude Code's
`/advisor` and Cognition's "smart friend". Cognition found that sharing the full
context was the best simple option, and that pairing models from different vendors
paid off most, so pick a model from another vendor than your main one.

```text
/advisor                         # pick a model, or "off"
/advisor openai-codex/gpt-6.1-sol
```

The choice is saved in `~/.pi/agent/advisor.json`. The `advisor` tool is declared
only when one is set. The agent is told to use it before committing to an approach
on hard tasks, after an error recurs twice, and before declaring a large task done.

The advisor is told to be decisive, to look past the narrow question, and to send
the agent to read a file instead of guessing. Very long transcripts keep the first
10% and the most recent part (600k characters in total).

Checks: `node --test pi/extensions/advisor/*.test.ts`
