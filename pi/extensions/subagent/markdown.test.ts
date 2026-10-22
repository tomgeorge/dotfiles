import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { glowRenderer, trimBlank } from "./markdown.ts";

function stub(script: string) {
  const file = join(mkdtempSync(join(tmpdir(), "subagent-glow-")), "glow");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

const fallback = (text: string, width: number) => [`fallback ${width}: ${text}`];

test("trimBlank drops blank and ANSI-only edge lines", () => {
  assert.deepEqual(trimBlank(["", "\x1b[38;5;252m  \x1b[m", "a", "", "b", "  "]), ["a", "", "b"]);
});

test("glowRenderer pipes markdown through glow with style and width", () => {
  const command = stub(`echo; echo "args: $*"; cat; echo; echo`);
  const render = glowRenderer(fallback, { command, style: "dark" });
  assert.deepEqual(render("# hi", 40), ["args: -s dark -w 40 -", "# hi"]);
});

test("glowRenderer caches per text and width", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagent-glow-count-"));
  const command = stub(`echo x >> ${dir}/calls; cat`);
  const render = glowRenderer(fallback, { command });
  render("a", 10);
  render("a", 10);
  render("a", 20);
  render("b", 10);
  assert.equal(readFileSync(join(dir, "calls"), "utf8").trim().split("\n").length, 3);
});

test("glowRenderer falls back when glow is missing or fails", () => {
  assert.deepEqual(glowRenderer(fallback, { command: "/nonexistent/glow" })("x", 5), ["fallback 5: x"]);
  assert.deepEqual(glowRenderer(fallback, { command: stub("exit 1") })("y", 6), ["fallback 6: y"]);
});

