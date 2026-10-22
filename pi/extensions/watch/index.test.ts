import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fakePi } from "../test-support/fake-pi.ts";

// After fake-pi registers its module stubs.
const { default: watchExtension } = await import("./index.ts");

// No UI, so no widget, popup or terminal notifications; always idle, so reports start a turn.
function setup() {
  const f = fakePi();
  watchExtension(f.pi);
  const ctx = f.ctx(mkdtempSync(join(tmpdir(), "watch-wiring-")), {
    hasUI: false, mode: "print", isIdle: () => true, hasPendingMessages: () => false,
  });
  const text = async (name: string, params: unknown) =>
    ((await f.tool(name, params, ctx)) as { content: { text: string }[] }).content[0].text;
  return { f, ctx, text, stop: () => f.emit("session_shutdown", {}, ctx) };
}

test("a watch met on its first check reports in the tool result", async () => {
  const { f, text, stop } = setup();
  assert.equal(await text("watch", { command: "echo ok", description: "d" }), [
    "Watch #1 condition met: d",
    "Command: echo ok",
    "Exit 0 on check 1, 0s after starting.",
    "",
    "Command output (untrusted):",
    "ok",
    "",
    "(Reported on the first check; watch #1 has ended.)",
  ].join("\n"));
  assert.deepEqual(f.sent, []);
  await stop();
});

test("a pending watch returns its first check, and lists and stops by id", async () => {
  const { text, stop } = setup();
  assert.equal(await text("watch", { command: "echo pending; exit 1", description: "CI" }), [
    "Started watch: #1 CI · until success · wake · every 30s · 1h left · 1 check · last exit 1 · $ echo pending; exit 1",
    "First check: exit 1; not met yet; still watching.",
    "Command output (untrusted):",
    "pending",
    "If this output shows the check itself is broken (auth, typo, wrong path), stop it with watch_stop and start a corrected one.",
    "You'll get a message when it reports. Stop it with watch_stop.",
  ].join("\n"));
  assert.match(await text("watch_list", {}), /^#1 CI · until success · wake · every 30s · \S+ left · 1 check · last exit 1 · \$ echo pending; exit 1$/);
  assert.equal(await text("watch_stop", { id: 1 }), "Stopped watch #1");
  assert.equal(await text("watch_list", {}), "No active watches");
  await stop();
});

test("a missing command stops with an error", async () => {
  const { text, stop } = setup();
  const out = await text("watch", { command: "no_such_cmd_xyz", description: "d" });
  assert.match(out, /^Watch #1 stopped on an error: d\nexit 127: .*no_such_cmd_xyz.*\nCommand: no_such_cmd_xyz\nLast exit 127 after 1 check\.\n\nCommand output \(untrusted\):\n.*\n\n\(Reported on the first check; watch #1 has ended\.\)$/);
  await stop();
});

test("timeouts report through the watch's delivery; loops only notify", async () => {
  const { f, ctx, stop } = setup();
  await f.command("watch", "--timeout 1s --steer exit 1", ctx);
  await f.command("loop", "--timeout 1s check slack", ctx);
  await sleep(1_300);
  // The loop may also fire one iteration at the deadline, depending on timer jitter.
  const sent = f.sent.filter((s) => s.message.customType === "watch").map((s) => ({ content: s.message.content, options: s.options }));
  assert.deepEqual(sent.sort((a, b) => a.content.localeCompare(b.content)), [
    { content: "Loop #2 timed out after 1s: check slack", options: undefined },
    {
      content: "Watch #1 timed out after 1s without its condition being met: exit 1\nCommand: exit 1\nLast exit 1 after 1 check.\n\n(no output)",
      options: { triggerTurn: true },
    },
  ]);
  await stop();
});
