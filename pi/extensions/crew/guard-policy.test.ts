import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkBash, checkWritePath } from "./guard-policy.ts";

test("writes stay inside the worktree, outside .git, and can't escape through symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-guard-"));
  const root = join(dir, "wt");
  const outside = join(dir, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, join(root, "link"));

  assert.equal(checkWritePath(root, root, "src/new/file.ts"), null);
  assert.equal(checkWritePath(root, join(root, "src"), "../README.md"), null);
  assert.equal(checkWritePath(root, root, join(root, "src", "a.ts")), null);
  assert.match(checkWritePath(root, root, "../outside/x")!, /outside/);
  assert.match(checkWritePath(root, root, "/etc/hosts")!, /outside/);
  assert.match(checkWritePath(root, root, "link/x.ts")!, /outside/);
  assert.match(checkWritePath(root, root, ".git/config")!, /\.git/);
  assert.match(checkWritePath(root, root, ".GIT/config")!, /\.git/);
  assert.match(checkWritePath(root, root, ".Git")!, /\.git/);
  assert.equal(checkWritePath(root, root, ".github/workflows/ci.yml"), null);
  assert.match(checkWritePath(root, root, "")!, /missing/);
  // Pi's tools turn file:// URLs into real paths, so the guard must too.
  assert.match(checkWritePath(root, root, "file:///tmp/crew-escape")!, /outside/);
  assert.equal(checkWritePath(root, root, `file://${join(root, "src", "ok.ts")}`), null);
  // A dangling link still writes through to its target when the file is created.
  symlinkSync(join(outside, "not-created-yet"), join(root, "dangling"));
  assert.match(checkWritePath(root, root, "dangling")!, /outside/);
  symlinkSync("src/fresh.ts", join(root, "inner-dangling"));
  assert.equal(checkWritePath(root, root, "inner-dangling"), null);
});

test("bash blocks branch-moving and publishing git commands only", () => {
  for (const ok of ["git status", "git add -A && git commit -m 'x'", "git diff HEAD~1", "git merge crew/x-t1",
    "git checkout -- src/a.ts", "npm test", "git log --oneline | head"]) {
    assert.equal(checkBash(ok), null, ok);
  }
  for (const bad of ["git push origin HEAD", "git -C .. worktree add x", "git switch main", "git checkout -b other",
    "git rebase main", "git reset --hard HEAD~2", "git branch -D crew/x", "git config user.email x",
    "git commit --amend --no-edit", "npm test && git push"]) {
    assert.notEqual(checkBash(bad), null, bad);
  }
});

test("round 2: symlink chains resolve physically, and ~ expands like Pi's join", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-guard2-"));
  const root = join(dir, "wt");
  const out = join(dir, "out");
  mkdirSync(join(out, "dir"), { recursive: true });
  mkdirSync(root);
  // R/a -> out (exists); out/link -> ../victim (dangling, relative to out's real parent)
  symlinkSync(out, join(root, "a"));
  symlinkSync("../victim", join(out, "link"));
  assert.match(checkWritePath(root, root, "a/link")!, /outside/);
  // hop -> out/dir (exists); link2 -> hop/../pwn: the kernel lands in out/pwn
  symlinkSync(join(out, "dir"), join(root, "hop"));
  symlinkSync("hop/../pwn", join(root, "link2"));
  assert.match(checkWritePath(root, root, "link2")!, /outside/);
  // Pi expands "~/" + rest with join(), so "~//abs" lands under $HOME, not at /abs.
  assert.match(checkWritePath(root, root, `~/${root}/f`)!, /outside/);
  // A symlink loop is refused, not followed forever.
  symlinkSync("loop2", join(root, "loop1"));
  symlinkSync("loop1", join(root, "loop2"));
  assert.notEqual(checkWritePath(root, root, "loop1"), null);
  // Ordinary cases still pass.
  mkdirSync(join(root, "src"));
  assert.equal(checkWritePath(root, root, "src/new/deep/file.ts"), null);
  symlinkSync("src", join(root, "srclink"));
  assert.equal(checkWritePath(root, root, "srclink/x.ts"), null);
});
