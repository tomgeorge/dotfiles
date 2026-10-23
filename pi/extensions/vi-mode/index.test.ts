import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus, fakePi } from "../test-support/fake-pi.ts";
import { contributeLeader, LEADER_CONTRIBUTE, type LeaderBinding } from "./leaderContract.ts";

const { default: viMode } = await import("./index.ts");

type Factory = (tui: unknown, theme: unknown, keybindings: unknown) => {
  handleInput(data: string): void;
  onSubmit?: (text: string) => void;
};
interface Widget { key: string; lines: string[] | undefined; options: unknown }

const crew: LeaderBinding[] = [{ id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } }];
const watch: LeaderBinding[] = [{ id: "list", path: [{ key: "w", label: "watches" }, { key: "l", label: "list" }], command: { name: "watches" } }];

function configFile(content?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "vi-mode-")), "leader.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

// vi-mode loaded into a fake Pi, with a UI that records what it's asked to show.
function load(configPath: string, events = createEventBus()) {
  const f = fakePi({ events });
  viMode(f.pi, { configPath });
  const notes: { text: string; level?: string }[] = [];
  const widgets: Widget[] = [];
  let factory: Factory | undefined;
  const ui = {
    notify: (text: string, level?: string) => { notes.push({ text, level }); },
    setWidget: (key: string, lines: string[] | undefined, options?: unknown) => { widgets.push({ key, lines, options }); },
    setEditorComponent: (next: Factory) => { factory = next; },
    theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t, inverse: (t: string) => t },
  };
  const ctx = f.ctx("/tmp", { ui });
  return {
    f, notes, widgets, ctx,
    start: () => f.emit("session_start", {}, ctx),
    editor: () => {
      if (!factory) throw new Error("no editor installed");
      return factory({ terminal: { columns: 80 }, requestRender() {} }, {}, {});
    },
    leader: async () => {
      notes.length = 0;
      await f.command("leader", "", ctx);
      return notes.map((n) => n.text).join("\n");
    },
  };
}

test("contributions from before and after vi-mode loads both reach the tree", async () => {
  const events = createEventBus();
  contributeLeader(events, "crew", crew);
  const v = load(configFile(), events);
  contributeLeader(events, "watch", watch);
  await v.start();
  const report = await v.leader();
  assert.match(report, /^SPC c l {2}crew › list {2}→ \/crews {2}\(crew\)$/m);
  assert.match(report, /^SPC w l {2}watches › list {2}→ \/watches {2}\(watch\)$/m);
});

test("a malformed contribution is notified once, even if it came before a UI did", async () => {
  const v = load(configFile());
  v.f.events.emit(LEADER_CONTRIBUTE, { source: "bad", bindings: [{ id: "x", path: [{ key: "!", label: "bang" }], command: { name: "x" } }] });
  assert.equal(v.notes.length, 0);
  await v.start();
  assert.equal(v.notes.length, 1);
  assert.match(v.notes[0]?.text ?? "", /rejected a contribution: bad/);
  v.f.events.emit(LEADER_CONTRIBUTE, { source: "worse" });
  assert.equal(v.notes.length, 2);
  assert.match(v.notes[1]?.text ?? "", /worse/);
  await v.start();
  assert.equal(v.notes.length, 2, "not repeated at the next session start");
});

test("a takeover isn't notified; /leader lists it", async () => {
  const events = createEventBus();
  const v = load(configFile(), events);
  contributeLeader(events, "crew", crew);
  contributeLeader(events, "other", [{ id: "mine", path: [{ key: "c", label: "crew" }, { key: "l", label: "mine" }], command: { name: "mine" } }]);
  await v.start();
  assert.deepEqual(v.notes, []);
  assert.match(await v.leader(), /Conflicts:\n {2}other mine: c l taken over from crew/);
});

test("a bad leader.json is notified with its path, and the defaults apply", async () => {
  const path = configFile(JSON.stringify({ leader: "d", keymap: [{ keys: "q q", unbind: true }] }));
  const v = load(path);
  await v.start();
  assert.equal(v.notes.length, 1);
  assert.equal(v.notes[0]?.level, "error");
  assert.ok(v.notes[0]?.text.includes(path));
  assert.match(v.notes[0]?.text ?? "", /vi NORMAL-mode key/);
  const report = await v.leader();
  assert.match(report, /^Leader key: SPC$/m);
  assert.match(report, /^SPC q q {2}quit › quit {2}→ \/quit {2}\(core\)$/m, "the unbind wasn't half-applied");
  assert.ok(report.includes(`Errors in ${path}`));
});

test("a missing leader.json is the defaults, silently", async () => {
  const v = load(configFile());
  await v.start();
  assert.deepEqual(v.notes, []);
  assert.match(await v.leader(), /^Leader key: SPC$/m);
});

test("/leader lists core, contributed, and user bindings with their sources", async () => {
  const events = createEventBus();
  const path = configFile(JSON.stringify({
    leader: "\\",
    keymap: [{ keys: "o", label: "crews", command: "crews" }, { keys: "g s", label: "status", command: "goal status" }],
  }));
  const v = load(path, events);
  contributeLeader(events, "crew", crew);
  await v.start();
  const report = await v.leader();
  assert.match(report, /^Leader key: \\$/m);
  assert.match(report, /^\\ m m {2}models › select {2}→ app\.model\.select {2}\(core\)$/m);
  assert.match(report, /^\\ h l {2}help › leader map {2}→ \/leader {2}\(core\)$/m);
  assert.match(report, /^\\ c l {2}crew › list {2}→ \/crews {2}\(crew\)$/m);
  assert.match(report, /^\\ o {2}crews {2}→ \/crews {2}\(user\)$/m);
  assert.match(report, /^\\ g s {2}g › status {2}→ \/goal status {2}\(user\)$/m);
});

test("the editor shows the panel below the editor and runs commands Pi knows", async () => {
  const v = load(configFile());
  await v.start();
  const editor = v.editor();
  const submitted: string[] = [];
  editor.onSubmit = (text) => { submitted.push(text); };
  editor.handleInput("escape");
  editor.handleInput(" ");
  const shown = v.widgets.at(-1);
  assert.equal(shown?.key, "leader");
  assert.deepEqual(shown?.options, { placement: "belowEditor" });
  assert.match(shown?.lines?.join("\n") ?? "", /models/);
  // /leader is registered with pi, so pi.getCommands() knows it.
  editor.handleInput("h");
  editor.handleInput("l");
  assert.deepEqual(submitted, ["/leader"]);
  assert.equal(v.widgets.at(-1)?.lines, undefined);
});
