import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { allowed, loadAllowlist } from "./allow.ts";

test("exact names and trailing-* prefixes; nothing else", () => {
  const p = ["mcp__fantastical__get_*", "mcp__fantastical__search_events"];
  assert.ok(allowed(p, "mcp__fantastical__get_events_in_range"));
  assert.ok(allowed(p, "mcp__fantastical__search_events"));
  assert.ok(!allowed(p, "mcp__fantastical__create_event"));
  assert.ok(!allowed(p, "mcp__fantastical__search_events_and_delete"));
});

test("the checked-in allowlist loads, and bad files are rejected", () => {
  assert.ok(loadAllowlist(fileURLToPath(new URL("./readonly.json", import.meta.url))).length > 0);
  const bad = join(mkdtempSync(join(tmpdir(), "mcpc-")), "r.json");
  for (const text of ['{"tools": ["*"]}', '{"tools": ["mcp__a", 1]}', '{"tools": "mcp__a"}', "{}", "[]", "null", '"mcp__a"']) {
    writeFileSync(bad, text);
    assert.throws(() => loadAllowlist(bad), /mcp__/, text);
  }
  writeFileSync(bad, "{");
  assert.throws(() => loadAllowlist(bad), SyntaxError);
  assert.throws(() => loadAllowlist(join(bad, "missing")), /ENOENT|ENOTDIR/);
});
