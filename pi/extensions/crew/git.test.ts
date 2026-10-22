import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addWorktree, branchFacts, commitAll, gitOk, mergeBranch, outsidePaths, removeWorktree, repoInfo, runCheck,
} from "./git.ts";

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "crew-git-")));
  const root = join(dir, "proj");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const g = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
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

test("runCheck reports exit codes, keeps the tail, and kills on timeout", async () => {
  const ok = await runCheck(tmpdir(), "echo hi", 5000);
  assert.deepEqual([ok.exit, ok.tail.trim(), ok.timedOut], [0, "hi", false]);
  const bad = await runCheck(tmpdir(), "for i in $(seq 1 100); do echo line$i; done; exit 3", 5000);
  assert.equal(bad.exit, 3);
  assert.match(bad.tail, /line100/);
  assert.doesNotMatch(bad.tail, /line1\n/);
  const slow = await runCheck(tmpdir(), "sleep 5 & sleep 5; wait", 200);
  assert.equal(slow.timedOut, true);
});
