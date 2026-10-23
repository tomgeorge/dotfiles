import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JobStore, LOG_LIMIT, readGitInfo } from "./jobs.ts";
import { progressLine, summary, tokens, widgetLines, WIDGET_ROWS, type Style } from "./panel.ts";
import type { Progress } from "./runner.ts";

// Plain text: one column per code point, no colors. Tones are dropped so
// assertions read like the screen.
const plain: Style = {
  fg: (_tone, text) => text,
  bold: (text) => text,
  selected: (text) => text,
  width: (text) => [...text].length,
  truncate(text, width, pad) {
    const chars = [...text];
    const cut = chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join("") + (width > 0 ? "…" : "") : text;
    return pad ? cut + " ".repeat(Math.max(0, width - [...cut].length)) : cut;
  },
  wrap(text, width) {
    return text.split("\n").flatMap((line) => {
      const out: string[] = [];
      for (let i = 0; i < Math.max(1, line.length); i += width) out.push(line.slice(i, i + width));
      return out;
    });
  },
};

const progress = (over: Partial<Progress> = {}): Progress => ({
  toolCalls: 0, activity: "starting", phase: "starting", usage: { input: 0, output: 0, cost: 0 }, ...over,
});

function storeWith(n: number, started = 0) {
  const store = new JobStore();
  for (let id = 1; id <= n; id++) {
    store.add({ id, provider: "anthropic", model: `model-${id}`, task: `task ${id}`, cwd: "/tmp", tools: ["read"], started, progress: progress() });
  }
  return store;
}

test("formats token counts compactly", () => {
  assert.deepEqual([999, 41_200, 1_250_000].map(tokens), ["999", "41k", "1.3M"]);
});

test("progress line shows live elapsed time and current activity", () => {
  const store = storeWith(1, 1000);
  store.update(1, progress({ toolCalls: 2, activity: "grep foo", phase: "tool", usage: { input: 0, output: 0, cost: 0.05 } }));
  assert.equal(progressLine(store.get(1)!, 13_000), "Subagent #1 model-1 \u00b7 12s \u00b7 2 tool calls \u00b7 $0.05 \u00b7 grep foo");
  store.finish(1, "ok", {}, 5000);
  // Unlike summary, the tool row keeps counting until the tool call returns.
  assert.equal(progressLine(store.get(1)!, 13_000), "Subagent #1 model-1 \u00b7 12s \u00b7 2 tool calls \u00b7 $0.05 \u00b7 done");
});

test("summary reports spend from the finished job", () => {
  const store = storeWith(1);
  store.update(1, progress({ toolCalls: 18, activity: "read x", phase: "tool", usage: { input: 41_200, output: 3_000, cost: 0.412 } }));
  store.finish(1, "ok", { result: "done" }, 134_000);
  // `now` is ignored once the job has ended.
  assert.equal(summary(store.get(1)!, 999_000), "Subagent #1 model-1 \u00b7 2m14s \u00b7 18 tool calls \u00b7 $0.41 \u00b7 41k in / 3k out");
});

test("store logs one line per tool call and caps the log", () => {
  const store = storeWith(1);
  store.update(1, progress({ phase: "thinking" }), 500);
  store.update(1, progress({ toolCalls: 1, activity: "grep foo", phase: "tool" }), 1500);
  store.update(1, progress({ toolCalls: 1, activity: "grep foo", phase: "writing" }), 2000);
  assert.deepEqual(store.get(1)!.log, [{ at: 1500, text: "grep foo" }]);
  for (let i = 2; i <= LOG_LIMIT + 10; i++) store.update(1, progress({ toolCalls: i, activity: `read ${i}` }));
  assert.equal(store.get(1)!.log.length, LOG_LIMIT);
  assert.equal(store.get(1)!.log.at(-1)!.text, `read ${LOG_LIMIT + 10}`);
});

test("store keeps finished jobs and notifies subscribers", () => {
  const store = storeWith(2);
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.finish(1, "ok", { result: "answer" }, 9000);
  unsubscribe();
  store.finish(2, "cancelled", { error: "Subagent cancelled" });
  assert.equal(calls, 1);
  assert.deepEqual(store.list().map((job) => job.status), ["ok", "cancelled"]);
  assert.equal(store.running().length, 0);
  assert.equal(store.get(1)!.ended, 9000);
});

test("widget lists running jobs in aligned columns and hides when idle", () => {
  const store = storeWith(2);
  store.update(1, progress({ toolCalls: 3, activity: "grep setStatus", phase: "tool", usage: { input: 1, output: 1, cost: 0.11 } }));
  store.update(2, progress({ phase: "thinking" }));
  const lines = widgetLines(store.list(), 12_000, 100, plain, { frame: 0, hint: "/subagents" });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^─ Subagents · 2 running · \$0\.11 ─+ \/subagents ─$/);
  assert.equal([...lines[0]].length, 100);
  assert.match(lines[1], /#1 {2}model-1 {2}\s+12s {4}3 tools {2} \$0\.11 {2}grep setStatus$/);
  assert.match(lines[2], /thinking…$/);
  // Columns line up across rows.
  assert.equal(lines[1].indexOf("tools"), lines[2].indexOf("tools"));
  store.finish(1, "ok", {});
  store.finish(2, "ok", {});
  assert.deepEqual(widgetLines(store.list(), 0, 100, plain, { frame: 0, hint: "" }), []);
});

test("widget caps rows with a +N more line", () => {
  const lines = widgetLines(storeWith(8).list(), 0, 120, plain, { frame: 0, hint: "/subagents" });
  assert.equal(lines.length, 1 + WIDGET_ROWS);
  assert.match(lines.at(-1)!, /\+4 more · \/subagents to view all/);
});

test("widget lines never exceed the width", () => {
  const store = storeWith(3);
  store.update(1, progress({ toolCalls: 1, phase: "tool", activity: "read ".repeat(40) }));
  for (const width of [20, 40, 80]) {
    for (const line of widgetLines(store.list(), 0, width, plain, { frame: 0, hint: "/subagents" })) {
      assert.ok([...line].length <= width, `${width}: ${line}`);
    }
  }
});

test("readGitInfo reports branch, worktree, and non-repos", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "subagent-git-")));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  assert.equal(await readGitInfo(dir), null);
  git("init", "-q", "-b", "trunk");
  git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init");
  assert.deepEqual(await readGitInfo(dir), { branch: "trunk", worktree: false });
  const linked = join(dir, "linked");
  git("worktree", "add", "-q", "-b", "feature", linked);
  assert.deepEqual(await readGitInfo(linked), { branch: "feature", worktree: true });
});
