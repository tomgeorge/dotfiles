import assert from "node:assert/strict";
import { test } from "node:test";
import type { Style } from "../run-panel/format.ts";
import { widgetLines, WIDGET_ROWS } from "./panel.ts";
import { WatchStore } from "./store.ts";
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
