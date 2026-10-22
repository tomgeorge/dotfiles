import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JobStore, LOG_LIMIT, readGitInfo } from "./jobs.ts";
import {
  duration, initialPopup, money, popupKey, popupLines, tokens, widgetLines, WIDGET_ROWS, type Style,
} from "./panel.ts";
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
  markdown(text, width) {
    return plain.wrap(`md:${text}`, width);
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

test("formats durations, money, and tokens compactly", () => {
  assert.deepEqual([0, 12_400, 64_000, 3_720_000].map(duration), ["0s", "12s", "1m04s", "1h02m"]);
  assert.deepEqual([0, 0.004, 0.281].map(money), ["$0.00", "<$0.01", "$0.28"]);
  assert.deepEqual([999, 41_200, 1_250_000].map(tokens), ["999", "41k", "1.3M"]);
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
  const lines = widgetLines(store.list(), 12_000, 100, plain, { frame: 0, hint: "ctrl+shift+s" });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^─ Subagents · 2 running · \$0\.11 ─+ ctrl\+shift\+s ─$/);
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
  const lines = widgetLines(storeWith(8).list(), 0, 120, plain, { frame: 0, hint: "ctrl+shift+s" });
  assert.equal(lines.length, 1 + WIDGET_ROWS);
  assert.match(lines.at(-1)!, /\+4 more · ctrl\+shift\+s to view all/);
});

test("widget lines never exceed the width", () => {
  const store = storeWith(3);
  store.update(1, progress({ toolCalls: 1, phase: "tool", activity: "read ".repeat(40) }));
  for (const width of [20, 40, 80]) {
    for (const line of widgetLines(store.list(), 0, width, plain, { frame: 0, hint: "ctrl+shift+s" })) {
      assert.ok([...line].length <= width, `${width}: ${line}`);
    }
  }
});

test("popup selects the newest running job and navigates the list", () => {
  const store = storeWith(3);
  store.finish(3, "ok", { result: "done" });
  const jobs = store.list();
  const state = initialPopup(jobs);
  assert.equal(state.selected, 2);
  assert.equal(state.scroll, "end"); // running → activity tail
  popupKey(state, jobs, "down", 5);
  assert.equal(state.selected, 3);
  assert.equal(state.scroll, 0); // finished → result from the top
  popupKey(state, jobs, "down", 5);
  assert.equal(state.selected, 3);
  popupKey(state, jobs, "top", 5);
  assert.equal(state.selected, 1);
  assert.deepEqual(popupKey(state, jobs, "back", 5), { type: "close" });
});

test("popup cancel targets only running jobs", () => {
  const store = storeWith(2);
  store.finish(2, "ok", {});
  const jobs = store.list();
  const state = initialPopup(jobs);
  assert.deepEqual(popupKey(state, jobs, "cancel", 5), { type: "cancel", id: 1 });
  popupKey(state, jobs, "down", 5);
  assert.deepEqual(popupKey(state, jobs, "cancel", 5), { type: "none" });
});

test("popup detail focus scrolls the body; escape returns to the list", () => {
  const store = storeWith(1);
  store.finish(1, "ok", { result: Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") });
  const jobs = store.list();
  const state = initialPopup(jobs);
  popupKey(state, jobs, "enter", 5);
  assert.equal(state.focus, "detail");
  popupKey(state, jobs, "pageDown", 5);
  popupKey(state, jobs, "down", 5);
  assert.equal(state.scroll, 6);
  popupKey(state, jobs, "bottom", 5);
  const { lines } = popupLines(jobs, state, 0, 100, 20, plain, 0);
  assert.ok(lines.some((line) => line.includes("line 49")));
  assert.ok(!lines.some((line) => line.includes("line 0 ")));
  popupKey(state, jobs, "back", 5);
  assert.equal(state.focus, "list");
});

test("popup toggles between activity and result", () => {
  const store = storeWith(1);
  store.update(1, progress({ toolCalls: 1, activity: "grep needle", phase: "tool" }), 61_000);
  store.finish(1, "ok", { result: "the answer" });
  const jobs = store.list();
  const state = initialPopup(jobs);
  const screen = () => popupLines(jobs, state, 0, 100, 20, plain, 0).lines.join("\n");
  assert.match(screen(), /the answer/);
  popupKey(state, jobs, "toggle", 5);
  assert.match(screen(), /01:01 grep needle/);
  assert.doesNotMatch(screen(), /the answer/);
});

test("popup shows the full task as markdown and scrolls it", () => {
  const store = storeWith(0);
  const task = Array.from({ length: 40 }, (_, i) => `step ${i}`).join("\n");
  store.add({ id: 1, provider: "p", model: "m", task, cwd: "/tmp", tools: ["read"], started: 0, progress: progress() });
  store.finish(1, "ok", { result: "**done**" }, 0);
  const jobs = store.list();
  const state = initialPopup(jobs);
  const screen = () => popupLines(jobs, state, 0, 100, 20, plain, 0).lines.join("\n");
  assert.match(screen(), /md:\*\*done\*\*/);
  assert.match(screen(), /… 37 more lines · ctrl\+o to expand/);
  popupKey(state, jobs, "task", 5);
  assert.equal(state.view, "task");
  assert.match(screen(), /─ task ─+ a: activity · t: back ─/);
  assert.match(screen(), /md:step 0/);
  popupKey(state, jobs, "enter", 5);
  popupKey(state, jobs, "bottom", 5);
  assert.match(screen(), /step 39/);
  assert.doesNotMatch(screen(), /md:step 0/);
  popupKey(state, jobs, "task", 5);
  assert.equal(state.view, undefined);
  assert.equal(state.scroll, 0);
  assert.match(screen(), /md:\*\*done\*\*/);
});

test("popup expands the task prompt with ctrl+o", () => {
  const store = storeWith(0);
  const task = Array.from({ length: 40 }, (_, i) => `step ${i}`).join("\n");
  store.add({ id: 1, provider: "p", model: "m", task, cwd: "/tmp", tools: ["read"], started: 0, progress: progress() });
  store.finish(1, "ok", { result: "**done**" }, 0);
  const jobs = store.list();
  const state = initialPopup(jobs);
  const screen = () => popupLines(jobs, state, 0, 100, 20, plain, 0).lines.join("\n");
  // Initially, the task is truncated with a hint to expand
  assert.match(screen(), /… 37 more lines · ctrl\+o to expand/);
  assert.doesNotMatch(screen(), /step 39/);
  // Press ctrl+o to expand
  popupKey(state, jobs, "expand", 5);
  assert.equal(state.expandTask, true);
  // Now all lines should be visible (no truncation hint)
  assert.doesNotMatch(screen(), /… 37 more lines · ctrl\+o to expand/);
  // Since the task is expanded, we should see more task lines
  const screenText = screen();
  // Count lines containing "step" (task content lines)
  const taskLineCount = (screenText.match(/step \d+/g) || []).length;
  assert.ok(taskLineCount > 3, `Expected more than 3 task lines, got ${taskLineCount}`);
  // A prompt taller than the pane must still be readable to its end by scrolling,
  // and the result must remain reachable below it.
  popupKey(state, jobs, "enter", 5);
  popupKey(state, jobs, "bottom", 5);
  assert.match(screen(), /step 39/);
  assert.match(screen(), /md:\*\*done\*\*/);
  popupKey(state, jobs, "back", 5);
  // Toggle expand off
  popupKey(state, jobs, "expand", 5);
  assert.equal(state.expandTask, false);
  // Back to truncated
  assert.match(screen(), /… 37 more lines · ctrl\+o to expand/);
});

test("popup renders exactly width × height with details", () => {
  const store = storeWith(12);
  store.setGit(1, { branch: "main", worktree: true });
  store.update(1, progress({ toolCalls: 2, activity: "read x", phase: "tool", usage: { input: 41_000, output: 3_000, cost: 0.28 } }));
  const jobs = store.list();
  const state = initialPopup(jobs);
  state.selected = 1;
  for (const [width, height] of [[100, 20], [60, 8], [200, 50]]) {
    const { lines, page } = popupLines(jobs, state, 64_000, width, height, plain, 0);
    assert.equal(lines.length, height);
    for (const line of lines.slice(0, -1)) assert.equal([...line].length, width, line);
    assert.ok(page >= 1);
  }
  const screen = popupLines(jobs, state, 64_000, 100, 20, plain, 0).lines.join("\n");
  assert.match(screen, /git {4}main \(worktree\)/);
  assert.match(screen, /spend {2}\$0\.28 · 41k in \/ 3k out/);
  assert.match(screen, /▸. #1 model-1/);
});

test("popup list scrolls to keep the selection visible", () => {
  const jobs = storeWith(30).list();
  const state = initialPopup(jobs);
  assert.equal(state.selected, 30);
  const screen = popupLines(jobs, state, 0, 100, 12, plain, 0).lines.join("\n");
  assert.match(screen, /#30/);
  assert.doesNotMatch(screen, /#1 /);
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
