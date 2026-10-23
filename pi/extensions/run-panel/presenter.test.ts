import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureSource, job, testStyle, type FixtureOptions, type Job } from "./fixture.ts";
import { filterItems, input, type Command, type PanelInput } from "./input.ts";
import { layoutColumns, render as renderPanel } from "./render.ts";
import type { Entry, Source } from "./source.ts";
import { initialState, type PanelState } from "./state.ts";

const plain = testStyle(false);
const toned = testStyle(true);
const NOW = 50_000_000;

function panel(jobs: Job[], opts: FixtureOptions = {}) {
  const source = fixtureSource(jobs, opts);
  const state = initialState(source);
  const render = (width = 120, height = 30, s = plain) => renderPanel(source, state, NOW, width, height, s, { frame: 0 }).lines;
  const screen = (width?: number, height?: number, s?: typeof plain) => render(width, height, s).join("\n");
  const press = (...inputs: (PanelInput | string)[]): Command<Job> | undefined => {
    let command: Command<Job> | undefined;
    for (const i of inputs) command = input(state, source, typeof i === "string" ? { char: i } : i);
    return command;
  };
  return { source, state, render, screen, press };
}

const key = (k: Extract<PanelInput, { key: unknown }>["key"]): PanelInput => ({ key: k });
const ran = (command: Command<Job> | undefined) => (command?.type === "run" ? `${command.action.id} ${command.item.id}` : command?.type);

// ── Source checks ────────────────────────────────────────────────────────

test("a source can't take a reserved key, repeat a key, or have no views", () => {
  const base = fixtureSource([job(1)]);
  const withKey = (key: string): Source<Job> => ({ ...base, actions: [{ id: "a", label: "a", key, run: () => {} }] });
  for (const key of ["j", "k", "g", "G", "l", "h", "q", "?", "/", " ", "0", "7"]) {
    assert.throws(() => initialState(withKey(key)), /reserved key/, key);
  }
  assert.throws(() => initialState(withKey("xy")), /single printable key/);
  assert.throws(() => initialState({ ...base, actions: [...base.actions, { id: "again", label: "again", key: "x", run: () => {} }] }), /used twice/);
  assert.throws(() => initialState({ ...base, views: [] }), /at least one view/);
  assert.doesNotThrow(() => initialState(withKey("X")));
});

// ── Filtering ────────────────────────────────────────────────────────────

test("the filter matches item text fuzzily, one field at a time, best first", () => {
  const source = fixtureSource([
    job(1, { title: "Add dark theme", status: "done" }),
    job(2, { title: "Fix widget wrap", kind: "rev" }),
    job(3, { title: "Write README", branch: "crew/demo-docs" }),
    job(4, { title: "the old theme" }),
    job(5, { title: "theme" }),
  ]);
  const ids = (q: string) => filterItems(source.items(), q).map((i) => i.id);
  assert.deepEqual(ids(""), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids("drkthm"), ["1"]);
  assert.deepEqual(ids("#3"), ["3"]);
  assert.deepEqual(ids("done"), ["1"]);
  assert.deepEqual(ids("rev"), ["2"]);
  assert.deepEqual(ids("docs"), ["3"]);
  // Every token must match.
  assert.deepEqual(ids("running fix"), ["2"]);
  assert.deepEqual(ids("nothing-like-this"), []);
  assert.equal(ids("theme")[0], "5", "the best match comes first");
  assert.ok(ids("theme").includes("4"));
  // A plain string is one field.
  assert.deepEqual(filterItems([{ ...source.items()[0], text: "alpha beta" }], "ab").length, 1);
});

// ── Keys ─────────────────────────────────────────────────────────────────

test("typing filters; j/k and arrows move; esc clears the filter, then closes", () => {
  const p = panel([job(1, { title: "alpha" }), job(2, { title: "beta" }), job(3, { title: "gamma" })]);
  assert.equal(p.state.selected, "3", "starts on the newest running item");
  p.press("k", key("up"));
  assert.equal(p.state.selected, "1");
  p.press("j");
  assert.equal(p.state.selected, "2");

  p.press("a", "m");
  assert.equal(p.state.query, "am");
  assert.ok(p.state.filtering);
  // While filtering, letters are text, even j and q.
  p.press("q");
  assert.equal(p.state.query, "amq");
  p.press(key("backspace"));
  assert.match(p.screen(), /Tasks 1\/3 \/am▏/);
  assert.equal(p.state.selected, "3", "the selection follows the filter");
  p.press(key("enter"));
  assert.ok(!p.state.filtering);
  assert.equal(p.state.query, "am", "enter keeps the filter");
  assert.match(p.screen(), /Tasks 1\/3 filter: am/);

  assert.equal(ran(p.press(key("escape"))), "none");
  assert.equal(p.state.query, "");
  assert.equal(ran(p.press(key("escape"))), "close");
});

test("the newest item is picked when nothing runs", () => {
  const p = panel([job(1), job(2, { status: "done" }), job(3, { status: "failed" })]);
  assert.equal(p.state.selected, "1");
  const q = panel([job(1, { status: "done" }), job(2, { status: "done" })]);
  assert.equal(q.state.selected, "2");
});

test("esc clears a kept filter before it leaves the details, then unzooms", () => {
  const p = panel([job(1, { title: "alpha" }), job(2, { title: "beta" })]);
  p.press("b", key("enter"), key("enter"));
  assert.equal(p.state.query, "b");
  assert.equal(p.state.focus, "detail");
  p.press(key("escape"));
  assert.equal(p.state.query, "");
  assert.equal(p.state.focus, "detail");
  p.press(key("escape"));
  assert.equal(p.state.focus, "list");
  p.press(key("zoom"));
  p.press(key("escape"));
  assert.ok(!p.state.zoom, "esc unzooms before it closes");
  assert.equal(ran(p.press(key("escape"))), "close");
});

test("slash starts an empty filter, and esc while filtering clears it", () => {
  const p = panel([job(1), job(2)]);
  p.press("/", "2");
  assert.equal(p.state.query, "2");
  p.press(key("escape"));
  assert.equal(p.state.query, "");
  assert.ok(!p.state.filtering);
});

test("tab and digits switch the view; a digit past the last view starts a filter", () => {
  const p = panel([job(1)]);
  p.press(key("tab"));
  assert.equal(p.state.view, "spec");
  p.press(key("backTab"), key("backTab"));
  assert.equal(p.state.view, "live");
  p.press("3");
  assert.equal(p.state.view, "checks");
  p.press("5");
  assert.equal(p.state.view, "live");
  p.press("6");
  assert.equal(p.state.view, "live");
  assert.ok(p.state.filtering);
  assert.equal(p.state.query, "6");
});

test("an item's default view is shown when it's selected", () => {
  const source = fixtureSource([job(1, { status: "done" }), job(2)]);
  const items = () => source.items().map((i) => ({ ...i, defaultView: i.running ? "live" : "spec" }));
  const state = initialState({ ...source, items }, items());
  assert.equal(state.view, "live");
  input(state, { ...source, items }, { char: "k" });
  assert.equal(state.view, "spec");
});

test("an action asks first when it confirms; anything but y leaves it", () => {
  const p = panel([job(1, { status: "done" }), job(2)]);
  assert.equal(ran(p.press("x")), "none");
  assert.deepEqual(p.state.confirm, { action: "cancel", item: "2", text: `Cancel #2 "task 2"?` });
  assert.match(p.screen(), /Cancel #2 "task 2"\? y to cancel, any other key to leave it/);
  assert.equal(ran(p.press("n")), "none");
  assert.equal(p.state.confirm, undefined);
  assert.match(p.screen(), /Nothing done/);
  assert.equal(ran(p.press("x", "y")), "cancel 2");
});

test("an unavailable action flashes why, and the next key clears it", () => {
  const p = panel([job(1, { status: "done" }), job(2)]);
  p.press("k", "x");
  assert.equal(p.state.confirm, undefined);
  assert.deepEqual(p.state.flash, { text: "#1 is not running", tone: "warning" });
  assert.match(p.screen(), /#1 is not running/);
  p.press("j");
  assert.equal(p.state.flash, undefined);
  const q = panel([job(1)], { live: false });
  q.press("x");
  assert.match(q.state.flash!.text, /Nothing to cancel/);
});

test("an action without a confirmation runs at once; ? shows help; q closes", () => {
  const p = panel([job(1)]);
  assert.equal(ran(p.press("o")), "open 1");
  assert.equal(ran(p.press("e")), "export 1");
  p.press("?");
  assert.ok(p.state.help);
  p.press("j");
  assert.ok(!p.state.help, "any key closes help");
  assert.equal(p.state.selected, "1", "and does nothing else");
  p.press("?");
  assert.equal(ran(p.press("q")), "close", "q closes from the help");
  assert.equal(ran(p.press("q")), "close");
  assert.equal(ran(p.press(key("close"))), "close");
});

test("actions do nothing on an empty list", () => {
  const p = panel([]);
  assert.equal(ran(p.press("o")), "none");
  assert.match(p.screen(), /No tasks yet/);
  p.press("z", "z");
  assert.equal(p.state.query, "zz");
});

test("enter focuses the details, where j/k scroll, and paging works from either pane", () => {
  const p = panel([job(1, { spec: Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") }), job(2)]);
  p.render();
  p.press("k", "2", key("pageDown"));
  assert.equal(p.state.scroll, p.state.page);
  const paged = p.state.scroll;
  p.press(key("enter"), "j", "j");
  assert.equal(p.state.focus, "detail");
  assert.equal(p.state.scroll, paged + 2);
  assert.equal(p.state.selected, "1", "j scrolls rather than moving");
  assert.match(p.screen(), new RegExp(`│ line ${paged + 2} `));
  p.press("G");
  p.render();
  assert.ok(p.state.scroll < 60, "scroll clamps to the content at render");
  assert.match(p.screen(), /line 59/);
  p.press("g");
  assert.equal(p.state.scroll, 0);
  p.press("h");
  assert.equal(p.state.focus, "list");
  p.press("j");
  assert.equal(p.state.selected, "2");
  assert.equal(p.state.scroll, 0, "a new item starts at the top");
});

// ── Rendering ────────────────────────────────────────────────────────────

test("the header draws the source's segments, with a budget bar that warns and errors", () => {
  const p = panel([job(1, { cost: 2.5 }), job(2, { cost: 2.5 })]);
  const [line1, line2] = p.render();
  assert.equal(line1.trimEnd(), " Crew demo-ab12 active");
  assert.match(line2, /\$5\.00\/\$10\.00 █████░░░░░/);
  assert.match(panel([job(1, { cost: 8 })]).render(120, 30, toned)[1], /<warning>████████<\/warning>/);
  assert.match(panel([job(1, { cost: 12 })]).render(120, 30, toned)[1], /<error>██████████<\/error>/);
});

test("rows show the glyph and every column; a running item's glyph is a spinner", () => {
  const p = panel([job(1, { status: "done", ms: 60_000 }), job(2, { kind: "rev" })]);
  const lines = p.render(140);
  const row = (id: number) => lines.find((l) => l.startsWith("│") && l.includes(`#${id} `))!;
  assert.match(row(1), /│ ✓ #1 impl task 1 +1m00s \$0\.25 done/);
  assert.match(row(2), /│▸⠋ #2 rev +task 2 +1m30s \$0\.25 read file2\.ts/);
  // Every column still fits at the narrowest side-by-side width.
  assert.match(p.render(100).find((l) => l.startsWith("│") && l.includes("#1 "))!, /✓ #1 impl task 1 +1m00s \$0\.25 done/);
  const coloured = p.render(140, 30, toned).join("\n");
  assert.match(coloured, /<success>✓<\/success> <accent>#1<\/accent> <muted>impl<\/muted>/);
  assert.match(coloured, /<accent>⠋<\/accent>/);
});

test("columns drop by priority as the list narrows", () => {
  const items = fixtureSource([job(1)]).items();
  const columns = fixtureSource([]).columns;
  const ids = (width: number) => layoutColumns(columns, items, width, plain).map((l) => l.column.id).join(" ");
  assert.equal(ids(60), "id kind title time cost activity");
  assert.equal(ids(39), "id kind title time cost activity");
  assert.equal(ids(38), "id title time cost activity");
  assert.equal(ids(34), "id title time cost activity");
  assert.equal(ids(33), "id title time activity");
  assert.equal(ids(28), "id title time activity");
  assert.equal(ids(27), "id title time");
  assert.equal(ids(5), "id title time", "columns without a drop stay");
  // Fill columns share the rest by weight, and the row fills the width exactly.
  const layout = layoutColumns(columns, items, 60, plain);
  const total = layout.reduce((sum, l) => sum + l.width, 0) + layout.length - 1;
  assert.equal(total, 60);
  const title = layout.find((l) => l.column.id === "title")!.width;
  const activity = layout.find((l) => l.column.id === "activity")!.width;
  assert.ok(title > activity);
});

test("at 80 columns the panes stack and nothing overflows; at 120 they sit side by side", () => {
  const jobs = Array.from({ length: 12 }, (_, i) => job(i + 1, {
    title: `a long task title that will not fit in the list ${i}`, activity: "bash node --test pi/extensions/crew/some/really/long/path.test.ts",
    spec: "a very long spec line that has to wrap onto more than one line at eighty columns ".repeat(3),
    checks: [{ command: "npm test", exit: 1, tail: "x".repeat(200) }],
    entries: [{ kind: "text", text: "y".repeat(300) }], diff: ["+".repeat(200)],
  }));
  for (const width of [60, 80, 99]) {
    const p = panel(jobs);
    for (const tab of ["1", "2", "3", "4", "5"]) {
      p.press(tab);
      const lines = p.render(width, 30);
      for (const line of lines) assert.ok(plain.width(line) <= width, `${width} cols, tab ${tab}: ${line}`);
      assert.equal(lines.length, 30);
      const listTop = lines.findIndex((l) => l.startsWith("┌─ Tasks"));
      const detailTop = lines.findIndex((l) => l.startsWith("┌─ #"));
      assert.ok(listTop >= 0 && detailTop > listTop, `stacked at ${width}`);
    }
  }
  const wide = panel(jobs).render(120);
  assert.ok(wide.some((l) => l.startsWith("┌─ Tasks") && l.includes("┐┌─ #12")), "side by side at 120");
  for (const line of wide) assert.ok(plain.width(line) <= 120);
});

test("the list keeps the selection on screen", () => {
  const p = panel(Array.from({ length: 30 }, (_, i) => job(i + 1, { status: "done" })));
  assert.equal(p.state.selected, "30");
  assert.ok(p.render().some((l) => l.includes("▸✓ #30")));
  p.press("g");
  assert.ok(p.render().some((l) => l.includes("▸✓ #1 ")));
});

test("an empty filter result says so", () => {
  const p = panel([job(1)]);
  p.press("/", "z", "z", "z");
  assert.match(p.screen(), /Nothing matches "zzz"/);
  assert.match(p.screen(), /Tasks 0\/1/);
});

test("status and busy come from the source", () => {
  const source = { ...fixtureSource([job(1), job(2)], { busy: true }), status: (m: number, t: number) => `${m} of ${t}` };
  const state = initialState(source);
  const text = renderPanel(source, state, NOW, 120, 30, plain, { frame: 1 }).lines.join("\n");
  assert.match(text, /┌─ Tasks ⠙ 2 of 2/);
});

test("ctrl+o zooms the details to the full panel", () => {
  const p = panel([job(1)]);
  p.press(key("zoom"));
  const lines = p.render(120);
  assert.ok(!lines.some((l) => l.includes("Tasks")));
  assert.ok(lines.some((l) => l.startsWith("┌─ #1 impl task 1") && l.length === 120));
});

test("help lists the keys, the views, and the source's actions", () => {
  const p = panel([job(1)]);
  p.press("?");
  const text = p.screen(160, 40);
  assert.match(text, /┌─ Help/);
  assert.match(text, /tab, 1-5 +switch tab: overview, spec, checks, diff, live/);
  assert.match(text, /on Live, k pauses and G follows again/);
  assert.match(text, /x +cancel the selected running task \(asks first\)/);
  assert.match(text, /o +copy path/);
  assert.match(text, /e +export/);
  // Below side-by-side width, help takes the whole panel.
  assert.ok(!p.render(80, 40).some((l) => l.includes("Tasks")));
});

test("the footer hints come from the views and actions", () => {
  const p = panel([job(1)]);
  assert.match(p.screen(), /j\/k move · type to filter · tab\/1-5 tabs · enter details · x cancel · o copy path · e export · \? help · esc close/);
  p.press(key("enter"));
  assert.match(p.screen(), /j\/k scroll · tab\/1-5 tabs · ctrl\+d\/u page · ctrl\+o zoom · x cancel · o copy path · e export · h back · \? help/);
  p.press("/");
  assert.match(p.screen(), /type to filter · ↑\/↓ move · enter keep filter · esc clear/);
  const single = { ...fixtureSource([job(1)]), views: [fixtureSource([]).views[0]] };
  const state = initialState(single);
  const text = renderPanel(single, state, NOW, 120, 30, plain, { frame: 0, closeHint: "ctrl+shift+c close" }).lines.at(-1)!;
  assert.doesNotMatch(text, /tabs/);
  assert.match(text, /ctrl\+shift\+c close/);
});

test("a narrow pane keeps the active tab visible", () => {
  const p = panel([job(1)]);
  p.press("5");
  assert.match(p.screen(100, 40), /│ 1 Overview 2 Spec 3 Checks 4 Diff \[5 Live\] +│/);
  assert.match(p.screen(40, 40), /│ 1 2 3 4 \[5 Live\] +│/);
});

test("fields, bullets, and sections render in the overview", () => {
  const p = panel([job(1, { checks: [{ command: "npm test", tail: "" }] })]);
  const text = p.screen();
  assert.match(text, /status +running/);
  assert.match(text, /branch +crew\/demo-t1/);
  assert.match(text, /checks *│?\n.*- npm test/);
  assert.match(panel([job(1)]).screen(), /  none declared/);
  assert.match(p.screen(120, 30, toned), /<muted>status {7}<\/muted><accent>running<\/accent>/);
});

test("collapsible entries open by the source's default, and enter toggles the one under the cursor", () => {
  const checks = [
    { command: "npm test", exit: 0, tail: "all good" },
    { command: "npm run lint", exit: 1, tail: "lint: bad" },
    { command: "npm run slow", tail: "" },
  ];
  const p = panel([job(1, { status: "done", checks })]);
  p.press("3");
  let text = p.screen();
  assert.match(text, /▸ PASS +npm test/);
  assert.match(text, /▾ FAIL 1 +npm run lint/);
  assert.match(text, /lint: bad/, "failing output starts open");
  assert.match(text, /   PENDING npm run slow/, "an entry with no body can't open");
  assert.ok(!text.includes("all good"), "passing output starts closed");
  assert.match(text, /enter to pick an entry/);
  p.press(key("enter"), key("enter"));
  text = p.screen();
  assert.match(text, /›▾ PASS +npm test/);
  assert.ok(text.includes("all good"));
  assert.match(text, /j\/k pick an entry/);
  p.press(key("enter"));
  assert.ok(!p.screen().includes("all good"), "enter closes it again before a render");
  p.press(key("enter"), key("enter"));
  assert.ok(!p.screen().includes("all good"), "two toggles with no render in between cancel out");
  p.press("j", key("enter"));
  assert.ok(!p.screen().includes("lint: bad"));
  p.press("G");
  assert.match(p.screen(), /›  PENDING npm run slow/);
  p.press("G", "j");
  assert.equal(p.state.cursor, 2, "the cursor stops at the last entry");
});

test("a collapsible cursor stays on screen", () => {
  const checks = Array.from({ length: 30 }, (_, i) => ({ command: `check ${i}`, exit: 1, tail: "a\nb\nc" }));
  const p = panel([job(1, { status: "done", checks })]);
  p.press("3");
  p.render();
  p.press(key("enter"), "G");
  assert.match(p.screen(), /› ?▾ FAIL 1 +check 29/);
  p.press("g");
  assert.match(p.screen(), /›▾ FAIL 1 +check 0/);
});

test("a message view shows instead of a collapsible list, and enter goes back to the list", () => {
  const p = panel([job(1)]);
  p.press("3");
  assert.match(p.screen(), /No checks declared\./);
  p.press(key("enter"), key("enter"));
  assert.equal(p.state.focus, "list");
});

test("a lines view with a diff paint colours it, and a loading view says so", () => {
  const p = panel([job(1, { diff: ["diff --git a/x b/x", "@@ -1 +1 @@", "-old", "+new", " same"] }), job(2)]);
  p.press("4");
  assert.match(p.screen(), /Loading diff…/);
  p.press("k");
  const text = p.screen(120, 30, toned);
  assert.match(text, /<dim>git diff crew\/demo-t1<\/dim>/);
  assert.match(text, /<accent>@@ -1 \+1 @@<\/accent>/);
  assert.match(text, /<error>-old<\/error>/);
  assert.match(text, /<success>\+new<\/success>/);
});

// ── Transcript and following ─────────────────────────────────────────────

function entries(lines = 0): Entry[] {
  const out: Entry[] = [
    { kind: "user", text: Array.from({ length: 9 }, (_, i) => `spec line ${i}`).join("\n") },
    { kind: "thinking", text: "Check the theme first" },
    { kind: "text", text: "Reading it." },
    { kind: "tool", id: "a", name: "read", args: "theme.ts", result: Array.from({ length: 12 }, (_, i) => `src ${i}`).join("\n"), state: "ok" },
    { kind: "tool", id: "b", name: "bash", args: "npm test", result: "\x1b[31m1 failing\x1b[0m", state: "error" },
    { kind: "note", text: "worker restarted" },
  ];
  if (lines) out.push({ kind: "text", text: Array.from({ length: lines }, (_, i) => `out ${i}`).join("\n") });
  return out;
}

test("a transcript shows the prompt, thinking, text, notes, and tool calls with their output", () => {
  const p = panel([job(1, { entries: entries(), dropped: 3 })]);
  p.press("5");
  const text = p.screen(120, 60);
  assert.match(text, /\[5 Live\]/);
  assert.match(text, /streaming from the worker/);
  assert.match(text, /… 3 earlier entries not kept here/);
  assert.match(text, /following ─*┘/);
  assert.match(text, /prompt\s*│[^\n]*\n[^\n]*spec line 0/);
  assert.match(text, /… 3 more lines/);
  assert.match(text, /∴ Check the theme first/);
  assert.match(text, /Reading it\./);
  assert.match(text, /✓ read theme\.ts/);
  assert.match(text, /… 4 earlier lines/);
  assert.doesNotMatch(text, /src 3\b/);
  assert.match(text, /src 11/);
  assert.match(text, /✗ bash npm test/);
  assert.match(text, / {4}1 failing/, "colour codes are stripped");
  assert.match(text, /worker restarted/);
  const coloured = p.screen(120, 60, toned);
  assert.match(coloured, /<error>✗<\/error>/);
  assert.match(coloured, /<dim>∴ Check the theme first<\/dim>/);
  assert.match(coloured, /<warning>worker restarted<\/warning>/);
  assert.doesNotMatch(panel([job(1)]).screen(), /No output yet/);
  const empty = panel([job(1)]);
  empty.press("5");
  assert.match(empty.screen(), /No output yet\./);
});

test("a tail view follows the newest output; k pauses it and G follows again", () => {
  const j = job(1, { entries: entries(100) });
  const p = panel([j]);
  p.press("5", key("enter"));
  assert.match(p.screen(), /out 99/);
  p.press("k", "k", "k");
  assert.equal(p.state.follow, false);
  let text = p.screen();
  assert.doesNotMatch(text, /out 99/);
  assert.match(text, /paused · G follows · \d+-\d+\/\d+ ─*┘/);
  // New output arrives while paused: the view stays put.
  const before = p.state.scroll;
  j.entries.push({ kind: "text", text: "newest" });
  text = p.screen();
  assert.equal(p.state.scroll, before);
  assert.doesNotMatch(text, /newest/);
  p.press("G");
  assert.match(p.screen(), /newest/);
  assert.equal(p.state.follow, true);
  // Paging up pauses too, from either pane.
  p.press(key("left"), key("pageUp"));
  assert.equal(p.state.follow, false);
  // A new view starts following again.
  p.press("1", "5");
  assert.equal(p.state.follow, true);
});

test("views get the time, a style, and a way to ask for a re-render", () => {
  const seen: number[] = [];
  let changed = 0;
  const base = fixtureSource([job(1)]);
  const source: Source<Job> = {
    ...base,
    views: [{ id: "probe", label: "Probe", render: (_j, ctx) => { seen.push(ctx.now); ctx.changed(); return { kind: "markdown", text: "# hi" }; } }],
  };
  const state = initialState(source);
  const md = { ...plain, markdown: (text: string) => [`MD ${text}`] };
  const text = renderPanel(source, state, NOW, 120, 30, md, { frame: 0, changed: () => { changed++; } }).lines.join("\n");
  assert.deepEqual(seen, [NOW]);
  assert.equal(changed, 1);
  assert.match(text, /MD # hi/);
  assert.match(renderPanel(source, state, NOW, 120, 30, plain, { frame: 0 }).lines.join("\n"), /│ # hi/, "markdown falls back to plain text");
});
