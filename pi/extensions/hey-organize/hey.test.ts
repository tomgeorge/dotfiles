import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildArgs, MAX_IDS, parseResult, runHey } from "./hey.ts";

test("buildArgs maps each op to its one subcommand", () => {
  assert.deepEqual(buildArgs({ kind: "move", postingIds: [1, 2], to: "trail" }), ["move", "1", "2", "--to", "trailbox", "--json"]);
  assert.deepEqual(buildArgs({ kind: "move", postingIds: [1], to: "feed" }), ["move", "1", "--to", "feedbox", "--json"]);
  assert.deepEqual(buildArgs({ kind: "label", postingIds: [3], labelId: 9 }), ["label", "add", "3", "--to", "9", "--json"]);
  assert.deepEqual(buildArgs({ kind: "collection", threadIds: [4], collectionId: 8 }), ["collection", "add", "4", "--to", "8", "--json"]);
  assert.deepEqual(buildArgs({ kind: "seen", postingIds: [5, 5, 6] }), ["seen", "5", "6", "--json"]);
  assert.deepEqual(buildArgs({ kind: "move", postingIds: [7], to: "aside" }), ["move", "7", "--to", "asidebox", "--json"]);
  assert.deepEqual(buildArgs({ kind: "bubble", postingIds: [1], when: "now" }), ["bubble", "up", "1", "--now", "--json"]);
  assert.deepEqual(buildArgs({ kind: "bubble", postingIds: [1], when: "next-week" }), ["bubble", "up", "1", "--next-week", "--json"]);
  assert.deepEqual(buildArgs({ kind: "bubble", postingIds: [1, 2], when: "on", on: "2026-11-02" }), ["bubble", "up", "1", "2", "--on", "2026-11-02", "--json"]);
  assert.deepEqual(buildArgs({ kind: "bubble-pop", postingIds: [3] }), ["bubble", "pop", "3", "--json"]);
});

test("buildArgs validates bubble times and dates", () => {
  assert.throws(() => buildArgs({ kind: "bubble", postingIds: [1], when: "on" }), /YYYY-MM-DD/);
  assert.throws(() => buildArgs({ kind: "bubble", postingIds: [1], when: "on", on: "2026-02-30" }), /YYYY-MM-DD/);
  assert.throws(() => buildArgs({ kind: "bubble", postingIds: [1], when: "on", on: "--now" }), /YYYY-MM-DD/);
  assert.throws(() => buildArgs({ kind: "bubble", postingIds: [1], when: "now", on: "2026-11-02" }), /only allowed/);
  assert.throws(() => buildArgs({ kind: "bubble", postingIds: [1], when: "later" as never }), /Unknown bubble time/);
});

test("buildArgs rejects IDs that could smuggle flags or are out of range", () => {
  assert.throws(() => buildArgs({ kind: "seen", postingIds: [] }), /at least one/);
  assert.throws(() => buildArgs({ kind: "seen", postingIds: [0] }), /positive integer/);
  assert.throws(() => buildArgs({ kind: "seen", postingIds: [1.5] }), /positive integer/);
  assert.throws(() => buildArgs({ kind: "seen", postingIds: ["--all" as unknown as number] }), /positive integer/);
  assert.throws(() => buildArgs({ kind: "seen", postingIds: Array.from({ length: MAX_IDS + 1 }, (_, i) => i + 1) }), /At most/);
  assert.throws(() => buildArgs({ kind: "move", postingIds: [1], to: "trash" as never }), /Unknown box/);
  assert.throws(() => buildArgs({ kind: "label", postingIds: [1], labelId: -1 }), /labelId/);
});

test("parseResult returns data on ok and surfaces hey's error and hint", () => {
  assert.deepEqual(parseResult('{"ok":true,"data":[1]}', "", 0), [1]);
  assert.throws(() => parseResult('{"ok":false,"error":"not found","hint":"check the ID"}', "", 1), /not found \(check the ID\)/);
  assert.throws(() => parseResult("", '{"ok":false,"error":"Not logged in","hint":"Run: hey auth login"}', 3), /exit code 3\): Not logged in \(Run: hey auth login\)/);
  assert.throws(() => parseResult("garbage", "boom", 2), /boom/);
  assert.throws(() => parseResult('{"ok":true}', "", 3), /exit code 3/);
});

test("runHey passes argv without a shell and sets HEY_NONINTERACTIVE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hey-organize-"));
  const bin = join(dir, "hey");
  await writeFile(bin, '#!/bin/sh\nprintf \'{"ok":true,"data":{"args":"%s","ni":"%s"}}\' "$*" "$HEY_NONINTERACTIVE"\n');
  await chmod(bin, 0o755);
  assert.deepEqual(await runHey(["seen", "1;rm -rf x"], undefined, bin), { args: "seen 1;rm -rf x", ni: "1" });
});
