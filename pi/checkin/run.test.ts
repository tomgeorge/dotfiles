import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "run.sh");

/** Run run.sh against a fake `pi` that prints `reply`, in a throwaway HOME. */
function run(reply: string, priorState?: string) {
  const home = mkdtempSync(join(tmpdir(), "checkin-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(home, "reply.txt"), reply);
  writeFileSync(join(bin, "pi"), `#!/bin/sh\ncat "$HOME/reply.txt"\n`);
  chmodSync(join(bin, "pi"), 0o755);
  const state = join(home, ".local", "state", "pi-checkin");
  if (priorState) {
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "reported.json"), priorState);
  }
  const r = spawnSync("bash", [script], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PI_CHECKIN_NOTIFY: "0" }, encoding: "utf8" });
  const read = (f: string) => (existsSync(join(state, f)) ? readFileSync(join(state, f), "utf8") : undefined);
  return { status: r.status, stderr: r.stderr, latest: read("latest.md"), reported: read("reported.json"), log: read("runs.log") ?? "" };
}

const good = '{"lastRun":"2026-10-22T08:30:00Z","reported":{"todoist:1":"2026-10-22T08:30:00Z"}}';

test("NO_REPLY stays silent but saves the state", () => {
  const r = run(`\nNO_REPLY\nSTATE: ${good}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.latest, undefined);
  assert.equal(r.reported, `${good}\n`);
});

test("items are saved to latest.md without the STATE line", () => {
  const r = run(`• Today 15:00 — Dentist — leave by 14:35   \nSTATE: ${good}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.latest!, /^• Today 15:00 — Dentist — leave by 14:35\n\n\(/);
  assert.doesNotMatch(r.latest!, /STATE/);
});

test("a malformed STATE line keeps the previous state", () => {
  for (const bad of ['{"reported":null}', '{"lastRun":"x"}', '{"lastRun":"x","reported":{"a":1}}', "[1]", "not json", '{"reported":null} {"lastRun":"x","reported":{}}']) {
    const r = run(`NO_REPLY\nSTATE: ${bad}\n`, good);
    assert.equal(r.reported, good, `accepted ${bad}`);
    assert.match(r.log, /ignored malformed STATE line/);
  }
});
