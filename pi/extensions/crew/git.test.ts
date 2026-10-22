import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addWorktree, branchCommits, branchFacts, commitAll, discardChanges, gitOk, mergeBranch, outsidePaths, removeWorktree,
  repoInfo, runCheck,
} from "./git.ts";

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crew-git-")));
  const root = join(dir, "proj");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const g = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args]);
  writeFileSync(join(root, "a.txt"), "one\n");
  g("add", "."); g("commit", "-qm", "init");
  return { dir, root };
}

test("worktree lifecycle: branch, auto-commit, facts, merge, conflict abort, cleanup", async () => {
  const { dir, root } = repo();
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
  const info = await repoInfo(root);
  assert.equal(info.name, "proj");
  assert.equal(info.dirty, false);

  const integ = join(dir, "integ");
  await addWorktree(root, integ, "crew/x", info.head);
  const t1 = join(dir, "t1");
  const t2 = join(dir, "t2");
  await addWorktree(root, t1, "crew/x-t1", info.head);
  await addWorktree(root, t2, "crew/x-t2", info.head);
  assert.equal((await repoInfo(t1)).name, "proj", "name comes from the main worktree");

  writeFileSync(join(t1, "a.txt"), "from t1\n");
  writeFileSync(join(t1, "b.txt"), "new\n");
  assert.equal(await commitAll(t1, "t1 work"), true);
  assert.equal(await commitAll(t1, "nothing"), false);
  const facts = await branchFacts(t1, info.head);
  assert.equal(facts.commits.length, 1);
  assert.deepEqual(facts.files.sort(), ["a.txt", "b.txt"]);
  assert.match(facts.diffStat, /2 files changed/);

  assert.equal((await mergeBranch(integ, "crew/x-t1", "merge t1")).ok, true);
  assert.match(await gitOk(integ, ["log", "--oneline", "-1"]), /merge t1/);
  writeFileSync(join(t2, "a.txt"), "from t2\n");
  await commitAll(t2, "t2 work");
  const conflict = await mergeBranch(integ, "crew/x-t2", "merge t2");
  assert.equal(conflict.ok, false);
  assert.deepEqual(conflict.conflicts, ["a.txt"]);
  assert.equal((await gitOk(integ, ["status", "--porcelain"])).trim(), "", "merge was aborted cleanly");

  await removeWorktree(root, t2, "crew/x-t2");
  assert.doesNotMatch(await gitOk(root, ["branch", "--list"]), /x-t2/);
});

test("outsidePaths treats entries as path prefixes", () => {
  const files = ["src/a.ts", "src/lib/b.ts", "srcx/c.ts", "README.md", "docs/x.md"];
  assert.deepEqual(outsidePaths(files, []), []);
  assert.deepEqual(outsidePaths(files, ["src", "docs/"]), ["srcx/c.ts", "README.md"]);
  assert.deepEqual(outsidePaths(files, ["./src/**", "README.md"]), ["srcx/c.ts", "docs/x.md"]);
});

test("outsidePaths treats a glob segment as its directory prefix", () => {
  const files = ["src/a.ts", "src/lib/b.ts", "srcx/c.ts", "test/a.test.ts", "README.md"];
  assert.deepEqual(outsidePaths(files, ["src/*.ts", "test/**/*.test.ts"]), ["srcx/c.ts", "README.md"]);
  assert.deepEqual(outsidePaths(files, ["*.md"]), [], "a top-level glob is unrestricted, not a false flag");
});

test("discardChanges lists and reverts what a check left behind", async () => {
  const { root } = repo();
  assert.deepEqual(await discardChanges(root), []);
  writeFileSync(join(root, "a.txt"), "changed by lint --fix\n");
  writeFileSync(join(root, "gen out.txt"), "generated\n");
  assert.deepEqual((await discardChanges(root)).sort(), ["a.txt", "gen out.txt"]);
  assert.equal((await gitOk(root, ["status", "--porcelain"])).trim(), "");
  // A check that creates a fixture repository: plain `git clean -fd` skips nested repos.
  execFileSync("git", ["init", "-q", join(root, "fixture")]);
  assert.deepEqual(await discardChanges(root), ["fixture/"]);
  assert.equal((await gitOk(root, ["status", "--porcelain"])).trim(), "");
});

test("branchCommits reads commits from the branch, with no report or worktree needed", async () => {
  const { dir, root } = repo();
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
  const base = (await gitOk(root, ["rev-parse", "HEAD"])).trim();
  const wt = join(dir, "t1");
  await addWorktree(root, wt, "crew/y-t1", base);
  assert.deepEqual(await branchCommits(root, base, "crew/y-t1"), []);
  writeFileSync(join(wt, "c.txt"), "x\n");
  await commitAll(wt, "crashed worker's commit");
  await removeWorktree(root, wt);
  assert.match((await branchCommits(root, base, "crew/y-t1")).join("\n"), /crashed worker's commit/);
});

test("runCheck reports exit codes, keeps the tail, and kills on timeout", async () => {
  const ok = await runCheck(tmpdir(), "echo hi", 5000);
  assert.deepEqual([ok.exit, ok.tail.trim(), ok.timedOut], [0, "hi", false]);
  const bad = await runCheck(tmpdir(), "for i in $(seq 1 100); do echo line$i; done; exit 3", 5000);
  assert.equal(bad.exit, 3);
  assert.match(bad.tail, /line100/);
  assert.doesNotMatch(bad.tail, /line1\n/);
  const slow = await runCheck(tmpdir(), "sleep 5 & sleep 5; wait", 200);
  assert.equal(slow.timedOut, true);
  // An abort (crew_cancel, shutdown) stops a running check promptly.
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 100);
  const aborted = await runCheck(tmpdir(), "sleep 5", 10_000, controller.signal);
  assert.ok(Date.now() - started < 2000, "aborted check returned promptly");
  assert.notEqual(aborted.exit, 0);
});

test("runCheck: a timeout never reads as a pass, and leftovers are cleaned up", async () => {
  const hung = await runCheck(tmpdir(), "sleep 5", 200);
  assert.deepEqual([hung.exit, hung.timedOut], [null, true]);
  // A daemon that left the process group still holds stdout; the check must not wait for it.
  const started = Date.now();
  const escaped = await runCheck(tmpdir(), "perl -MPOSIX -e 'setsid(); sleep 6' & exit 0", 5000);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
  assert.deepEqual([escaped.exit, escaped.timedOut], [0, false]);
  const bg = await runCheck(tmpdir(), "sleep 30 >/dev/null 2>&1 & echo $!", 5000);
  await new Promise((done) => setTimeout(done, 100));
  assert.throws(() => process.kill(Number(bg.tail.trim()), 0), /ESRCH/);
});
