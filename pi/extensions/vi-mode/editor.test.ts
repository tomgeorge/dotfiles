import assert from "node:assert/strict";
import { test } from "node:test";
// Registers the stand-ins for Pi's packages, including a minimal CustomEditor.
import "../test-support/fake-pi.ts";

const { ViEditor } = await import("./editor.ts");
const { LeaderRegistry } = await import("./leaderRegistry.ts");
const { CORE_BINDINGS } = await import("./coreBindings.ts");
const { plainStyle } = await import("./whichKey.ts");

// renderBottomBorder is protected; a subclass may read it.
class Probe extends ViEditor {
  border(): string {
    return this.renderBottomBorder(40, 0);
  }
}

const crewBindings = [
  { id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } },
  { id: "gone", path: [{ key: "c", label: "crew" }, { key: "g", label: "gone" }], command: { name: "no-such-command" } },
];

function setup({ key = " ", name = "SPC" }: { key?: string; name?: string } = {}) {
  const registry = new LeaderRegistry(CORE_BINDINGS);
  registry.register({ source: "crew", bindings: crewBindings });
  const panels: (string[] | undefined)[] = [];
  const notes: { text: string; level: string }[] = [];
  const submitted: { text: string; editorText: string }[] = [];
  let renders = 0;
  let escapes = 0;
  const tui = { terminal: { columns: 80 }, requestRender: () => { renders++; } };
  const editor = new Probe(tui as never, {} as never, {} as never, {
    registry, key, name, style: plainStyle,
    showPanel: (lines) => { panels.push(lines); },
    commandExists: (command) => command === "crews",
    notify: (text, level) => { notes.push({ text, level }); },
  });
  // As Pi does after the factory returns; its onSubmit clears the editor.
  editor.onSubmit = (text) => {
    submitted.push({ text, editorText: editor.getText() });
    editor.setText("");
  };
  editor.onEscape = () => { escapes++; };
  const type = (...keys: string[]) => { for (const k of keys) editor.handleInput(k); };
  const open = () => panels.length > 0 && panels[panels.length - 1] !== undefined;
  return { editor, registry, panels, notes, submitted, type, open, escapes: () => escapes, renders: () => renders };
}

test("INSERT space types a space and never opens the leader", () => {
  const s = setup();
  s.type(" ", "a", " ", "b");
  assert.equal(s.editor.getText(), " a b");
  assert.deepEqual(s.panels, []);
  assert.match(s.editor.border(), / INSERT /);
});

test("NORMAL SPC opens; Esc closes without reaching Pi, leaving NORMAL, text and cursor", () => {
  const s = setup();
  s.type("h", "i", "escape");
  const cursor = s.editor.getCursor();
  s.type(" ");
  assert.ok(s.open());
  const panel = s.panels[0] ?? [];
  assert.match(panel.join("\n"), /models/);
  assert.match(panel.join("\n"), /crew/);
  assert.match(s.editor.border(), / SPC /);
  s.type("escape");
  assert.equal(s.panels.at(-1), undefined);
  assert.equal(s.escapes(), 0, "Esc in the leader never reaches Pi's abort");
  assert.equal(s.editor.getText(), "hi");
  assert.deepEqual(s.editor.getCursor(), cursor);
  assert.match(s.editor.border(), / NORMAL /);
  s.type("escape");
  assert.equal(s.escapes(), 1, "outside the leader, NORMAL Esc is Pi's again");
});

test("f SPC and d SPC are vi, not the leader", () => {
  const s = setup();
  s.type("a", " ", "b", " ", "c", "escape", "0", "f", " ");
  assert.deepEqual(s.editor.getCursor(), { line: 0, col: 1 });
  // Space isn't a motion here, so d SPC is an invalid command that vi drops.
  s.type("d", " ");
  assert.equal(s.editor.getText(), "a b c");
  assert.deepEqual(s.panels, []);
  assert.match(s.editor.border(), / NORMAL /);
});

test("a pasted leader key is text", () => {
  const s = setup();
  s.type("escape", "\x1b[200~ \x1b[201~");
  assert.deepEqual(s.panels, []);
});

test("Backspace goes up a level, and at the root closes", () => {
  const s = setup();
  s.type("escape", " ", "c");
  assert.match(s.editor.border(), / SPC c /);
  assert.match(s.panels.at(-1)?.join("\n") ?? "", /list/);
  s.type("backspace");
  assert.match(s.editor.border(), / SPC /);
  assert.match(s.panels.at(-1)?.join("\n") ?? "", /models/);
  s.type("backspace");
  assert.equal(s.panels.at(-1), undefined);
  assert.match(s.editor.border(), / NORMAL /);
});

test("an unknown key closes and the border shows the missed path briefly", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  s.type("x", "escape", " ", "c", "z");
  assert.equal(s.panels.at(-1), undefined);
  assert.match(s.editor.border(), / SPC c z /);
  assert.equal(s.editor.getText(), "x", "z didn't reach vi");
  t.mock.timers.tick(1500);
  assert.match(s.editor.border(), / NORMAL /);
  assert.equal(s.renders(), 1);
});

test("other keys inside the leader close it and don't leak", () => {
  const s = setup();
  s.type("x", "escape", " ", "enter");
  assert.equal(s.panels.at(-1), undefined);
  assert.deepEqual(s.submitted, []);
  assert.match(s.editor.border(), / NORMAL /);
});

test("a command binding submits from an empty prompt and restores draft, cursor and undo", () => {
  const s = setup();
  s.type(..."fix the parser", "escape", "0", "w");
  const cursor = s.editor.getCursor();
  assert.deepEqual(cursor, { line: 0, col: 4 });
  s.type(" ", "c", "l");
  assert.deepEqual(s.submitted, [{ text: "/crews", editorText: "" }]);
  assert.equal(s.panels.at(-1), undefined);
  assert.equal(s.editor.getText(), "fix the parser");
  assert.deepEqual(s.editor.getCursor(), cursor);
  assert.match(s.editor.border(), / NORMAL /);
  // The run left no undo steps behind: one u undoes the INSERT session.
  s.type("u");
  assert.equal(s.editor.getText(), "");
});

test("an unknown command notifies and submits nothing; Pi's built-ins are known", () => {
  const s = setup();
  s.type("a", "escape", " ", "c", "g");
  assert.equal(s.submitted.length, 0);
  assert.equal(s.editor.getText(), "a");
  assert.match(s.notes[0]?.text ?? "", /no command \/no-such-command/);
  s.type(" ", "q", "q");
  assert.deepEqual(s.submitted.map((x) => x.text), ["/quit"]);
});

test("an app binding runs Pi's handler, read at run time; a missing one notifies", () => {
  const s = setup();
  let selected = 0;
  s.editor.actionHandlers.set("app.model.select", () => { selected++; });
  s.type("escape", " ", "m", "m");
  assert.equal(selected, 1);
  s.type(" ", "s", "n");
  assert.match(s.notes[0]?.text ?? "", /no action app\.session\.new/);
  assert.deepEqual(s.submitted, []);
});

test("the panel redraws when the registry changes while open", () => {
  const s = setup();
  s.type("escape", " ");
  const before = s.panels.length;
  s.registry.register({ source: "late", bindings: [{ id: "z", path: [{ key: "z", label: "zebra" }], command: { name: "crews" } }] });
  assert.equal(s.panels.length, before + 1);
  assert.match(s.panels.at(-1)?.join("\n") ?? "", /zebra/);
  s.type("escape");
  s.registry.register({ source: "later", bindings: [{ id: "y", path: [{ key: "y", label: "yak" }], command: { name: "crews" } }] });
  assert.equal(s.panels.at(-1), undefined, "a closed leader stops listening");
});

test("a paste while the leader is open closes it and is dropped whole", () => {
  const s = setup();
  s.type("escape", " ", "\x1b[200~abc", "def\x1b[201~");
  assert.equal(s.panels.at(-1), undefined);
  assert.equal(s.editor.getText(), "");
  s.type("i", "x");
  assert.equal(s.editor.getText(), "x");
});

test("a custom leader key \\ opens the leader, and space doesn't", () => {
  const s = setup({ key: "\\", name: "\\" });
  s.type("escape", " ");
  assert.deepEqual(s.panels, []);
  s.type("\\");
  assert.ok(s.open());
  assert.match(s.editor.border(), / \\ /);
  s.type("c");
  assert.match(s.editor.border(), / \\ c /);
});
