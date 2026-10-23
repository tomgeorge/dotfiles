import assert from "node:assert/strict";
import { test } from "node:test";
import { wallClock } from "../run-panel/format.ts";
import { testStyle } from "../run-panel/fixture.ts";
import { input, type Command, type PanelInput } from "../run-panel/input.ts";
import { render as renderPanel } from "../run-panel/render.ts";
import { initialState } from "../run-panel/state.ts";
import { watchSource } from "./source.ts";
import { WatchStore } from "./store.ts";
import type { RunResult, Watch } from "./watcher.ts";

// Watches and loops as a source: what each tab says about a watch, the list row, and when stop
// applies. Layout, keys, and scrolling are the presenter's (run-panel tests).

const plain = testStyle(false);
const NOW = 5_000;

const result = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, killed: false });

function watch(id: number, over: Partial<Watch> = {}): Watch {
  return {
    kind: "command", text: `check ${id}`, description: `watch ${id}`, cwd: "/tmp", intervalMs: 30_000,
    timeoutMs: 3_600_000, until: "success", deliver: "wake", id, startedAt: 0, deadline: 3_600_000,
    checks: 0, fires: 0, state: "waiting", ...over,
  };
}

/** A registry holding the active watches by id, as the real one does. */
function fakeRegistry(watches: Watch[]) {
  const active = new Map(watches.map((w) => [w.id, w]));
  const stopped: number[] = [];
  return {
    active, stopped,
    get: (id: number) => active.get(id),
    stop: (id: number) => { stopped.push(id); return active.delete(id); },
  };
}

function panel(store: WatchStore, registry = fakeRegistry(store.active().map((r) => r.watch))) {
  const source = watchSource(store, registry, () => NOW);
  const state = initialState(source);
  const render = (width = 120, height = 30, s = plain) => renderPanel(source, state, NOW, width, height, s, { frame: 0 }).lines;
  const screen = (width?: number, height?: number, s?: typeof plain) => render(width, height, s).join("\n");
  const press = (...inputs: (PanelInput | string)[]): Command<unknown> | undefined => {
    let command: Command<any> | undefined;
    for (const i of inputs) command = input(state, source, typeof i === "string" ? { char: i } : i);
    return command;
  };
  return { source, state, render, screen, press, registry };
}

function storeWith(n: number) {
  const store = new WatchStore();
  const watches = Array.from({ length: n }, (_, i) => watch(i + 1));
  for (const w of watches) store.add(w, 0);
  return { store, watches };
}

const ran = (command: Command<any> | undefined) => (command?.type === "run" ? `${command.action.id} ${command.item.id}` : command?.type);

test("opens on the newest active watch; items are keyed by record, not the reused watch id", () => {
  const store = new WatchStore();
  const first = watch(1);
  store.add(first, 0);
  store.end(first, "met", undefined, 1_000);
  const reused = watch(1);
  store.add(reused, 2_000);
  store.add(watch(2), 2_000);
  const ended = watch(3);
  store.add(ended, 2_000);
  store.end(ended, "stopped");
  const p = panel(store);
  const ids = p.source.items().map((i) => i.id);
  assert.deepEqual(ids, store.list().map((r) => String(r.key)));
  assert.equal(new Set(ids).size, 4);
  assert.equal(p.state.selected, String(store.list()[2].key));
});

/** Run the command's action as pi.ts would. */
function run(command: Command<any> | undefined) {
  assert.equal(command?.type, "run");
  const c = command as Extract<Command<any>, { type: "run" }>;
  return c.action.run(c.item.value, { flash() {} });
}

test("x stops an active watch without asking, and only while the id is still this watch", () => {
  const { store } = storeWith(2);
  const p = panel(store);
  // Selected: #2, the newest active one.
  const command = p.press("x");
  assert.equal(ran(command), `stop ${store.list()[1].key}`);
  assert.equal(p.state.confirm, undefined, "no confirmation");
  assert.deepEqual(run(command), { flash: "Stopped #2", tone: "warning" });
  assert.deepEqual(p.registry.stopped, [2]);

  // #1 ended and its id went to a new watch: stopping the old record must leave the new one.
  p.registry.active.set(1, watch(1));
  const stale = p.press("k", "x");
  assert.deepEqual(run(stale), { flash: "#1 has ended", tone: "warning" });
  assert.deepEqual(p.registry.stopped, [2]);
});

test("x is unavailable on an ended watch", () => {
  const { store, watches } = storeWith(2);
  store.end(watches[1], "met");
  const p = panel(store);
  p.press("j");
  assert.equal(p.state.selected, String(store.list()[1].key));
  assert.equal(ran(p.press("x")), "none");
  assert.match(p.screen(), /#2 has ended/);
  assert.deepEqual(p.registry.stopped, []);
});

test("rows show glyph, id, kind, description, count, last exit, and status", () => {
  const store = new WatchStore();
  const ci = watch(1, { description: "CI for PR 123", checks: 3, last: result(8), nextAt: 30_000 });
  const loop = watch(2, { kind: "prompt", description: "slack incidents", fires: 2, state: "due" });
  const busy = watch(3, { description: "deploy", state: "running" });
  const met = watch(4, { description: "build", checks: 1, last: result(0) });
  for (const w of [ci, loop, busy, met]) store.add(w, 0);
  store.end(met, "met");
  const p = panel(store);
  const lines = p.render(140);
  const row = (id: number) => lines.find((l) => l.startsWith("│") && l.includes(`#${id} `))!;
  assert.match(row(1), /◷ #1 watch CI for PR 123 +3 checks exit 8 next in 25s/);
  assert.match(row(2), /● #2 loop +slack incidents +2 runs +due when idle/);
  assert.match(row(3), /⠋ #3 watch deploy +0 checks +checking…/);
  assert.match(row(4), /✓ #4 watch build +1 check exit 0 condition met/);
  const toned = p.render(140, 30, testStyle(true)).join("\n");
  assert.match(toned, /<warning>●<\/warning>/);
  assert.match(toned, /<warning>due when idle<\/warning>/);
  assert.match(toned, /<success>exit 0<\/success>/);
  assert.match(lines.join("\n"), /Watches +⠋ 4 · 2 watching · 1 loop/, "busy while a check runs");
  assert.equal(p.source.busy!(), true);
  busy.state = "waiting";
  assert.equal(p.source.busy!(), false);
});

test("Overview shows kind and mode, schedule, counts, status, and the whole command", () => {
  const store = new WatchStore();
  const long = Array.from({ length: 6 }, (_, i) => `step${i}`).join("\n");
  store.add(watch(1, { text: long, checks: 2, fires: 1, last: result(1), nextAt: 30_000 }), 0);
  const screen = panel(store).screen();
  assert.match(screen, /kind +command · until success · deliver wake/);
  assert.match(screen, /cwd +\/tmp/);
  assert.match(screen, /every +30s · timeout 1h · 59m55s left/);
  assert.match(screen, /count +2 checks · fired 1 · last exit 1/);
  assert.match(screen, /status +next in 25s/);
  for (let i = 0; i < 6; i++) assert.match(screen, new RegExp(`step${i}`), "the whole command, not 3 lines");
});

test("Log shows timestamped entries and collapses repeated checks into ×N", () => {
  const { store, watches: [w] } = storeWith(1);
  w.checks = 1;
  w.last = result(1, "", "gh: not logged in");
  store.sync(w, 61_000);
  w.checks = 2;
  w.last = result(1, "", "gh: not logged in");
  store.sync(w, 91_000);
  const p = panel(store);
  p.press("2");
  const screen = p.screen();
  assert.match(screen, /\[2 Log\]/);
  assert.ok(screen.includes(`${wallClock(91_000)} check · exit 1 · gh: not logged in ×2`), screen);
  assert.ok(screen.includes(`${wallClock(0)} started`));
});

test("Output shows the last check, a loop's prompt, and an error first", () => {
  const { store, watches: [w] } = storeWith(1);
  const p = panel(store);
  p.press("3");
  assert.match(p.screen(), /No check has finished yet/);
  w.last = result(0, "build\tpass\nlint\tpass");
  store.sync(w);
  const screen = p.screen();
  assert.match(screen, /Last check exit 0/);
  assert.match(screen, /build {3}pass/, "tabs expanded");

  const loops = new WatchStore();
  const loop = watch(1, { kind: "prompt", text: "check #incidents" });
  loops.add(loop, 0);
  loops.end(loop, "error", "boom");
  const q = panel(loops);
  q.press("3");
  const lines = q.render();
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/│ boom/) >= 0 && at(/check #incidents/) > at(/│ boom/), lines.join("\n"));
  assert.match(lines.join("\n"), /error: boom/, "the status says how it ended");
});

test("subscribe re-renders on store changes until unsubscribed", () => {
  const { store, watches: [w] } = storeWith(1);
  const p = panel(store);
  let calls = 0;
  const off = p.source.subscribe!(() => { calls++; });
  store.note(w, "hello");
  off();
  store.note(w, "again");
  assert.equal(calls, 1);
});
