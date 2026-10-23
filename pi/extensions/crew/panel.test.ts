import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { git } from "./git.ts";
import type { TaskReport } from "./handoff.ts";
import type { Style, Tone } from "../run-panel/format.ts";
import {
  DiffCache, diffTarget, filterTasks, initialPanel, panelInput, panelLines, quiet,
  type DiffView, type PanelInput, type PanelState, type RenderDeps,
} from "./panel.ts";
import type { CrewState, TaskRecord } from "./state.ts";
import { Transcript, type TranscriptView } from "./transcript.ts";

// Plain text: one column per code point. `toned` wraps coloured text in <tone>…</tone> so
// tests can check colours; `plain` drops them so assertions read like the screen.
function makeStyle(tones: boolean): Style {
  const style: Style = {
    fg: (tone: Tone, text) => (tones ? `<${tone}>${text}</${tone}>` : text),
    bold: (text) => text,
    selected: (text) => text,
    width: (text) => [...text.replace(/<\/?[a-zA-Z]+>/g, "")].length,
    truncate(text, width, pad) {
      // Tags take no columns, like ANSI codes on a terminal.
      const parts = text.match(/<\/?[a-zA-Z]+>|[^<]+|</g) ?? [];
      const full = style.width(text);
      const room = full > width ? Math.max(0, width - 1) : width;
      let out = "";
      let used = 0;
      for (const part of parts) {
        if (/^<\/?[a-zA-Z]+>$/.test(part)) { out += part; continue; }
        const chars = [...part].slice(0, room - used);
        out += chars.join("");
        used += chars.length;
      }
      if (full > width && width > 0) out += "…";
      return pad ? out + " ".repeat(Math.max(0, width - style.width(out))) : out;
    },
    wrap(text, width) {
      return text.split("\n").flatMap((line) => {
        const out: string[] = [];
        for (let i = 0; i < Math.max(1, line.length); i += width) out.push(line.slice(i, i + width));
        return out;
      });
    },
  };
  return style;
}
const plain = makeStyle(false);
const toned = makeStyle(true);

const NOW = 50_000_000;

function task(id: number, over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id, kind: "implement", title: `task ${id}`, spec: `spec ${id}`, acceptance: [], checks: [], paths: [],
    model: "p/worker", branch: `crew/demo-t${id}`, worktree: `/wt/crew-demo-t${id}`, base: "b".repeat(40),
    status: "running", startedAt: NOW - 90_000, cost: 0.25, toolCalls: 3, activity: `read file${id}.ts`,
    lastEventAt: NOW - 1_000, ...over,
  };
}

function crewOf(tasks: TaskRecord[], over: Partial<CrewState["config"]> = {}): CrewState {
  return {
    version: 1, status: "active", tasks, nextId: tasks.length + 1,
    config: {
      slug: "demo-ab12", goal: "Add a lazygit-like theme to every panel", repoRoot: "/repo", repoName: "repo",
      commonDir: "/repo/.git", integrationBranch: "crew/demo-ab12", integrationPath: "/wt/crew-demo-ab12",
      baseSha: "a".repeat(40), workerModel: { provider: "p", model: "worker" }, reviewerModel: { provider: "p", model: "worker" },
      maxConcurrent: 3, budgetUsd: 10, taskTimeoutMin: 45, stallMin: 10, createdAt: 0, ...over,
    },
  };
}

function report(over: Partial<TaskReport> = {}): TaskReport {
  return {
    id: 1, kind: "implement", title: "task 1", outcome: "submitted", model: "p/worker",
    handoff: { status: "done", summary: "added the theme", notes: "", concerns: ["colours untested on light terminals"], deviations: ["renamed a file"], findings: [], next: ["add a toggle"] },
    branch: "crew/demo-t1", base: "b".repeat(40), commits: ["abc1234 add theme"], diffStat: " theme.ts | 3 +++\n", outOfScope: ["README.md"],
    autoCommitted: true, checks: [
      { command: "npm test", exit: 0, tail: "all good", timedOut: false },
      { command: "npm run lint", exit: 1, tail: "lint: \x1b[31mbad\x1b[0m\tindent", timedOut: false },
    ],
    dirtyAfterChecks: ["package-lock.json"], cost: 0.25, durationMs: 90_000, ...over,
  };
}

const noDiff: RenderDeps = { diff: () => ({ state: "loading" }), transcript: () => ({ state: "loading" }), frame: 0 };
const render = (crew: CrewState, state: PanelState, width = 120, height = 30, s = plain, deps = noDiff) =>
  panelLines(crew, state, NOW, width, height, s, deps).lines;
const screen = (lines: string[]) => lines.join("\n");

const key = (k: Extract<PanelInput, { key: unknown }>["key"]): PanelInput => ({ key: k });
const char = (c: string): PanelInput => ({ char: c });
function press(state: PanelState, tasks: TaskRecord[], inputs: (PanelInput | string)[], live = true) {
  let action;
  for (const input of inputs) {
    action = panelInput(state, tasks, typeof input === "string" ? char(input) : input, { page: 5, live });
  }
  return action;
}

// ── Formatting ───────────────────────────────────────────────────────────

test("a quiet running task shows quiet time: warning past 60s, error past stallMin", () => {
  assert.equal(quiet(task(1, { lastEventAt: NOW - 60_000 }), NOW, 10), undefined);
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 125_000 }), NOW, 10), { text: "quiet 2m", tone: "warning" });
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 10 * 60_000 }), NOW, 10), { text: "quiet 10m", tone: "error" });
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 61 * 60_000 }), NOW, 120), { text: "quiet 1h01m", tone: "warning" });
  // A finished task is never quiet, however old its last event.
  assert.equal(quiet(task(1, { status: "submitted", lastEventAt: 0 }), NOW, 10), undefined);
});

// ── Filtering ────────────────────────────────────────────────────────────

test("the filter matches title, id, status, kind, and branch fuzzily", () => {
  const tasks = [
    task(1, { title: "Add dark theme", status: "integrated" }),
    task(2, { title: "Fix widget wrap", kind: "review", reviewOf: 1 }),
    task(3, { title: "Write README", branch: "crew/demo-docs" }),
  ];
  const ids = (q: string) => filterTasks(tasks, q).map((t) => t.id);
  assert.deepEqual(ids(""), [1, 2, 3]);
  assert.deepEqual(ids("drkthm"), [1]);
  assert.deepEqual(ids("#3"), [3]);
  assert.deepEqual(ids("integ"), [1]);
  assert.deepEqual(ids("review"), [2]);
  assert.deepEqual(ids("docs"), [3]);
  // Every token must match.
  assert.deepEqual(ids("running fix"), [2]);
  assert.deepEqual(ids("nothing-like-this"), []);
});

test("the best match comes first", () => {
  const tasks = [task(1, { title: "the old theme" }), task(2, { title: "theme" })];
  assert.deepEqual(filterTasks(tasks, "theme").map((t) => t.id), [2, 1]);
});

// ── Keys ─────────────────────────────────────────────────────────────────

test("typing filters; j/k and arrows move; esc clears the filter, then closes", () => {
  const tasks = [task(1, { title: "alpha" }), task(2, { title: "beta" }), task(3, { title: "gamma" })];
  const state = initialPanel(crewOf(tasks));
  assert.equal(state.selected, 3, "starts on the newest running task");
  press(state, tasks, ["k", key("up")]);
  assert.equal(state.selected, 1);
  press(state, tasks, ["j"]);
  assert.equal(state.selected, 2);

  press(state, tasks, ["a", "m"]);
  assert.equal(state.query, "am");
  assert.ok(state.filtering);
  // While filtering, letters are text, even j and q.
  press(state, tasks, ["q"]);
  assert.equal(state.query, "amq");
  press(state, tasks, [key("backspace")]);
  assert.deepEqual(filterTasks(tasks, state.query).map((t) => t.id), [3]);
  assert.match(screen(render(crewOf(tasks), state)), /Tasks 1\/3 \/am▏/);
  assert.equal(state.selected, 3, "the selection follows the filter");
  press(state, tasks, [key("enter")]);
  assert.ok(!state.filtering);
  assert.equal(state.query, "am", "enter keeps the filter");

  assert.deepEqual(press(state, tasks, [key("escape")]), { type: "none" });
  assert.equal(state.query, "");
  assert.deepEqual(press(state, tasks, [key("escape")]), { type: "close" });
});

test("esc clears a kept filter before it leaves the details", () => {
  const tasks = [task(1, { title: "alpha" }), task(2, { title: "beta" })];
  const state = initialPanel(crewOf(tasks));
  press(state, tasks, ["b", key("enter"), key("enter")]);
  assert.equal(state.query, "b");
  assert.equal(state.focus, "detail");
  press(state, tasks, [key("escape")]);
  assert.equal(state.query, "");
  assert.equal(state.focus, "detail");
  press(state, tasks, [key("escape")]);
  assert.equal(state.focus, "list");
  assert.deepEqual(press(state, tasks, [key("escape")]), { type: "close" });
});

test("slash starts an empty filter, and esc while filtering clears it", () => {
  const tasks = [task(1), task(2)];
  const state = initialPanel(crewOf(tasks));
  press(state, tasks, ["/", "2"]);
  assert.equal(state.query, "2");
  press(state, tasks, [key("escape")]);
  assert.equal(state.query, "");
  assert.ok(!state.filtering);
});

test("tab and 1-6 switch the detail tab", () => {
  const tasks = [task(1)];
  const state = initialPanel(crewOf(tasks));
  press(state, tasks, [key("tab")]);
  assert.equal(state.tab, "spec");
  press(state, tasks, [key("backTab"), key("backTab")]);
  assert.equal(state.tab, "live");
  press(state, tasks, ["3"]);
  assert.equal(state.tab, "handoff");
  press(state, tasks, ["6"]);
  assert.equal(state.tab, "live");
});

test("x asks before cancelling a running task; anything but y keeps it", () => {
  const tasks = [task(1, { status: "submitted" }), task(2)];
  const state = initialPanel(crewOf(tasks));
  assert.deepEqual(press(state, tasks, ["x"]), { type: "none" });
  assert.equal(state.confirm, 2);
  assert.match(screen(render(crewOf(tasks), state)), /Cancel #2 "task 2"\? .*y to cancel/);
  assert.deepEqual(press(state, tasks, ["n"]), { type: "none" });
  assert.equal(state.confirm, undefined);
  assert.deepEqual(press(state, tasks, ["x", "y"]), { type: "cancel", id: 2 });

  // Only running tasks in a crew that runs in this session can be cancelled.
  press(state, tasks, ["k", "x"]);
  assert.equal(state.confirm, undefined);
  assert.match(state.flash!.text, /#1 is not running/);
  press(state, tasks, ["j", "x"], false);
  assert.equal(state.confirm, undefined);
  assert.match(state.flash!.text, /isn't running in this session/);
});

test("o opens the selected worktree, ? shows help, q closes", () => {
  const tasks = [task(1)];
  const state = initialPanel(crewOf(tasks));
  assert.deepEqual(press(state, tasks, ["o"]), { type: "open", id: 1 });
  press(state, tasks, ["?"]);
  assert.ok(state.help);
  assert.match(screen(render(crewOf(tasks), state)), /cancel the selected running task/);
  press(state, tasks, ["j"]);
  assert.ok(!state.help, "any key closes help");
  assert.deepEqual(press(state, tasks, ["q"]), { type: "close" });
  assert.deepEqual(press(state, tasks, [key("close")]), { type: "close" });
});

// ── Live ─────────────────────────────────────────────────────────────────

/** A worker that read a file, failed a test, and then printed `lines` lines of text. */
function liveDeps(lines = 0, source: "live" | "file" = "live"): RenderDeps & { view: TranscriptView } {
  const t = new Transcript();
  t.applyEvent({ type: "message_start", message: { role: "user", content: Array.from({ length: 9 }, (_, i) => `spec line ${i}`).join("\n") } });
  t.applyEvent({ type: "message_end", message: { role: "assistant", content: [
    { type: "thinking", thinking: "Check the theme first" },
    { type: "text", text: "Reading it." },
    { type: "toolCall", id: "a", name: "read", arguments: { path: "theme.ts" } },
    { type: "toolCall", id: "b", name: "bash", arguments: { command: "npm test" } },
  ] } });
  t.applyEvent({ type: "tool_execution_end", toolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: Array.from({ length: 12 }, (_, i) => `src ${i}`).join("\n") }] } });
  t.applyEvent({ type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "npm test" } });
  t.applyEvent({ type: "tool_execution_end", toolCallId: "b", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "\x1b[31m1 failing\x1b[0m" }] } });
  if (lines) t.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: Array.from({ length: lines }, (_, i) => `out ${i}`).join("\n") }] } });
  const view: TranscriptView = { state: "ready", transcript: t, source };
  return { ...noDiff, transcript: () => view, view };
}

test("the live tab shows the prompt, thinking, text, and tool calls with their output", () => {
  const crew = crewOf([task(1)]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["6"]);
  const text = screen(render(crew, state, 120, 60, plain, liveDeps()));
  assert.match(text, /\[6 Live\]/);
  assert.match(text, /streaming from the worker/);
  assert.match(text, /following ─*┘/);
  assert.match(text, /prompt\s*│[^\n]*\n[^\n]*spec line 0/);
  assert.match(text, /… 3 more lines; the Spec tab has the task/);
  assert.match(text, /∴ Check the theme first/);
  assert.match(text, /Reading it\./);
  assert.match(text, /✓ read theme\.ts/);
  // Tool output keeps its newest lines.
  assert.match(text, /… 4 earlier lines/);
  assert.doesNotMatch(text, /src 3\b/);
  assert.match(text, /src 11/);
  assert.match(text, /✗ bash npm test/);
  assert.match(text, / {4}1 failing/, "colour codes are stripped");

  const coloured = screen(render(crew, state, 120, 60, toned, liveDeps()));
  assert.match(coloured, /<error>✗<\/error>/);
  assert.match(coloured, /<dim>∴ Check the theme first<\/dim>/);
});

test("the live tab says where the transcript comes from, or why there is none", () => {
  const crew = crewOf([task(1, { status: "submitted" })]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["6"]);
  assert.match(screen(render(crew, state, 120, 40, plain, liveDeps(0, "file"))), /from the session file, updated as messages finish/);
  const none: RenderDeps = { ...noDiff, transcript: () => ({ state: "unavailable", message: "No transcript: too old." }) };
  assert.match(screen(render(crew, state, 120, 40, plain, none)), /No transcript: too old\./);
  assert.match(screen(render(crew, state, 120, 40, plain, noDiff)), /Loading the transcript…/);
});

test("the live tab follows the newest output; k pauses it and G follows again", () => {
  const crew = crewOf([task(1)]);
  const state = initialPanel(crew);
  const deps = liveDeps(100);
  press(state, crew.tasks, ["6", key("enter")]);
  assert.match(screen(render(crew, state, 120, 30, plain, deps)), /out 99/);
  press(state, crew.tasks, ["k", "k", "k"]);
  assert.equal(state.follow, false);
  let text = screen(render(crew, state, 120, 30, plain, deps));
  assert.doesNotMatch(text, /out 99/);
  assert.match(text, /paused · G follows · \d+-\d+\/\d+ ─*┘/);
  // New output arrives while paused: the view stays put.
  const before = state.scroll;
  if (deps.view.state === "ready") deps.view.transcript.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "newest" }] } });
  text = screen(render(crew, state, 120, 30, plain, deps));
  assert.equal(state.scroll, before);
  assert.doesNotMatch(text, /newest/);
  press(state, crew.tasks, ["G"]);
  assert.match(screen(render(crew, state, 120, 30, plain, deps)), /newest/);
  assert.equal(state.follow, true);
  // Paging up pauses too, from either pane.
  press(state, crew.tasks, [key("left"), key("pageUp")]);
  assert.equal(state.follow, false);
});

test("a narrow pane keeps the active tab visible", () => {
  const crew = crewOf([task(1)]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["6"]);
  // At 100 columns the panes sit side by side and the details get half.
  const text = screen(render(crew, state, 100, 40, plain, liveDeps()));
  assert.match(text, /│ 1 2 3 4 5 \[6 Live\] +│/);
});

test("e exports a task's session, or explains why it can't", () => {
  const tasks = [task(1, { session: "/git/pi-crew/demo/t1.jsonl" }), task(2)];
  const state = initialPanel(crewOf(tasks));
  assert.equal(state.selected, 2);
  assert.deepEqual(press(state, tasks, ["e"]), { type: "none" });
  assert.match(state.flash?.text ?? "", /#2 has no session file/);
  assert.deepEqual(press(state, tasks, ["k", "e"]), { type: "export", id: 1 });
});

test("enter focuses the details, where j/k scroll, and paging works from either pane", () => {
  const tasks = [task(1, { spec: Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") }), task(2)];
  const crew = crewOf(tasks);
  const state = initialPanel(crew);
  press(state, tasks, ["k", "2", key("pageDown")]);
  assert.equal(state.scroll, 5);
  press(state, tasks, [key("enter"), "j", "j"]);
  assert.equal(state.focus, "detail");
  assert.equal(state.scroll, 7);
  assert.equal(state.selected, 1, "j scrolls rather than moving");
  assert.match(screen(render(crew, state)), /│ line 7 /);
  press(state, tasks, ["G"]);
  render(crew, state);
  assert.ok(state.scroll < 60, "scroll clamps to the content at render");
  assert.match(screen(render(crew, state)), /line 59/);
  press(state, tasks, ["h"]);
  assert.equal(state.focus, "list");
  press(state, tasks, ["j"]);
  assert.equal(state.selected, 2);
  assert.equal(state.scroll, 0, "a new task starts at the top");
});

// ── Rendering ────────────────────────────────────────────────────────────

test("the header shows slug, goal, branch, running/max, spend against budget, and models once", () => {
  const crew = crewOf([task(1, { cost: 2.5 }), task(2, { status: "submitted", cost: 2.5 })], { reviewerModel: { provider: "q", model: "reviewer" } });
  const [line1, line2, line3] = render(crew, initialPanel(crew));
  assert.match(line1, /Crew demo-ab12 active · Add a lazygit-like theme/);
  assert.match(line2, /crew\/demo-ab12 · 1\/3 running · \$5\.00\/\$10\.00 █████░░░░░/);
  assert.equal(line3.trim(), "worker p/worker · reviewer q/reviewer");
  const same = crewOf([]);
  assert.match(render(same, initialPanel(same))[2], /reviewer same/);
});

test("the budget bar warns near the budget and errors past it", () => {
  const near = crewOf([task(1, { cost: 8 })]);
  assert.match(render(near, initialPanel(near), 120, 30, toned)[1], /<warning>████████<\/warning>/);
  const over = crewOf([task(1, { cost: 12 })]);
  assert.match(render(over, initialPanel(over), 120, 30, toned)[1], /<error>██████████<\/error>/);
});

test("rows show glyph, id, kind, title, elapsed, cost, and live activity", () => {
  const crew = crewOf([task(1, { status: "integrated", endedAt: NOW - 30_000 }), task(2, { kind: "review", reviewOf: 1 })]);
  const lines = render(crew, initialPanel(crew), 140);
  const row = (id: number) => lines.find((l) => l.startsWith("│") && l.includes(`#${id} `))!;
  const row1 = row(1);
  assert.match(row1, /● #1 impl task 1 +1m00s +\$0\.25 +integrated/);
  const row2 = row(2);
  assert.match(row2, /▸⠋ #2 rev +task 2 +1m30s +\$0\.25 +read file2\.ts/);
  // Every column still fits at the narrowest side-by-side width.
  const narrow = render(crew, initialPanel(crew), 100).find((l) => l.startsWith("│") && l.includes("#1 "))!;
  assert.match(narrow, /● #1 impl task 1 +1m00s +\$0\.25 +integrat/);
});

test("quiet running tasks are coloured in the list and the overview", () => {
  const crew = crewOf([task(1, { lastEventAt: NOW - 2 * 60_000 }), task(2, { lastEventAt: NOW - 11 * 60_000 })]);
  const state = initialPanel(crew);
  const lines = render(crew, state, 140, 30, toned);
  const row = (id: number) => lines.find((l) => l.includes(`<accent>#${id}</accent> <muted>impl </muted>`))!;
  assert.match(row(1), /<warning>quiet 2m · read f[^<]*<\/warning>/);
  assert.match(row(2), /<error>quiet 11m · read [^<]*<\/error>/);
  assert.match(screen(lines), /last event +<\/muted><error>11m00s ago \(quiet 11m\)/);
});

test("at 80 columns the panes stack and nothing overflows; at 120 they sit side by side", () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, {
    title: `a long task title that will not fit in the list ${i}`, activity: "bash node --test pi/extensions/crew/some/really/long/path.test.ts",
    report: report(), acceptance: ["a very long acceptance criterion that has to wrap onto more than one line at eighty columns"],
  }));
  const crew = crewOf(tasks);
  for (const width of [60, 80, 99]) {
    const state = initialPanel(crew);
    for (const tab of ["1", "2", "3", "4", "5"]) {
      press(state, tasks, [tab]);
      const lines = render(crew, state, width, 30);
      for (const line of lines) assert.ok(plain.width(line) <= width, `${width} cols, tab ${tab}: ${line}`);
      assert.equal(lines.length, 30);
      const listTop = lines.findIndex((l) => l.startsWith("┌─ Tasks"));
      const detailTop = lines.findIndex((l) => l.startsWith("┌─ #"));
      assert.ok(listTop >= 0 && detailTop > listTop, `stacked at ${width}`);
    }
  }
  const wide = render(crew, initialPanel(crew), 120);
  assert.ok(wide.some((l) => l.startsWith("┌─ Tasks") && l.includes("┐┌─ #12")), "side by side at 120");
  for (const line of wide) assert.ok(plain.width(line) <= 120);
});

test("the list keeps the selection on screen", () => {
  const tasks = Array.from({ length: 30 }, (_, i) => task(i + 1, { status: "submitted" }));
  const crew = crewOf(tasks);
  const state = initialPanel(crew);
  assert.equal(state.selected, 30);
  assert.ok(render(crew, state).some((l) => l.includes("▸✓ #30")));
  press(state, tasks, ["g"]);
  assert.ok(render(crew, state).some((l) => l.includes("▸✓ #1 ")));
});

test("ctrl+o zooms the details to the full panel", () => {
  const crew = crewOf([task(1)]);
  const state = initialPanel(crew);
  press(state, crew.tasks, [key("zoom")]);
  const lines = render(crew, state, 120);
  assert.ok(!lines.some((l) => l.includes("Tasks")));
  assert.ok(lines.some((l) => l.startsWith("┌─ #1") && l.length === 120));
  press(state, crew.tasks, [key("escape")]);
  assert.ok(!state.zoom, "esc unzooms before it closes");
});

test("the overview shows status, model, branch, base, worktree, session, timings, cost, paths, and acceptance", () => {
  const crew = crewOf([task(1, { paths: ["src/", "test/"], acceptance: ["themes load"], checks: ["npm test"], session: "/git/pi-crew/demo/t1.jsonl" })]);
  const text = screen(render(crew, initialPanel(crew)));
  for (const want of [/status +running/, /model +p\/worker/, /branch +crew\/demo-t1/, /base +bbbbbbbbbbbb /, /worktree +\/wt\/crew-demo-t1/,
    /session +\/git\/pi-crew\/demo\/t1\.jsonl/,
    /time +1m30s elapsed/, /last event +1s ago/, /cost +\$0\.25 · 3 tools/, /activity +read file1\.ts/, /paths +src\/, test\//,
    /checks +npm test/, /- themes load/]) assert.match(text, want);
});

test("the handoff tab separates the worker's claims from the harness's observations", () => {
  const crew = crewOf([task(1, { status: "submitted", endedAt: NOW, report: report() })]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["3"]);
  const text = screen(render(crew, state, 120, 50));
  const claims = text.indexOf("Worker's claims");
  const observed = text.indexOf("Observed by the harness");
  assert.ok(claims >= 0 && observed > claims);
  const before = text.slice(claims, observed);
  const after = text.slice(observed);
  for (const want of ["added the theme", "colours untested", "renamed a file", "add a toggle"]) assert.ok(before.includes(want), want);
  for (const want of ["abc1234 add theme", "theme.ts | 3 +++", "README.md", "yes: the worker left uncommitted changes", "package-lock.json"]) {
    assert.ok(after.includes(want), want);
  }
});

test("the handoff tab explains a missing handoff and shows the worker's last output", () => {
  const crew = crewOf([task(1, { status: "failed", report: report({ handoff: undefined, parseError: "no ```handoff block", partial: "I got stuck" }) }), task(2)]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["3"]);
  assert.match(screen(render(crew, state)), /Still running; the handoff arrives/);
  press(state, crew.tasks, ["k"]);
  const text = screen(render(crew, state));
  assert.match(text, /No parseable handoff: no ```handoff block/);
  assert.match(text, /I got stuck/);
});

test("checks show pass, fail, and timeout; failing output starts open and enter toggles it", () => {
  const r = report({ checks: [...report().checks, { command: "npm run slow", exit: null, tail: "", timedOut: true }] });
  const crew = crewOf([task(1, { status: "submitted", checks: ["npm test", "npm run lint", "npm run slow"], report: r })]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["4"]);
  let text = screen(render(crew, state));
  assert.match(text, /▸ PASS +npm test/);
  assert.match(text, /▾ FAIL 1 +npm run lint/);
  assert.match(text, /lint: bad    indent/, "output is cleaned and open");
  assert.match(text, /▾ TIMEOUT npm run slow/);
  assert.ok(!text.includes("all good"), "passing output starts closed");
  press(state, crew.tasks, [key("enter"), key("enter")]);
  text = screen(render(crew, state));
  assert.match(text, /›▾ PASS +npm test/);
  assert.ok(text.includes("all good"));
  press(state, crew.tasks, ["j", key("enter")]);
  assert.ok(!screen(render(crew, state)).includes("lint: bad"));
  assert.match(text, /left uncommitted changes.*\n.*package-lock\.json/);
});

test("checks of a running task are pending; a review has none", () => {
  const crew = crewOf([task(1, { checks: ["npm test"] }), task(2, { kind: "review", reviewOf: 1 })]);
  const state = initialPanel(crew);
  press(state, crew.tasks, ["4"]);
  assert.match(screen(render(crew, state)), /Review tasks run no checks/);
  press(state, crew.tasks, ["k"]);
  assert.match(screen(render(crew, state)), /PENDING npm test/);
});

test("the diff tab colours the diff, and a review shows the diff of the task it reviews", () => {
  const reviewed = task(1, { status: "submitted", base: "1".repeat(40), branch: "crew/demo-t1" });
  // A ledger review may lack its own branch fields; the target task's are what count.
  const review = task(2, { kind: "review", reviewOf: 1, base: undefined, branch: undefined });
  const crew = crewOf([reviewed, review]);
  assert.deepEqual(diffTarget(crew, review), { base: "1".repeat(40), branch: "crew/demo-t1" });
  assert.deepEqual(diffTarget(crew, task(3, { kind: "review", reviewOf: 9 })), { message: "Reviewed task #9 is not in the ledger" });

  const asked: number[] = [];
  const deps: RenderDeps = {
    frame: 0,
    diff: (t): DiffView => {
      asked.push(t.id);
      return { state: "ready", range: "1111111111..crew/demo-t1", lines: ["diff --git a/x b/x", "@@ -1 +1 @@", "-old", "+new", " same"] };
    },
  };
  const state = initialPanel(crew);
  render(crew, state, 120, 30, toned, deps);
  assert.deepEqual(asked, [], "no diff is loaded until the Diff tab is shown");
  press(state, crew.tasks, ["5"]);
  const text = screen(render(crew, state, 120, 30, toned, deps));
  assert.deepEqual(asked, [2]);
  assert.match(text, /git diff 1111111111\.\.crew\/demo-t1 \(task #1, under review\)/);
  assert.match(text, /<accent>@@ -1 \+1 @@<\/accent>/);
  assert.match(text, /<error>-old<\/error>/);
  assert.match(text, /<success>\+new<\/success>/);
});

// ── Diff cache ───────────────────────────────────────────────────────────

test("diffs load lazily and are cached per branch tip", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "crew-panel-")));
  const run = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(join(root, "a.txt"), "one\n");
  run("add", ".");
  run("commit", "-qm", "init");
  const base = run("rev-parse", "HEAD").trim();
  run("checkout", "-qb", "crew/demo-t1");
  writeFileSync(join(root, "a.txt"), "two\n");
  run("commit", "-qam", "two");

  const calls: string[][] = [];
  const cache = new DiffCache((cwd, args) => { calls.push(args); return git(cwd, args); }, 1_000_000, 1_000);
  let changed = 0;
  const get = (now: number) => cache.get(1, root, base, "crew/demo-t1", () => { changed++; }, now);
  const settle = async (n: number) => { while (changed < n) await new Promise((r) => setTimeout(r, 5)); };

  assert.deepEqual(get(0), { state: "loading" });
  await settle(1);
  const view = get(10);
  assert.equal(view.state, "ready");
  assert.ok(view.state === "ready" && view.lines.includes("-one") && view.lines.includes("+two"));
  assert.equal(calls.filter((c) => c[0] === "diff").length, 1);
  assert.equal(calls.length, 2, "nothing reruns before the recheck interval");

  // Same tip: the recheck is one rev-parse, not another diff.
  get(2_000);
  await settle(2);
  assert.equal(calls.filter((c) => c[0] === "diff").length, 1);

  // A new commit moves the tip, so the diff is recomputed.
  writeFileSync(join(root, "a.txt"), "three\n");
  run("commit", "-qam", "three");
  get(4_000);
  await settle(3);
  const next = get(4_010);
  assert.ok(next.state === "ready" && next.lines.includes("+three"));
  assert.equal(calls.filter((c) => c[0] === "diff").length, 2);

  run("checkout", "-q", "main");
  run("branch", "-D", "crew/demo-t1");
  get(6_000);
  await settle(4);
  assert.deepEqual(get(6_010), { state: "unavailable", message: "Branch crew/demo-t1 no longer exists (removed by /crew-clean?)" });
});
