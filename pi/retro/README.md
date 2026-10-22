# retro

Mine recent Pi and Claude Code transcripts for friction, so `/retro`
(`pi/prompts/retro.md`) can propose fixes. This is a feedback flywheel that
**only proposes changes**; you apply them.

```sh
node pi/retro/collect.ts --days 7 --max 15
```

It reports:
- recurring errors, grouped by command shape and ignoring `cd …&&` hops;
- your corrections;
- identical tool calls repeated 3 or more times;
- interrupts;
- every failed tool call.

Each item has a `file:line` reference into the transcript. Signals are leads; the
prompt verifies each one against the real files before proposing anything.

Checks: `node --test pi/retro/*.test.ts`
