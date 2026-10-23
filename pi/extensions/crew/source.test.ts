import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { testStyle } from "../run-panel/fixture.ts";
import { input, type Command, type PanelInput } from "../run-panel/input.ts";
import { render as renderPanel } from "../run-panel/render.ts";
import { initialState } from "../run-panel/state.ts";
import { git } from "./git.ts";
import type { TaskReport } from "./handoff.ts";
import { crewSource, DiffCache, diffTarget, quiet, type CrewSourceDeps, type DiffView } from "./source.ts";
import type { CrewState, TaskRecord } from "./state.ts";
import { Transcript, type TranscriptView } from "./transcript.ts";

// The crew as a source: what each tab says about a task, and when the actions apply. Layout,
// keys, filtering, and scrolling are the presenter's, tested in run-panel/presenter.test.ts.

const plain = testStyle(false);
const toned = testStyle(true);
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

const loading = { get: (): never => ({ state: "loading" }) as never };

function panel(crew: CrewState, over: Partial<CrewSourceDeps> = {}) {
  const log: string[] = [];
  const source = crewSource(() => crew, {
    live: () => true,
    cancel: (id) => { log.push(`cancel ${id}`); return true; },
    streamed: () => undefined,
    copyPath: async (path) => `Copied ${path}`,
    exportSession: async () => {},
    exporting: new Set(),
    fileExists: () => true,
    diffs: () => loading,
    sessions: () => loading,
    now: () => NOW,
    ...over,
  });
  const state = initialState(source);
  const render = (width = 120, height = 30, s = plain) => renderPanel(source, state, NOW, width, height, s, { frame: 0 }).lines;
  const screen = (width?: number, height?: number, s?: typeof plain) => render(width, height, s).join("\n");
  const press = (...inputs: (PanelInput | string)[]): Command<TaskRecord> | undefined => {
    let command: Command<TaskRecord> | undefined;
    for (const i of inputs) command = input(state, source, typeof i === "string" ? { char: i } : i);
    return command;
  };
  return { source, state, render, screen, press, log };
}

const key = (k: Extract<PanelInput, { key: unknown }>["key"]): PanelInput => ({ key: k });
const ran = (command: Command<TaskRecord> | undefined) => (command?.type === "run" ? `${command.action.id} ${command.item.id}` : command?.type);

// ── Formatting ───────────────────────────────────────────────────────────

test("a quiet running task shows quiet time: warning past 60s, error past stallMin", () => {
  assert.equal(quiet(task(1, { lastEventAt: NOW - 60_000 }), NOW, 10), undefined);
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 125_000 }), NOW, 10), { text: "quiet 2m", tone: "warning" });
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 10 * 60_000 }), NOW, 10), { text: "quiet 10m", tone: "error" });
  assert.deepEqual(quiet(task(1, { lastEventAt: NOW - 61 * 60_000 }), NOW, 120), { text: "quiet 1h01m", tone: "warning" });
  // A finished task is never quiet, however old its last event.
  assert.equal(quiet(task(1, { status: "submitted", lastEventAt: 0 }), NOW, 10), undefined);
});

// ── Items ────────────────────────────────────────────────────────────────

test("the filter matches title, id, status, kind, and branch, one field at a time", () => {
  const p = panel(crewOf([
    task(1, { title: "Add dark theme", status: "integrated" }),
    task(2, { title: "Fix widget wrap", kind: "review", reviewOf: 1 }),
    task(3, { title: "Write README", branch: "crew/demo-docs" }),
  ]));
  const shown = (q: string) => {
    p.state.query = q;
    return p.render().filter((l) => /[▸ ]\S #\d/.test(l)).map((l) => /#(\d)/.exec(l)![1]);
  };
  assert.deepEqual(shown("drkthm"), ["1"]);
  assert.deepEqual(shown("#3"), ["3"]);
  assert.deepEqual(shown("integ"), ["1"]);
  assert.deepEqual(shown("review"), ["2"]);
  assert.deepEqual(shown("docs"), ["3"]);
  assert.deepEqual(shown("running fix"), ["2"]);
  // Letters scattered across the title and the branch don't match.
  assert.deepEqual(shown("wrdocs"), []);
});

test("the header shows slug, goal, branch, running/max, spend against budget, and models once", () => {
  const crew = crewOf([task(1, { cost: 2.5 }), task(2, { status: "submitted", cost: 2.5 })], { reviewerModel: { provider: "q", model: "reviewer" } });
  const [line1, line2, line3] = panel(crew).render();
  assert.match(line1, /^╭─ Crew demo-ab12 active · Add a lazygit-like theme/);
  assert.match(line2, /crew\/demo-ab12 · 1\/3 running · \$5\.00\/\$10\.00 █████░░░░░/);
  assert.match(line3, /^│ worker p\/worker · reviewer q\/reviewer +│$/);
  assert.match(panel(crewOf([])).render()[2], /reviewer same/);
  assert.match(panel(crewOf([task(1, { cost: 12 })])).render(120, 30, toned)[1], /<error>██████████<\/error>/);
});

test("rows show glyph, id, kind, title, elapsed, cost, and live activity", () => {
  const crew = crewOf([task(1, { status: "integrated", endedAt: NOW - 30_000 }), task(2, { kind: "review", reviewOf: 1 })]);
  const lines = panel(crew).render(140);
  const row = (id: number) => lines.find((l) => l.startsWith("││") && l.includes(`#${id} `))!;
  assert.match(row(1), /● #1 impl task 1 +1m00s +\$0\.25 +integrated/);
  assert.match(row(2), /▸⠋ #2 rev +task 2 +1m30s +\$0\.25 +read file2\.ts/);
  // Every column still fits at the narrowest side-by-side width.
  const narrow = panel(crew).render(100).find((l) => l.startsWith("││") && l.includes("#1 "))!;
  assert.match(narrow, /● #1 impl task 1 +1m00s +\$0\.25 +integrat/);
});

test("quiet running tasks are coloured in the list and the overview", () => {
  const p = panel(crewOf([task(1, { lastEventAt: NOW - 2 * 60_000 }), task(2, { lastEventAt: NOW - 11 * 60_000 })]));
  const lines = p.render(140, 30, toned);
  const row = (id: number) => lines.find((l) => l.includes(`<accent>#${id}</accent> <syntaxVariable>impl</syntaxVariable>`))!;
  assert.match(row(1), /<warning>quiet 2m · read f[^<]*<\/warning>/);
  assert.match(row(2), /<error>quiet 11m · read [^<]*<\/error>/);
  assert.match(lines.join("\n"), /last event +<\/muted><error>11m00s ago \(quiet 11m\)/);
});

// ── Views ────────────────────────────────────────────────────────────────

test("the overview shows status, model, branch, base, worktree, session, timings, cost, paths, and acceptance", () => {
  const p = panel(crewOf([task(1, { paths: ["src/", "test/"], acceptance: ["themes load"], checks: ["npm test"], session: "/git/pi-crew/demo/t1.jsonl" })]));
  const text = p.screen();
  for (const want of [/status +running/, /model +p\/worker/, /branch +crew\/demo-t1/, /base +bbbbbbbbbbbb /, /worktree +\/wt\/crew-demo-t1/,
    /session +\/git\/pi-crew\/demo\/t1\.jsonl/,
    /time +1m30s elapsed/, /last event +1s ago/, /cost +\$0\.25 · 3 tools/, /activity +read file1\.ts/, /paths +src\/, test\//,
    /checks +npm test/, /- themes load/]) assert.match(text, want);
  assert.match(panel(crewOf([task(1)])).screen(), /acceptance *│*\n.* {2}none/);
});

test("the handoff tab separates the worker's claims from the harness's observations", () => {
  const p = panel(crewOf([task(1, { status: "submitted", endedAt: NOW, report: report() })]));
  p.press("3");
  const text = p.screen(120, 50);
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
  const p = panel(crewOf([task(1, { status: "failed", report: report({ handoff: undefined, parseError: "no ```handoff block", partial: "I got stuck" }) }), task(2)]));
  p.press("3");
  assert.match(p.screen(), /Still running; the handoff arrives/);
  p.press("k");
  const text = p.screen();
  assert.match(text, /No parseable handoff: no ```handoff block/);
  assert.match(text, /I got stuck/);
});

test("checks show pass, fail, and timeout; failing output starts open and enter toggles it", () => {
  const r = report({ checks: [...report().checks, { command: "npm run slow", exit: null, tail: "", timedOut: true }] });
  const p = panel(crewOf([task(1, { status: "submitted", checks: ["npm test", "npm run lint", "npm run slow"], report: r })]));
  p.press("4");
  let text = p.screen();
  assert.match(text, /▸ PASS +npm test/);
  assert.match(text, /▾ FAIL 1 +npm run lint/);
  assert.match(text, /lint: bad    indent/, "output is cleaned and open");
  assert.match(text, /▾ TIMEOUT npm run slow/);
  assert.ok(!text.includes("all good"), "passing output starts closed");
  assert.match(text, /left uncommitted changes[^]*- package-lock\.json/);
  p.press(key("enter"), key("enter"));
  text = p.screen();
  assert.match(text, /›▾ PASS +npm test/);
  assert.ok(text.includes("all good"));
  p.press("j", key("enter"));
  assert.ok(!p.screen().includes("lint: bad"));
});

test("checks of a running task are pending; a review has none; none declared says so", () => {
  const p = panel(crewOf([task(1, { checks: ["npm test"] }), task(2, { kind: "review", reviewOf: 1 }), task(3, { status: "submitted" })]));
  p.press("4");
  assert.match(p.screen(), /Review tasks run no checks/);
  p.press("k");
  assert.match(p.screen(), / {2}PENDING npm test/);
  p.press("G");
  assert.match(p.screen(), /No checks declared: the work is unverified/);
});

test("the diff tab colours the diff, and a review shows the diff of the task it reviews", () => {
  const reviewed = task(1, { status: "submitted", base: "1".repeat(40), branch: "crew/demo-t1" });
  // A ledger review may lack its own branch fields; the target task's are what count.
  const review = task(2, { kind: "review", reviewOf: 1, base: undefined, branch: undefined });
  const crew = crewOf([reviewed, review]);
  assert.deepEqual(diffTarget(crew, review), { base: "1".repeat(40), branch: "crew/demo-t1" });
  assert.deepEqual(diffTarget(crew, task(3, { kind: "review", reviewOf: 9 })), { message: "Reviewed task #9 is not in the ledger" });
  assert.deepEqual(diffTarget(crew, task(3, { branch: undefined })), { message: "The worktree is still being set up" });

  const asked: [number, string][] = [];
  const diffs = {
    get: (id: number, _root: string, _base: string, branch: string): DiffView => {
      asked.push([id, branch]);
      return { state: "ready", range: "1111111111..crew/demo-t1", lines: ["diff --git a/x b/x", "@@ -1 +1 @@", "-old", "+new", " same"] };
    },
  };
  const p = panel(crew, { diffs: () => diffs });
  p.render(120, 30, toned);
  assert.deepEqual(asked, [], "no diff is loaded until the Diff tab is shown");
  p.press("5");
  const text = p.screen(130, 30, toned);
  assert.deepEqual(asked, [[2, "crew/demo-t1"]]);
  assert.match(text, /git diff 1111111111\.\.crew\/demo-t1 \(task #1, under review\)/);
  assert.match(text, /<accent>@@ -1 \+1 @@<\/accent>/);
  assert.match(text, /<error>-old<\/error>/);
  assert.match(text, /<success>\+new<\/success>/);

  const other = panel(crewOf([task(1)]), { diffs: () => ({ get: () => ({ state: "unavailable", message: "Branch gone" }) }) });
  other.press("5");
  assert.match(other.screen(120, 30, toned), /<warning>Branch gone<\/warning>/);
  const pending = panel(crewOf([task(1)]));
  pending.press("5");
  assert.match(pending.screen(), /Loading diff…/);
});

/** A worker that read a file and printed `lines` lines of text. */
function streamed(lines = 0): Transcript {
  const t = new Transcript();
  t.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read", arguments: { path: "theme.ts" } }] } });
  t.applyEvent({ type: "tool_execution_end", toolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "src" }] } });
  if (lines) t.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: Array.from({ length: lines }, (_, i) => `out ${i}`).join("\n") }] } });
  return t;
}

test("the live tab prefers the stream, else reads the session file, and says why there is none", () => {
  const live = panel(crewOf([task(1)]), { streamed: () => streamed() });
  live.press("6");
  let text = live.screen();
  assert.match(live.screen(120, 30, toned), /<accent> 6 Live <\/accent>/);
  assert.match(text, /streaming from the worker/);
  assert.match(text, /✓ read theme\.ts/);
  assert.match(text, /following/);

  const done = panel(crewOf([task(1, { status: "submitted" })]), { streamed: () => streamed() });
  done.press("6");
  assert.match(done.screen(), /as streamed in this session/);

  const paths: string[] = [];
  const file: TranscriptView = { state: "ready", transcript: streamed(), source: "file" };
  const fromFile = panel(crewOf([task(1, { status: "submitted", session: "/s/t1.jsonl" })]), {
    sessions: () => ({ get: (path: string) => { paths.push(path); return file; } }),
  });
  fromFile.press("6");
  assert.match(fromFile.screen(), /from the session file, updated as messages finish/);
  assert.deepEqual(paths, ["/s/t1.jsonl"]);

  const old = panel(crewOf([task(1, { status: "submitted" })]));
  old.press("6");
  assert.match(old.screen(), /No transcript: this task started before workers recorded/);

  const pending = panel(crewOf([task(1, { session: "/s/t1.jsonl" })]));
  pending.press("6");
  assert.match(pending.screen(), /Loading the transcript…/);
});

test("the live tab follows the stream", () => {
  const t = streamed(100);
  const p = panel(crewOf([task(1)]), { streamed: () => t });
  p.press("6", key("enter"));
  assert.match(p.screen(), /out 99/);
  p.press("k");
  t.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "newest" }] } });
  assert.doesNotMatch(p.screen(), /newest/);
  p.press("G");
  assert.match(p.screen(), /newest/);
});

test("dispose drops the diff and session caches", () => {
  let made = 0;
  const p = panel(crewOf([task(1)]), { diffs: () => { made++; return loading; } });
  assert.equal(made, 1);
  p.source.dispose!();
  assert.equal(made, 2);
});

// ── Actions ──────────────────────────────────────────────────────────────

test("x asks before cancelling a running task in a live crew; anything but y keeps it", () => {
  let live = true;
  const p = panel(crewOf([task(1, { status: "submitted" }), task(2, { title: "paint it" })]), { live: () => live });
  assert.equal(ran(p.press("x")), "none");
  assert.match(p.screen(), /Cancel #2 "paint it"\? Its worktree is kept\. y to cancel/);
  assert.equal(ran(p.press("n")), "none");
  assert.deepEqual(p.log, []);
  assert.equal(ran(p.press("x", "y")), "cancel 2");

  p.press("k", "x");
  assert.equal(p.state.confirm, undefined);
  assert.match(p.state.flash!.text, /#1 is not running/);
  live = false;
  p.press("j", "x");
  assert.equal(p.state.confirm, undefined);
  assert.match(p.state.flash!.text, /isn't running in this session/);
});

test("cancel says whether there was a worker to stop", async () => {
  const cancel = (stopped: boolean) => {
    const p = panel(crewOf([task(1)]), { cancel: () => stopped });
    return p.source.actions.find((a) => a.id === "cancel")!.run(p.source.items()[0].value, { flash() {} });
  };
  assert.deepEqual(await cancel(true), { flash: "Cancelling #1; its handoff will wake the planner", tone: "warning" });
  assert.deepEqual(await cancel(false), { flash: "#1 is no longer running", tone: "dim" });
});

test("o copies the worktree path, showing it at once; a task without one says so", async () => {
  const p = panel(crewOf([task(1, { worktree: undefined }), task(2)]));
  p.press("o");
  const command = p.press("o");
  assert.equal(ran(command), "open 2");
  const flashes: string[] = [];
  if (command?.type === "run") {
    const result = await command.action.run(command.item.value, { flash: (text) => flashes.push(text) });
    assert.deepEqual(flashes, ["/wt/crew-demo-t2"]);
    assert.deepEqual(result, { flash: "Copied /wt/crew-demo-t2", tone: "accent" });
  }
  p.press("k", "o");
  assert.match(p.state.flash!.text, /#1 has no worktree/);
});

test("e exports a task's session next to it, or explains why it can't", async () => {
  const exporting = new Set<string>();
  const calls: [string, string][] = [];
  let fail = false;
  const exists = new Set(["/s/t1.jsonl"]);
  const p = panel(crewOf([task(1, { session: "/s/t1.jsonl" }), task(2, { session: "/s/t2.jsonl" }), task(3)]), {
    exporting,
    fileExists: (path) => exists.has(path),
    exportSession: async (session, output) => { calls.push([session, output]); if (fail) throw new Error("pi exploded"); },
  });
  p.press("e");
  assert.match(p.state.flash!.text, /#3 has no session file: it started before sessions were recorded/);
  p.press("k", "e");
  assert.match(p.state.flash!.text, /#2 has no session file yet/);
  const command = p.press("k", "e");
  assert.equal(ran(command), "export 1");
  if (command?.type !== "run") return;
  const flashes: string[] = [];
  const pending = command.action.run(command.item.value, { flash: (text) => flashes.push(text) });
  assert.deepEqual(flashes, ["Exporting #1…"]);
  p.press("e");
  assert.match(p.state.flash!.text, /#1 is already being exported/);
  assert.deepEqual(await pending, { flash: "Exported #1 to /s/t1.html", tone: "success" });
  assert.deepEqual(calls, [["/s/t1.jsonl", "/s/t1.html"]]);
  assert.equal(exporting.size, 0);
  fail = true;
  assert.deepEqual(await command.action.run(command.item.value, { flash() {} }), { flash: "Export of #1 failed: pi exploded", tone: "error" });
  assert.equal(exporting.size, 0);
});

test("help lists the crew's tabs and actions", () => {
  const p = panel(crewOf([task(1)]));
  p.press("?");
  const text = p.screen(80, 40);
  assert.match(text, /overview, spec, handoff, checks, diff, live/);
  assert.match(text, /x +cancel the selected running task \(asks first\)/);
  assert.match(text, /o +copy the worktree path/);
  assert.match(text, /e +export the worker's session to HTML/);
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
