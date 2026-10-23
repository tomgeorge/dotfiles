import assert from "node:assert/strict";
import { test } from "node:test";
import { testStyle } from "../run-panel/fixture.ts";
import { input, type Command, type PanelInput } from "../run-panel/input.ts";
import { render as renderPanel } from "../run-panel/render.ts";
import { initialState } from "../run-panel/state.ts";
import { JobStore } from "./jobs.ts";
import type { Progress } from "./runner.ts";
import { subagentSource } from "./source.ts";

// Subagent jobs as a source: what each tab says about a job, which tab a job opens on, and
// when cancel applies. Layout, keys, and scrolling are the presenter's (run-panel tests).

const plain = testStyle(false);
const toned = testStyle(true);
// Markdown is the Style's job; tagging it shows which text went through it.
const md = { ...plain, markdown: (text: string, width: number) => plain.wrap(`md:${text}`, width) };
const NOW = 64_000;

const progress = (over: Partial<Progress> = {}): Progress => ({
  toolCalls: 0, activity: "starting", phase: "starting", usage: { input: 0, output: 0, cost: 0 }, ...over,
});

function storeWith(n: number, started = 0) {
  const store = new JobStore();
  for (let id = 1; id <= n; id++) {
    store.add({ id, provider: "anthropic", model: `model-${id}`, task: `task ${id}`, cwd: "/tmp", tools: ["read", "grep"], started, progress: progress() });
  }
  return store;
}

function panel(store: JobStore, cancel: (id: number) => boolean = () => true) {
  const log: string[] = [];
  const source = subagentSource(store, (id) => { log.push(`cancel ${id}`); return cancel(id); }, () => NOW);
  const state = initialState(source);
  const render = (width = 120, height = 30, s: typeof plain = md) => renderPanel(source, state, NOW, width, height, s, { frame: 0 }).lines;
  const screen = (width?: number, height?: number, s?: typeof plain) => render(width, height, s).join("\n");
  const press = (...inputs: (PanelInput | string)[]): Command<unknown> | undefined => {
    let command: Command<any> | undefined;
    for (const i of inputs) command = input(state, source, typeof i === "string" ? { char: i } : i);
    return command;
  };
  return { source, state, render, screen, press, log };
}

const ran = (command: Command<any> | undefined) => (command?.type === "run" ? `${command.action.id} ${command.item.id}` : command?.type);

test("opens on the newest running job, on Live; a finished job opens on Result", () => {
  const store = storeWith(3);
  store.finish(3, "ok", { result: "done" });
  const p = panel(store);
  assert.equal(p.state.selected, "2");
  assert.equal(p.state.view, "live");
  p.press("j");
  p.render();
  assert.equal(p.state.view, "result");
  assert.match(p.screen(), /md:done/);
});

test("a selected job moves from Live to Result when it finishes, unless a tab was picked", () => {
  const store = storeWith(2);
  const p = panel(store);
  assert.match(p.screen(), /\[4 Live\]/);
  store.finish(2, "ok", { result: "**found it**" });
  assert.match(p.screen(), /\[5 Result\][^]*md:\*\*found it\*\*/);
  // Picking a tab sticks.
  p.press("k", "2");
  store.finish(1, "ok", { result: "other" });
  assert.match(p.screen(), /\[2 Task\][^]*md:task 1/);
});

test("rows show glyph, id, model, elapsed time, tool calls, cost, and what the job is doing", () => {
  const store = storeWith(3);
  store.update(1, progress({ toolCalls: 3, activity: "grep setStatus", phase: "tool", usage: { input: 1, output: 1, cost: 0.11 } }));
  store.update(2, progress({ phase: "thinking" }));
  store.finish(3, "cancelled", { error: "Subagent cancelled" }, 5_000);
  const lines = panel(store).render(140);
  const row = (id: number) => lines.find((l) => l.startsWith("│") && l.includes(`#${id} `))!;
  assert.match(row(1), /⠋ #1 model-1 +1m04s 3 tools \$0\.11 grep setStatus/);
  assert.match(row(2), /⠋ #2 model-2 +1m04s 0 tools +\$0\.00 thinking…/);
  assert.match(row(3), / ⊘ #3 model-3 +5s 0 tools +\$0\.00 cancelled/);
  // The status beside the list title counts jobs, running jobs, and spend.
  assert.match(lines.join("\n"), /Subagents 3 · 2 running · \$0\.11/);
});

test("the filter matches id, model, status, and task", () => {
  const store = storeWith(3);
  store.finish(2, "error", { error: "boom" });
  const p = panel(store);
  const shown = (q: string) => {
    p.state.query = q;
    return p.render().filter((l) => /[▸ ]\S #\d/.test(l)).map((l) => /#(\d)/.exec(l)![1]);
  };
  assert.deepEqual(shown("model-3"), ["3"]);
  assert.deepEqual(shown("error"), ["2"]);
  assert.deepEqual(shown("task 1"), ["1"]);
  assert.deepEqual(shown("anthropic/model-2"), ["2"]);
});

test("the overview shows cwd, git, tools, spend, calls, and status", () => {
  const store = storeWith(1);
  store.setGit(1, { branch: "main", worktree: true });
  store.update(1, progress({ toolCalls: 2, activity: "read x", phase: "tool", usage: { input: 41_000, output: 3_000, cost: 0.28 } }));
  const p = panel(store);
  p.press("1");
  const text = p.screen();
  for (const want of [/cwd +\/tmp/, /git +main \(worktree\)/, /tools +read grep/, /spend +\$0\.28 · 41k in \/ 3k out/,
    /calls +2 · read x/, /status +running · 1m04s/]) assert.match(text, want);
  store.setGit(1, null);
  assert.match(p.screen(), /git +not a git checkout/);
});

test("the task tab shows the whole task as markdown", () => {
  const store = new JobStore();
  const task = Array.from({ length: 40 }, (_, i) => `step ${i}`).join("\n");
  store.add({ id: 1, provider: "p", model: "m", task, cwd: "/tmp", tools: ["read"], started: 0, progress: progress() });
  const p = panel(store);
  p.press("2");
  assert.match(p.screen(), /md:step 0/);
  p.press({ key: "enter" }, "G");
  assert.match(p.screen(), /step 39/);
});

test("live streams the child's thinking, text, and tool calls with results", () => {
  const store = storeWith(1);
  const p = panel(store);
  assert.match(p.screen(), /Waiting for the first event/);
  store.event(1, { type: "message_start", message: { role: "assistant" } });
  store.event(1, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "pondering auth" } });
  store.event(1, { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/auth.ts" } });
  store.event(1, { type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: { content: [{ type: "text", text: "export const secret" }] } });
  const text = p.screen();
  for (const want of [/streaming from the subagent/, /pondering auth/, /read/, /src\/auth\.ts/, /export const secret/]) assert.match(text, want);
});

test("activity lists one line per tool call with elapsed time and follows new calls", () => {
  const store = storeWith(1);
  const p = panel(store);
  p.press("3");
  assert.match(p.screen(), /No tool calls yet/);
  for (let i = 1; i <= 40; i++) store.update(1, progress({ toolCalls: i, activity: `read file${i}`, phase: "tool" }), 60_000 + i * 1000);
  const text = p.screen(120, 20);
  assert.match(text, /01:40 read file40/);
  assert.doesNotMatch(text, /read file1\b/);
});

test("the result says it's still running, then shows errors in the error tone above any output", () => {
  const store = storeWith(2);
  const p = panel(store);
  p.press("5");
  assert.match(p.screen(), /Still running/);
  store.finish(2, "error", { error: "child exited 1", result: "partial **notes**" });
  const text = p.screen(120, 30, { ...md, fg: toned.fg, width: toned.width, truncate: toned.truncate });
  assert.match(text, /<error>child exited 1<\/error>[^]*md:partial \*\*notes\*\*/);
  store.finish(1, "ok", {});
  p.press("k");
  assert.match(p.screen(), /No output/);
});

test("x asks before cancelling a running job; anything but y keeps it", () => {
  const store = storeWith(2);
  store.finish(1, "ok", {});
  const p = panel(store);
  assert.equal(ran(p.press("x")), "none");
  assert.match(p.screen(), /Cancel #2 model-2\? y to cancel/);
  assert.equal(ran(p.press("n")), "none");
  assert.equal(ran(p.press("x", "y")), "cancel 2");

  p.press("k", "x");
  assert.equal(p.state.confirm, undefined);
  assert.match(p.state.flash!.text, /#1 is not running/);
});

test("cancel aborts the job and says whether there was one to stop", async () => {
  const run = async (stopped: boolean) => {
    const p = panel(storeWith(1), () => stopped);
    const result = await p.source.actions[0].run(p.source.items()[0].value, { flash() {} });
    return { result, log: p.log };
  };
  assert.deepEqual(await run(true), { result: { flash: "Cancelling #1", tone: "warning" }, log: ["cancel 1"] });
  assert.deepEqual((await run(false)).result, { flash: "#1 is not running", tone: "warning" });
});

test("the source re-renders on store changes and stops listening when unsubscribed", () => {
  const store = storeWith(1);
  const source = subagentSource(store, () => true);
  let calls = 0;
  const unsubscribe = source.subscribe!(() => calls++);
  store.update(1, progress({ phase: "thinking" }));
  unsubscribe();
  store.finish(1, "ok", {});
  assert.equal(calls, 1);
});
