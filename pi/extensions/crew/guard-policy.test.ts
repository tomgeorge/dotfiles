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
  assert.match(checkWritePath(root, root, "")!, /missing/);
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
