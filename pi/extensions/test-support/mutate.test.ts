import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// mutate.ts finds extensions next to its own directory, so run a copy inside a temp tree.
function runMutate(mutantsJson: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "mutate-test-"));
  try {
    mkdirSync(join(root, "test-support"));
    copyFileSync(join(here, "mutate.ts"), join(root, "test-support", "mutate.ts"));
    mkdirSync(join(root, "ext"));
    if (mutantsJson !== undefined) writeFileSync(join(root, "ext", "mutants.json"), mutantsJson);
    // --no-warnings: Node 24.1 still prints a type-stripping ExperimentalWarning, and stderr is asserted exactly.
    return spawnSync(process.execPath, ["--no-warnings", join(root, "test-support", "mutate.ts"), "ext"], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [label, json] of [["invalid JSON", "[{ not json"], ["missing file", undefined]] as const) {
  test(`mutate.ts exits 2 with a one-line message for ${label}`, () => {
    const r = runMutate(json);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^ext\/mutants\.json: .+\n$/);
    assert.equal(r.stdout, "");
  });
}

test("mutate.ts exits 2 for a well-formed but wrongly shaped mutants.json", () => {
  const r = runMutate(`[{ "name": "x" }]`);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^ext\/mutants\.json: expected an array/);
});
