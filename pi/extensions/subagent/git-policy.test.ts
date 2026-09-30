import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildGitArgv, GIT_ENV, GIT_GLOBAL_ARGS } from "./git-policy.ts";

const tail = (args: string[]) => buildGitArgv(args).slice(GIT_GLOBAL_ARGS.length);

test("allows read subcommands and prepends safety options", () => {
  const argv = buildGitArgv(["log", "--oneline", "-5"]);
  assert.deepEqual(argv.slice(0, GIT_GLOBAL_ARGS.length), [...GIT_GLOBAL_ARGS]);
  assert.deepEqual(tail(["log", "--oneline", "-5"]), ["log", "--no-ext-diff", "--no-textconv", "--oneline", "-5"]);
  assert.deepEqual(tail(["merge-base", "--is-ancestor", "a", "b"]), ["merge-base", "--is-ancestor", "a", "b"]);
  assert.deepEqual(tail(["grep", "-n", "foo"]), ["grep", "--no-textconv", "-n", "foo"]);
});

test("rejects mutating or networked subcommands", () => {
  for (const sub of ["commit", "checkout", "fetch", "push", "config", "worktree", "format-patch", "reset", "gc", "-C", "--git-dir=x"]) {
    assert.throws(() => buildGitArgv([sub]), /not allowed/, sub);
  }
  assert.throws(() => buildGitArgv([]), /subcommand is required/);
});

test("rejects options that write files or run programs", () => {
  for (const args of [
    ["log", "--output=/tmp/x"], ["diff", "--output", "/tmp/x"], ["show", "--ext-diff"],
    ["show", "--textconv"], ["cat-file", "--filters", "HEAD:f"], ["cat-file", "--textconv", "HEAD:f"],
    ["grep", "-Oless", "x"], ["grep", "--open-files-in-pager", "x"], ["log", "a\0b"],
  ]) {
    assert.throws(() => buildGitArgv(args), undefined, args.join(" "));
  }
});

test("branch and tag are forced into listing mode", () => {
  assert.deepEqual(tail(["tag", "--contains", "abc"]), ["tag", "--list", "--contains", "abc"]);
  assert.deepEqual(tail(["branch", "-a", "feat/*"]), ["branch", "--list", "-a", "feat/*"]);
  for (const args of [["branch", "-d", "main"], ["branch", "-D", "x"], ["branch", "-m", "a", "b"], ["tag", "-a", "v1"], ["tag", "-d", "v1"], ["tag", "-f", "v1"]]) {
    assert.throws(() => buildGitArgv(args), /only listing options/, args.join(" "));
  }
});

test("reflog allows show/exists only", () => {
  assert.doesNotThrow(() => buildGitArgv(["reflog"]));
  assert.doesNotThrow(() => buildGitArgv(["reflog", "show", "main"]));
  assert.doesNotThrow(() => buildGitArgv(["reflog", "-5"]));
  for (const action of ["expire", "delete", "drop"]) {
    assert.throws(() => buildGitArgv(["reflog", action]), /not allowed/);
  }
});

test("allowed commands run against a real repo without changing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "git-policy-"));
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
    writeFileSync(join(dir, "f"), "a\n");
    const refsBefore = git(["for-each-ref"]);
    const headBefore = readFileSync(join(dir, ".git", "HEAD"), "utf8");
    for (const args of [["log", "--oneline"], ["status", "--short"], ["branch", "newbranch"], ["tag", "v1"], ["show", "--stat", "HEAD"]]) {
      git(buildGitArgv(args));
    }
    assert.equal(git(["for-each-ref"]), refsBefore, "branch/tag positionals must list, not create");
    assert.equal(readFileSync(join(dir, ".git", "HEAD"), "utf8"), headBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
