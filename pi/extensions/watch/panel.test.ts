import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clock, ENDED_LIMIT, initialPopup, LOG_LIMIT, popupKey, popupLines, widgetLines, WatchStore, WIDGET_ROWS, type Style,
} from "./panel.ts";
import type { RunResult, Watch } from "./watcher.ts";

// Plain text: one column per code point, no colors, so assertions read like the screen.
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

const result = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, killed: false });

function watch(id: number, over: Partial<Watch> = {}): Watch {
  return {
    kind: "command", text: `check ${id}`, description: `watch ${id}`, cwd: "/tmp", intervalMs: 30_000,
    timeoutMs: 3_600_000, until: "success", deliver: "wake", id, startedAt: 0, deadline: 3_600_000,
    checks: 0, fires: 0, state: "waiting", ...over,
  };
}

function storeWith(n: number) {
  const store = new WatchStore();
  const watches = Array.from({ length: n }, (_, i) => watch(i + 1));
  for (const w of watches) store.add(w, 0);
  return { store, watches };
}

test("store logs each new check once and collapses repeats", () => {
  const { store, watches: [w] } = storeWith(1);
  w.checks = 1;
  w.last = result(8, "pending\n");
  store.sync(w, 1000);
  store.sync(w, 1500); // same result object: not logged again
  w.checks = 2;
  w.last = result(8, "pending\n");
  store.sync(w, 2000);
  w.last = result(0, "pass\n");
  store.sync(w, 3000);
  w.last = result(0, "build pending\npass\n"); // same last line, different output
  store.sync(w, 4000);
  w.last = result(0, "a\tb\n");
  store.sync(w, 5000);
  const log = store.list()[0].log;
  assert.deepEqual(log.map((e) => [e.text, e.repeat]), [
    ["started", 1], ["check · exit 8 · pending", 2], ["check · exit 0 · pass", 1], ["check · exit 0 · build pending", 1],
    ["check · exit 0 · a b", 1],
  ]);
  assert.equal(log[1].at, 2000);
  for (let i = 0; i < LOG_LIMIT + 10; i++) store.note(w, `note ${i}`);
  assert.equal(store.list()[0].log.length, LOG_LIMIT);
});

test("store keeps ended watches, distinct from a reused id, and caps them", () => {
  const store = new WatchStore();
  const first = watch(1);
  store.add(first, 0);
  store.end(first, "timeout", undefined, 5000);
  const reused = watch(1);
  store.add(reused, 6000);
  const [a, b] = store.list();
  assert.equal(a.ended?.reason, "timeout");
  assert.equal(b.ended, undefined);
  assert.notEqual(a.key, b.key);
  assert.equal(store.active().length, 1);
  for (let i = 0; i < ENDED_LIMIT + 5; i++) {
    const w = watch(2);
    store.add(w);
    store.end(w, "stopped");
  }
  assert.equal(store.list().filter((r) => r.ended).length, ENDED_LIMIT);
  assert.ok(store.get(b.key), "active watches are never pruned");
});

test("widget lists active watches and loops and hides when none are active", () => {
  const store = new WatchStore();
  const ci = watch(1, { description: "CI for PR 123", checks: 3, last: result(8), nextAt: 25_000 });
  const loop = watch(2, { kind: "prompt", description: "slack incidents", fires: 2, state: "due" });
  store.add(ci, 0);
  store.add(loop, 0);
  const lines = widgetLines(store.list(), 0, 100, plain, { frame: 0, hint: "ctrl+shift+w" });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^─ Watches · 1 watching · 1 loop ─+ ctrl\+shift\+w ─$/);
  assert.equal([...lines[0]].length, 100);
  assert.match(lines[1], /◷ {2}#1 {2}watch {2}CI for PR 123 {4}3 checks {2}exit 8 {2}next in 25s$/);
  // Columns line up across rows.
  assert.equal(lines[1].indexOf("next"), lines[2].indexOf("due"));
  assert.match(lines[2], /● {2}#2 {2}loop {3}slack incidents {4}2 runs {10}due when idle$/);
  store.end(ci, "met");
  store.end(loop, "stopped");
  assert.deepEqual(widgetLines(store.list(), 0, 100, plain, { frame: 0, hint: "" }), []);
});

test("widget caps rows and never exceeds the width", () => {
  const { store } = storeWith(8);
  const lines = widgetLines(store.list(), 0, 120, plain, { frame: 0, hint: "ctrl+shift+w" });
  assert.equal(lines.length, 1 + WIDGET_ROWS);
  assert.match(lines.at(-1)!, /\+4 more · ctrl\+shift\+w to view all/);
  for (const width of [20, 40, 80]) {
    for (const line of widgetLines(store.list(), 0, width, plain, { frame: 0, hint: "ctrl+shift+w" })) {
      assert.ok([...line].length <= width, `${width}: ${line}`);
    }
  }
});

test("popup selects the newest active watch; stop targets only active ones", () => {
  const { store, watches } = storeWith(3);
  store.end(watches[2], "met");
  const records = store.list();
  const state = initialPopup(records);
  assert.equal(state.selected, records[1].key);
  assert.deepEqual(popupKey(state, records, "stop", 5), { type: "stop", watch: watches[1] });
  popupKey(state, records, "down", 5);
  assert.equal(state.selected, records[2].key);
  assert.deepEqual(popupKey(state, records, "stop", 5), { type: "none" });
  popupKey(state, records, "top", 5);
  assert.equal(state.selected, records[0].key);
  assert.deepEqual(popupKey(state, records, "back", 5), { type: "close" });
});

test("popup shows the check log and toggles to the last output", () => {
  const { store, watches: [w] } = storeWith(1);
  w.checks = 1;
  w.last = result(1, "", "gh: not logged in");
  store.sync(w, 61_000);
  const records = store.list();
  const state = initialPopup(records);
  const screen = () => popupLines(records, state, 0, 100, 20, plain, 0).lines.join("\n");
  assert.ok(screen().includes(`${clock(61_000)} check · exit 1 · gh: not logged in`));
  assert.match(screen(), /kind {3}command · until success · deliver wake/);
  assert.match(screen(), /cmd {4}check 1/);
  popupKey(state, records, "toggle", 5);
  assert.match(screen(), /Last check exit 1/);
  assert.doesNotMatch(screen(), /check · exit 1/);
});

test("popup output view shows a loop's prompt and an error's detail", () => {
  const store = new WatchStore();
  const loop = watch(1, { kind: "prompt", text: "check #incidents" });
  store.add(loop, 0);
  store.end(loop, "error", "boom");
  const records = store.list();
  const state = initialPopup(records);
  popupKey(state, records, "toggle", 5);
  const screen = popupLines(records, state, 0, 100, 20, plain, 0).lines.join("\n");
  assert.match(screen, /boom/);
  assert.match(screen, /prompt check #incidents/);
  assert.match(screen, /error: boom/);
});

test("popup detail focus scrolls the body", () => {
  const { store, watches: [w] } = storeWith(1);
  w.last = result(0, Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
  store.sync(w, 0);
  const records = store.list();
  const state = initialPopup(records);
  popupKey(state, records, "toggle", 5);
  popupKey(state, records, "enter", 5);
  assert.equal(state.focus, "detail");
  popupKey(state, records, "pageDown", 5);
  popupKey(state, records, "down", 5);
  assert.equal(state.scroll, 6);
  popupKey(state, records, "bottom", 5);
  const { lines } = popupLines(records, state, 0, 100, 20, plain, 0);
  assert.ok(lines.some((line) => line.includes("line 49")));
  assert.ok(!lines.some((line) => line.includes("line 0 ")));
  popupKey(state, records, "back", 5);
  assert.equal(state.focus, "list");
});

test("popup renders exactly width × height, tabs included", () => {
  const { store, watches } = storeWith(12);
  watches[11].last = result(0, "build\tpass\t3m12s\nlint\tpass\t41s");
  store.sync(watches[11]);
  const records = store.list();
  const state = initialPopup(records);
  for (const [width, height] of [[100, 20], [60, 8], [200, 50]]) {
    const { lines, page } = popupLines(records, state, 64_000, width, height, plain, 0);
    assert.equal(lines.length, height);
    for (const line of lines.slice(0, -1)) assert.equal([...line].length, width, line);
    assert.ok(page >= 1);
    popupKey(state, records, "toggle", 5);
    for (const line of popupLines(records, state, 64_000, width, height, plain, 0).lines.slice(0, -1)) assert.equal([...line].length, width, line);
    popupKey(state, records, "toggle", 5);
  }
  const screen = popupLines(records, state, 64_000, 100, 12, plain, 0).lines.join("\n");
  assert.match(screen, /▸◷ #12 watch watch 12/);
  assert.doesNotMatch(screen, /#1 /);
});
