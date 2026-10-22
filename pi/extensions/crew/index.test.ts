import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fakePi } from "../test-support/fake-pi.ts";

// Worktrees go under $HOME/git/worktrees; keep them out of the real home.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), "crew-home-")));
process.env.HOME = HOME;
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";

// After fake-pi registers its module stubs.
const { default: crewExtension } = await import("./index.ts");

const WRITE = ["read", "grep", "find", "ls", "edit", "write", "bash"];
const READ = ["read", "grep", "find", "ls"];
const CREW = ["crew_dispatch", "crew_integrate", "crew_status", "crew_cancel", "crew_wake", "crew_finish"];

let counter = 0;
function makeRepo() {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "crew-idx-"))), `proj${counter++}`);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(join(root, "a.txt"), "one\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
  return root;
}
const commitIn = (cwd: string, file: string, content: string) => {
  mkdirSync(join(cwd, file, ".."), { recursive: true });
  writeFileSync(join(cwd, file), content);
  execFileSync("git", ["-C", cwd, "add", "."]);
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", `edit ${file}`]);
};

const HANDOFF = "done it\n```handoff\n{\"status\":\"done\",\"summary\":\"did the thing\"}\n```";
const result = (status = "ok", text = HANDOFF, cost = 0) => ({
  status, text, error: null,
  progress: { toolCalls: 0, activity: "", phase: "tool", usage: { input: 0, output: 0, cost }, lastEventAt: Date.now() },
});

/** A controllable stand-in for runWorker: each call waits until the test finishes it, or is aborted. */
function workers(ignoreAbort = false) {
  const list: { job: any; opts: any; finish: (r: any) => void }[] = [];
  const run = (job: any, opts: any) => new Promise<any>((resolve) => {
    list.push({ job, opts, finish: resolve });
    if (!ignoreAbort) opts.signal.addEventListener("abort", () => resolve(result("cancelled", "")), { once: true });
  });
  return { list, run };
}

async function waitFor(cond: () => boolean, what: string) {
  for (let i = 0; i < 750; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function boot(root: string, opts: { concurrency?: string; budget?: string; ignoreAbort?: boolean } = {}) {
  const w = workers(opts.ignoreAbort);
  const f = fakePi();
  crewExtension(f.pi, { runWorker: w.run as any });
  f.pi.setActiveTools([...f.active(), "read", "bash", "edit", "write"]);
  const ui = {
    notify: (t: string) => { f.notes.push(t); },
    setStatus() {}, setWidget() {},
    select: async (title: string, options: string[]) => (title.startsWith("Max concurrent") ? opts.concurrency ?? "3" : options[0]),
    input: async () => opts.budget ?? "10",
    editor: async () => undefined,
    confirm: async () => true,
  };
  const ctx = f.ctx(root, { ui, modelRegistry: { getAvailable: () => [{ provider: "p", id: "m" }] } });
  const handoffs = () => f.sent.filter((s) => s.message.customType === "crew-handoff");
  const ledger = async () => (await f.tool("crew_status", {})).content[0].text as string;
  const dispatch = async (params: Record<string, unknown> = {}) =>
    (await f.tool("crew_dispatch", { kind: "implement", title: "do it", spec: "spec", ...params })).content[0].text as string;
  const shutdown = () => f.emit("session_shutdown", {}, ctx);
  return { f, w, ctx, root, handoffs, ledger, dispatch, shutdown };
}

async function started(opts: Parameters<typeof boot>[1] = {}) {
  const root = makeRepo();
  const e = boot(root, opts);
  await e.f.emit("session_start", {}, e.ctx);
  await e.f.command("crew", "build thing", e.ctx);
  assert.ok(e.f.sent.length, `crew started: ${e.f.notes.join("; ")}`);
  const slug = /Crew (\S+) \(/.exec(await e.ledger())![1];
  const stateFile = join(root, ".git", "pi-crew", `${slug}.json`);
  const integ = join(HOME, "git", "worktrees", basename(root), `crew-${slug}`.replaceAll("/", "-"));
  return { ...e, slug, stateFile, integ, state: () => JSON.parse(readFileSync(stateFile, "utf8")) };
}

/** Run a test body and always shut the extension down so no timers outlive it. */
const crewTest = (name: string, body: (e: Awaited<ReturnType<typeof started>>) => Promise<void>, opts: Parameters<typeof boot>[1] = {}) =>
  // A broken drain or abort hangs rather than fails; bound it so the suite reports it.
  test(name, { timeout: 20_000 }, async () => {
    const e = await started(opts);
    try { await body(e); } finally {
      for (const worker of e.w.list) worker.finish(result("cancelled", ""));
      await e.shutdown();
    }
  });

const finishOk = async (e: Awaited<ReturnType<typeof started>>, n: number, before?: (cwd: string) => void) => {
  const worker = e.w.list[n - 1];
  before?.(worker.job.cwd);
  worker.finish(result());
  await waitFor(() => e.handoffs().length >= n, `handoff #${n}`);
  return e.handoffs()[n - 1].message.content as string;
};

// ---- planner mode ----------------------------------------------------------

crewTest("starting a crew shows the planner prompt, wakes the planner, and limits it to read and crew tools", async (e) => {
  const start = e.f.sent[0];
  assert.equal(start.message.customType, "crew-start");
  assert.match(start.message.content, /You are the PLANNER/);
  assert.match(start.message.content, /build thing/);
  assert.equal(start.options?.triggerTurn, true);
  assert.deepEqual([...e.f.active()].sort(), [...READ, ...CREW].sort());
});

test("crew tools are hidden until a crew starts, and the tools come back after /crew-stop", async () => {
  const root = makeRepo();
  const e = boot(root);
  try {
    await e.f.emit("session_start", {}, e.ctx);
    for (const t of CREW) assert.ok(!e.f.active().includes(t), `${t} hidden outside crew mode`);
    assert.ok(e.f.active().includes("bash"));
    await e.f.command("crew", "goal two", e.ctx);
    assert.ok(e.f.active().includes("crew_dispatch"));
    assert.ok(!e.f.active().includes("bash"));
    await e.f.command("crew-stop", "", e.ctx);
    assert.ok(e.f.active().includes("bash") && e.f.active().includes("edit"));
    for (const t of CREW) assert.ok(!e.f.active().includes(t));
  } finally {
    await e.shutdown();
  }
});

// ---- dispatch --------------------------------------------------------------

crewTest("a dispatched implement worker runs in its own worktree with the guard and write tools", async (e) => {
  const text = await e.dispatch();
  assert.match(text, /Dispatched #1/);
  const job = e.w.list[0].job;
  assert.equal(job.cwd, join(HOME, "git", "worktrees", basename(e.root), `crew-${e.slug}-t1`));
  assert.ok(existsSync(join(job.cwd, "a.txt")));
  assert.notEqual(job.cwd, e.root);
  assert.deepEqual(job.tools, WRITE);
  assert.ok(job.extensions.some((x: string) => x.endsWith("guard.ts")), "guard extension loaded");
  assert.equal(job.env.PI_CREW_ROOT, job.cwd);
  assert.equal(job.provider, "p");
  assert.equal(job.model, "m");
  // The transcript lives beside the ledger, outside the worktree, so /crew-clean keeps it.
  assert.equal(job.session, join(e.root, ".git", "pi-crew", e.slug, "t1.jsonl"));
  assert.ok(existsSync(dirname(job.session)), "session directory created");
  assert.equal(e.state().tasks[0].session, job.session);
});

crewTest("dispatch refuses beyond the concurrency limit", async (e) => {
  await e.dispatch();
  await assert.rejects(e.dispatch({ title: "two" }), /1 workers already running/);
  assert.equal(e.w.list.length, 1);
}, { concurrency: "1" });

crewTest("dispatch refuses once the budget is spent", async (e) => {
  await e.dispatch();
  const worker = e.w.list[0];
  worker.opts.onProgress({ toolCalls: 3, activity: "busy", usage: { input: 0, output: 0, cost: 2 }, lastEventAt: Date.now() });
  await assert.rejects(e.dispatch({ title: "two" }), /Budget exhausted/);
  assert.equal(e.w.list.length, 1);
}, { budget: "1" });

crewTest("a review needs a finished implement task, and runs read-only in that task's worktree", async (e) => {
  await e.dispatch();
  await assert.rejects(e.dispatch({ kind: "review", reviewOf: 1 }), /finished implement task/);
  await assert.rejects(e.dispatch({ kind: "review", reviewOf: 9 }), /finished implement task/);
  await finishOk(e, 1, (cwd) => commitIn(cwd, "b.txt", "b\n"));
  await e.dispatch({ kind: "review", reviewOf: 1, title: "look" });
  const review = e.w.list[1].job;
  assert.deepEqual(review.tools, READ);
  assert.equal(review.cwd, e.w.list[0].job.cwd);
});

// ---- worker reports ----------------------------------------------------------

crewTest("the handoff reports what the harness saw: auto-commit, checks, scope, leftovers", async (e) => {
  await e.dispatch({ checks: ["test -f b.txt", "echo made > gen.txt", "exit 3"], paths: ["src/"] });
  const content = await finishOk(e, 1, (cwd) => writeFileSync(join(cwd, "b.txt"), "b\n"));
  assert.equal(e.handoffs()[0].options?.triggerTurn, true);
  assert.match(content, /did the thing/);
  assert.match(content, /harness committed them/);
  assert.match(content, /PASS: test -f b\.txt/);
  assert.match(content, /FAIL \(exit 3\): exit 3/);
  assert.match(content, /OUTSIDE declared paths:\n- b\.txt/);
  assert.match(content, /checks left uncommitted changes[^\n]*\n- gen\.txt/);
  const log = execFileSync("git", ["-C", e.root, "log", "--format=%s", `crew/${e.slug}-t1`]).toString();
  assert.match(log, /uncommitted changes left by task #1/);
  assert.equal(e.state().tasks[0].status, "submitted");
});

crewTest("cancelling while the harness checks run reports a cancelled task, quietly", async (e) => {
  await e.dispatch({ checks: ["sleep 30"] });
  e.w.list[0].finish(result());
  await e.f.tool("crew_cancel", { taskId: 1 });
  await waitFor(() => e.handoffs().length === 1, "handoff");
  const h = e.handoffs()[0];
  assert.match(h.message.content, /: CANCELLED/);
  assert.match(h.message.content, /cancelled while the harness checks were running/);
  assert.notEqual(h.options?.triggerTurn, true, "a cancel's handoff doesn't wake the planner");
});

crewTest("crew_cancel stops the worker and its handoff doesn't wake the planner", async (e) => {
  await e.dispatch();
  await e.f.tool("crew_cancel", { taskId: 1 });
  assert.equal(e.w.list[0].opts.signal.aborted, true);
  await waitFor(() => e.handoffs().length === 1, "handoff");
  assert.notEqual(e.handoffs()[0].options?.triggerTurn, true);
  assert.match(e.handoffs()[0].message.content, /CANCELLED/);
  await assert.rejects(e.f.tool("crew_cancel", { taskId: 1 }), /not running/);
});

// ---- integrate -----------------------------------------------------------------

crewTest("integrate merges a task's commits and reverts files its checks left in the integration worktree", async (e) => {
  await e.dispatch({ checks: ["echo junk > gen.txt"] });
  await finishOk(e, 1, (cwd) => commitIn(cwd, "b.txt", "b\n"));
  const out = (await e.f.tool("crew_integrate", { taskId: 1 })).content[0].text as string;
  assert.match(out, /Integrated #1/);
  assert.match(out, /harness reverted them: gen\.txt/);
  assert.ok(existsSync(join(e.integ, "b.txt")));
  assert.ok(!existsSync(join(e.integ, "gen.txt")), "leftover reverted");
  assert.match(await e.ledger(), /\[integrated\]/);
  await assert.rejects(e.f.tool("crew_integrate", { taskId: 1 }), /already integrated/);
});

crewTest("a conflicting integrate is reported and the task is marked conflict", async (e) => {
  await e.dispatch({ title: "one" });
  await e.dispatch({ title: "two" });
  await finishOk(e, 1, (cwd) => commitIn(cwd, "a.txt", "from one\n"));
  await finishOk(e, 2, (cwd) => commitIn(cwd, "a.txt", "from two\n"));
  await e.f.tool("crew_integrate", { taskId: 1 });
  const out = (await e.f.tool("crew_integrate", { taskId: 2 })).content[0].text as string;
  assert.match(out, /CONFLICTED/);
  assert.match(out, /- a\.txt/);
  assert.match(await e.ledger(), /#2 implement \[conflict\]/);
});

crewTest("integrate refuses a task with no commits", async (e) => {
  await e.dispatch();
  await finishOk(e, 1);
  await assert.rejects(e.f.tool("crew_integrate", { taskId: 1 }), /no commits to merge/);
});

// ---- finish ---------------------------------------------------------------------

crewTest("crew_finish refuses while workers run", async (e) => {
  await e.dispatch();
  await assert.rejects(e.f.tool("crew_finish", { summary: "s", checks: ["true"] }), /still running/);
  assert.equal(e.state().status, "active");
});

crewTest("crew_finish refuses when a final check fails or dirties the worktree", async (e) => {
  let out = (await e.f.tool("crew_finish", { summary: "s", checks: ["echo boom; exit 2"] })).content[0].text as string;
  assert.match(out, /NOT finished/);
  assert.match(out, /exit 2: echo boom/);
  out = (await e.f.tool("crew_finish", { summary: "s", checks: ["echo x > made.txt"] })).content[0].text as string;
  assert.match(out, /NOT finished/);
  assert.match(out, /modified files in the integration worktree[^\n]*made\.txt/);
  assert.ok(!existsSync(join(e.integ, "made.txt")));
  assert.equal(e.state().status, "active");
});

crewTest("crew_finish with green checks ends crew mode and restores the tools", async (e) => {
  const out = (await e.f.tool("crew_finish", { summary: "all good", checks: ["true"] })).content[0].text as string;
  assert.match(out, /Crew finished/);
  assert.match(out, /all good/);
  assert.equal(e.state().status, "finished");
  assert.ok(e.f.active().includes("bash"));
  assert.ok(!e.f.active().includes("crew_dispatch"));
});

crewTest("/crew-stop during crew_finish's checks stops them and the crew does not finish", async (e) => {
  const t0 = Date.now();
  const pending = e.f.tool("crew_finish", { summary: "s", checks: ["sleep 30"] });
  await e.f.command("crew-stop", "", e.ctx);
  const out = (await pending).content[0].text as string;
  assert.match(out, /stopped while the final checks ran/);
  assert.ok(Date.now() - t0 < 10_000, "the check was killed, not waited out");
  assert.equal(e.state().status, "stopped");
});

// ---- stop / resume / shutdown ----------------------------------------------------

crewTest("/crew-stop cancels running workers without waking the planner", async (e) => {
  await e.dispatch();
  await e.f.command("crew-stop", "", e.ctx);
  assert.equal(e.w.list[0].opts.signal.aborted, true);
  await waitFor(() => e.handoffs().length === 1, "handoff");
  assert.notEqual(e.handoffs()[0].options?.triggerTurn, true);
  assert.equal(e.state().status, "stopped");
  assert.match(e.f.notes.at(-1)!, /stopped/);
});

crewTest("a dispatch racing /crew-stop is refused rather than started for a stopped crew", async (e) => {
  const pending = e.dispatch().then(() => "started", (error: Error) => error.message);
  await e.f.command("crew-stop", "", e.ctx);
  assert.match(await pending, /stopped while #1 was being set up/);
  assert.equal(e.w.list.length, 0);
  assert.equal(e.state().tasks[0].status, "cancelled");
});

test("resuming after a crash marks dead tasks interrupted, re-sends the planner prompt, and integrates their commits", async () => {
  const root = makeRepo();
  const a = boot(root, { ignoreAbort: true });
  await a.f.emit("session_start", {}, a.ctx);
  await a.f.command("crew", "crashy", a.ctx);
  await a.dispatch();
  commitIn(a.w.list[0].job.cwd, "b.txt", "b\n");
  const down = a.shutdown(); // the old process goes away without ever reporting

  const b = boot(root);
  try {
    await b.f.emit("session_start", {}, b.ctx);
    await b.f.command("crew-resume", "", b.ctx);
    assert.equal(b.f.sent.at(-1)!.message.customType, "crew-resume");
    assert.match(b.f.sent.at(-1)!.message.content, /You are the PLANNER/);
    assert.equal(b.f.sent.at(-1)!.options?.triggerTurn, true);
    assert.deepEqual([...b.f.active()].sort(), [...READ, ...CREW].sort());
    assert.match(await b.ledger(), /#1 implement \[interrupted\]/);
    assert.match((await b.f.tool("crew_integrate", { taskId: 1 })).content[0].text, /Integrated #1/);
  } finally {
    a.w.list[0].finish(result("cancelled", ""));
    await down;
    await b.shutdown();
  }
});

crewTest("shutdown marks running tasks interrupted, waits for them, and stays quiet", async (e) => {
  await e.dispatch();
  await e.shutdown();
  assert.equal(e.w.list[0].opts.signal.aborted, true);
  assert.equal(e.state().tasks[0].status, "interrupted");
  assert.equal(e.handoffs().length, 0);
});

// ---- stop then resume in one session (open issue 2) -------------------------------

crewTest("resume waits for stopped workers, so their reports reach the resumed ledger", async (e) => {
  await e.dispatch();
  await e.f.command("crew-stop", "", e.ctx);
  // The worker ignores the abort for a while, as a real child flushing its output would.
  let resumed = false;
  const resume = e.f.command("crew-resume", "", e.ctx).then(() => { resumed = true; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(resumed, false, "resume waits for the stopping worker");
  commitIn(e.w.list[0].job.cwd, "b.txt", "b\n");
  e.w.list[0].finish(result());
  await resume;
  const task = e.state().tasks[0];
  assert.equal(e.state().status, "active");
  assert.ok(task.report, "the stopped worker's report survived the resume");
  assert.equal(task.report.commits.length, 1);
  assert.notEqual(task.status, "interrupted");
}, { ignoreAbort: true });

crewTest("resume waits for an in-flight crew_finish, so its cleanup can't touch the resumed crew", async (e) => {
  let finished = false;
  const finish = e.f.tool("crew_finish", { summary: "s", checks: ["sleep 0.3"] }).then(() => { finished = true; });
  await new Promise((r) => setTimeout(r, 50));
  await e.f.command("crew-stop", "", e.ctx);
  await e.f.command("crew-resume", "", e.ctx);
  assert.equal(finished, true, "crew_finish settled before the crew was resumed");
  await finish;
  assert.equal(e.state().status, "active");
});

crewTest("two resumes at once activate the crew once", async (e) => {
  await e.f.command("crew-stop", "", e.ctx);
  const sentBefore = e.f.sent.length;
  await Promise.all([e.f.command("crew-resume", "", e.ctx), e.f.command("crew-resume", "", e.ctx)]);
  assert.equal(e.f.sent.length - sentBefore, 1, "one resume message");
  assert.ok(e.f.notes.some((n) => /already|in progress/.test(n)), e.f.notes.join("; "));
});

crewTest("a dispatch still setting up when the crew stops never launches its worker", async (e) => {
  // `git worktree add` runs post-checkout; a slow hook holds the dispatch mid-setup.
  writeFileSync(join(e.root, ".git", "hooks", "post-checkout"), "#!/bin/sh\nsleep 0.5\n", { mode: 0o755 });
  const dispatch = e.dispatch().then((text) => text, (error: Error) => error.message);
  await new Promise((r) => setTimeout(r, 100));
  await e.f.command("crew-stop", "", e.ctx);
  await e.f.command("crew-resume", "", e.ctx);
  assert.match(await dispatch, /stopped/);
  assert.equal(e.w.list.length, 0, "no worker started for a stopped crew");
  assert.doesNotMatch(await e.ledger(), /\[running\]/);
});

// ---- panel -------------------------------------------------------------------

/** Capture the component ctx.ui.custom builds, with a plain-text theme and a fixed terminal. */
function panelUi(ctx: any) {
  const opened: { component: any; closed: boolean; renders: number }[] = [];
  ctx.ui.custom = (factory: any) => new Promise<void>((resolve) => {
    const panel = { component: undefined as any, closed: false, renders: 0 };
    const tui = { terminal: { rows: 40 }, requestRender: () => { panel.renders++; } };
    const theme = { fg: (_tone: string, text: string) => text, bold: (text: string) => text, bg: (_tone: string, text: string) => text };
    panel.component = factory(tui, theme, {}, () => { panel.closed = true; panel.component.dispose?.(); resolve(); });
    opened.push(panel);
  });
  const screen = () => opened.at(-1)!.component.render(120).join("\n") as string;
  // Pi doesn't await shortcut handlers; neither does this.
  const shortcut = async (f: any, context: any) => {
    void f.shortcuts.get("ctrl+shift+c").handler(context);
    await waitFor(() => opened.length > 0, "the panel");
  };
  const type = (...keys: string[]) => { for (const k of keys) opened.at(-1)!.component.handleInput(k); };
  return { opened, screen, type, shortcut };
}

crewTest("/crew with no goal opens the panel on live, in-memory task state without blocking", async (e) => {
  const ui = panelUi(e.ctx);
  let edited = false;
  e.ctx.ui.editor = async () => { edited = true; return undefined; };
  await e.dispatch({ title: "paint the panel" });
  // Fresher than the ledger on disk: progress isn't persisted on every event.
  e.w.list[0].opts.onProgress({ toolCalls: 7, activity: "edit theme.ts", usage: { input: 0, output: 0, cost: 0.37 }, lastEventAt: Date.now() });
  const command = e.f.command("crew", "", e.ctx);
  try {
    // Pi blocks the editor while a command handler runs, so it must return with the panel open.
    const returned = await Promise.race([command.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
    assert.equal(returned, true, "the command returned while the panel is still open");
    assert.equal(ui.opened.length, 1);
    assert.equal(edited, false, "no goal prompt for a running crew");
    const text = ui.screen();
    assert.match(text, new RegExp(`Crew ${e.slug} active`));
    assert.match(text, /#1 impl paint the panel .*\$0\.37 +edit theme\.ts/);
    assert.match(text, /1\/3 running · \$0\.37\/\$10\.00/);
    // One panel at a time.
    await e.f.command("crew", "", e.ctx);
    assert.equal(ui.opened.length, 1);
  } finally {
    if (ui.opened.length) ui.type("q");
    await command;
  }
  assert.ok(ui.opened[0].closed);
});

crewTest("cancelling from the panel asks first, then stops the worker and wakes the planner", async (e) => {
  const ui = panelUi(e.ctx);
  await e.dispatch();
  await ui.shortcut(e.f, e.ctx);
  ui.type("x");
  assert.match(ui.screen(), /Cancel #1 "do it"\?/);
  ui.type("n");
  assert.equal(e.w.list[0].opts.signal.aborted, false, "n keeps it running");
  ui.type("x", "y");
  assert.equal(e.w.list[0].opts.signal.aborted, true);
  await waitFor(() => e.handoffs().length === 1, "handoff");
  assert.equal(e.handoffs()[0].options?.triggerTurn, true, "the planner hears about a human cancel");
  assert.match(ui.screen(), /Cancelling #1/);
});

test("the shortcut opens a stopped crew from the ledger in a new session, read-only", async () => {
  const root = makeRepo();
  const a = boot(root);
  await a.f.emit("session_start", {}, a.ctx);
  await a.f.command("crew", "ledger goal", a.ctx);
  await a.dispatch({ title: "left behind" });
  await a.f.command("crew-stop", "", a.ctx);
  await waitFor(() => a.handoffs().length === 1, "handoff");
  await a.shutdown();

  const b = boot(root);
  try {
    await b.f.emit("session_start", {}, b.ctx);
    const ui = panelUi(b.ctx);
    await ui.shortcut(b.f, b.ctx);
    const text = ui.screen();
    assert.match(text, /stopped · ledger goal/);
    assert.match(text, /#1 impl left behind .*cancelled/);
    ui.type("x");
    assert.match(ui.screen(), /#1 is not running/);
    ui.type("q");
    await waitFor(() => ui.opened[0].closed, "close");

    // /crew with no goal opens it too, while it's unfinished.
    let asked = false;
    b.ctx.ui.editor = async () => { asked = true; return undefined; };
    await b.f.command("crew", "", b.ctx);
    assert.equal(ui.opened.length, 2);
    assert.equal(asked, false);
    ui.type("q");
    await waitFor(() => ui.opened[1].closed, "close");

    // A finished crew has nothing to watch: /crew asks for a new goal.
    const file = join(root, ".git", "pi-crew", readdirSync(join(root, ".git", "pi-crew")).find((f) => f.endsWith(".json"))!);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), status: "finished" }));
    await b.f.command("crew", "", b.ctx);
    assert.ok(asked);
    assert.equal(ui.opened.length, 2);
  } finally {
    await b.shutdown();
  }
});

test("the shortcut says so when the repository has no crews", async () => {
  const e = boot(makeRepo());
  try {
    const ui = panelUi(e.ctx);
    await e.f.shortcuts.get("ctrl+shift+c").handler(e.ctx);
    assert.equal(ui.opened.length, 0);
    assert.match(e.f.notes.at(-1)!, /No crews in this repository/);
  } finally {
    await e.shutdown();
  }
});

crewTest("/crew-status opens the panel, and prints the text ledger without a UI", async (e) => {
  const ui = panelUi(e.ctx);
  await e.dispatch({ title: "status me" });
  await e.f.command("crew-status", "", e.ctx);
  assert.equal(ui.opened.length, 1);
  assert.match(ui.screen(), /#1 impl status me/);
  ui.type("q");
  const logged: string[] = [];
  const log = console.log;
  console.log = (text: string) => { logged.push(text); };
  try {
    await e.f.command("crew-status", "", { ...e.ctx, hasUI: false });
  } finally {
    console.log = log;
  }
  assert.equal(ui.opened.length, 1);
  assert.match(logged.join("\n"), /#1 implement \[running\] "status me"/);
});
