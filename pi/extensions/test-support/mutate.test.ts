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

test("mutate.ts copies sibling directories so an extension's relative imports resolve", () => {
  const root = mkdtempSync(join(tmpdir(), "mutate-test-"));
  try {
    mkdirSync(join(root, "test-support"));
    copyFileSync(join(here, "mutate.ts"), join(root, "test-support", "mutate.ts"));
    mkdirSync(join(root, "shared"));
    writeFileSync(join(root, "shared", "value.ts"), "export const value = 1;\n");
    mkdirSync(join(root, "ext"));
    writeFileSync(join(root, "ext", "thing.ts"), `import { value } from "../shared/value.ts";\nexport const thing = () => value + 1;\n`);
    writeFileSync(join(root, "ext", "thing.test.ts"), `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { thing } from "./thing.ts";\ntest("thing", () => assert.equal(thing(), 2));\n`);
    writeFileSync(join(root, "ext", "mutants.json"), JSON.stringify([{ name: "plus", file: "thing.ts", from: "value + 1", to: "value - 1" }]));
    // Under node --test, NODE_TEST_CONTEXT makes nested runs emit TAP, hiding the ℹ summary mutate.ts reads.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const r = spawnSync(process.execPath, ["--no-warnings", join(root, "test-support", "mutate.ts"), "ext"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all 1 mutants killed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mutate.ts exits 2 for a well-formed but wrongly shaped mutants.json", () => {
  const r = runMutate(`[{ "name": "x" }]`);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^ext\/mutants\.json: expected an array/);
});
