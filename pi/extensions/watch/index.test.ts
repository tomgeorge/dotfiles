import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createEventBus, fakePi } from "../test-support/fake-pi.ts";
import { LEADER_CONTRIBUTE, LEADER_DISCOVER } from "../vi-mode/leaderContract.ts";

// After fake-pi registers its module stubs.
const { default: watchExtension } = await import("./index.ts");

// No UI, so no widget, popup or terminal notifications; always idle, so reports start a turn.
// Shuts down in t.after, so a failed assertion can't leave a watch keeping the process alive.
function setup(t: TestContext) {
  const f = fakePi();
  watchExtension(f.pi);
  const ctx = f.ctx(mkdtempSync(join(tmpdir(), "watch-wiring-")), {
    hasUI: false, mode: "print", isIdle: () => true, hasPendingMessages: () => false,
  });
  const text = async (name: string, params: unknown) =>
    ((await f.tool(name, params, ctx)) as { content: { text: string }[] }).content[0].text;
  t.after(() => f.emit("session_shutdown", {}, ctx));
  return { f, ctx, text };
}

test("a watch met on its first check reports in the tool result", async (t) => {
  const { f, text } = setup(t);
  const [head, command, exit, ...rest] = (await text("watch", { command: "echo ok", description: "d" })).split("\n");
  assert.deepEqual([head, command], ["Watch #1 condition met: d", "Command: echo ok"]);
  // Usually 0s, but a slow bash start under load can round up.
  assert.match(exit, /^Exit 0 on check 1, \d+s after starting\.$/);
  assert.deepEqual(rest, [
    "",
    "Command output (untrusted):",
    "ok",
    "",
    "(Reported on the first check; watch #1 has ended.)",
  ]);
  assert.deepEqual(f.sent, []);
});

test("a pending watch returns its first check, and lists and stops by id", async (t) => {
  const { text } = setup(t);
  const [started, ...rest] = (await text("watch", { command: "echo pending; exit 1", description: "CI" })).split("\n");
  // 1h, or 59m-something once a slow first check ate into it.
  assert.match(started, /^Started watch: #1 CI · until success · wake · every 30s · (1h|59m\d+s) left · 1 check · last exit 1 · \$ echo pending; exit 1$/);
  assert.deepEqual(rest, [
    "First check: exit 1; not met yet; still watching.",
    "Command output (untrusted):",
    "pending",
    "If this output shows the check itself is broken (auth, typo, wrong path), stop it with watch_stop and start a corrected one.",
    "You'll get a message when it reports. Stop it with watch_stop.",
  ]);
  assert.match(await text("watch_list", {}), /^#1 CI · until success · wake · every 30s · \S+ left · 1 check · last exit 1 · \$ echo pending; exit 1$/);
  assert.equal(await text("watch_stop", { id: 1 }), "Stopped watch #1");
  assert.equal(await text("watch_list", {}), "No active watches");
});

test("a missing command stops with an error", async (t) => {
  const { text } = setup(t);
  const out = await text("watch", { command: "no_such_cmd_xyz", description: "d" });
  assert.match(out, /^Watch #1 stopped on an error: d\nexit 127: .*no_such_cmd_xyz.*\nCommand: no_such_cmd_xyz\nLast exit 127 after 1 check\.\n\nCommand output \(untrusted\):\n.*\n\n\(Reported on the first check; watch #1 has ended\.\)$/);
});

test("timeouts report through the watch's delivery; loops only notify", async (t) => {
  const { f, ctx } = setup(t);
  // The check outlives the deadline, so the report doesn't depend on how many
  // checks fit before it.
  await f.command("watch", "--timeout 1s --steer sleep 2", ctx);
  await f.command("loop", "--timeout 1s check slack", ctx);
  // Loop iterations are "watch-loop" messages; one may fire at the deadline, depending on timer jitter.
  const reports = () => f.sent.filter((s) => s.message.customType === "watch");
  for (let i = 0; i < 100 && reports().length < 2; i++) await sleep(50);
  const sent = reports().map((s) => ({ content: s.message.content, options: s.options }));
  sent.sort((a, b) => a.content.localeCompare(b.content));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { content: "Loop #2 timed out after 1s: check slack", options: undefined });
  assert.deepEqual(sent[1].options, { triggerTurn: true });
  // Normally one check; a second can start if the runner's kill (libuv clock)
  // beats the Registry's Date.now deadline by a hair.
  assert.match(sent[1].content, /^Watch #1 timed out after 1s without its condition being met: sleep 2\nCommand: sleep 2\nLast check was still running and was killed after \d+ checks?\.\n\n\(no output\)$/);
});

test("contributes SPC w l on load and again on leader:discover, with no shortcut", () => {
  const events = createEventBus();
  const seen: unknown[] = [];
  events.on(LEADER_CONTRIBUTE, (data) => seen.push(data));
  const f = fakePi({ events });
  watchExtension(f.pi);
  const expected = {
    source: "watch",
    bindings: [{
      id: "watch.list",
      path: [{ key: "w", label: "watches" }, { key: "l", label: "list" }],
      command: { name: "watches" },
    }],
  };
  assert.deepEqual(seen, [expected]);
  events.emit(LEADER_DISCOVER, undefined);
  assert.deepEqual(seen, [expected, expected]);
  assert.ok(f.commands.has("watches"), "the bound command exists");
  assert.equal(f.shortcuts.size, 0);
});
