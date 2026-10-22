# goal

Keep a session working until a shell check passes. This is a small take on Codex's
Goals: the objective is a completion contract, and **the check, not the model,
decides "done."**

```text
/goal make the test suite pass --check npm test
/goal p95 under 120 ms on the checkout bench --check ./bench.sh --max-p95 120 --max 10
/goal            # status
/goal pause | resume | clear
```

After every agent run settles, the harness runs the check in the session's cwd
(10 minute timeout):

- **exit 0:** the goal is complete.
- **fails:** it sends the check's output tail as a follow-up message and continues, up to
  `--max` times (default 20; a trailing `--max N` is always this option).
- **the run made no tool calls:** parked, because it wasn't making progress.
- **you interrupted:** paused.
- **blocked on you:** the model calls `goal_park` with what it needs; `/goal resume`
  continues it.

While a goal is active, a system prompt section carries the objective, the check,
and the budget, and forbids weakening the check. The goal state is stored in the session,
so `/resume` and forks keep their own goal. `goal_park` is declared only while a goal is active.

Checks: `node --test pi/extensions/goal/*.test.ts`
