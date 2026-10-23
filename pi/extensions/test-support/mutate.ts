// Mutation gate: do an extension's tests notice when its wiring breaks?
//   node pi/extensions/test-support/mutate.ts <extension> [mutant name...]
// Reads pi/extensions/<extension>/mutants.json: [{ "name", "file", "from", "to" }], where
// `from` must occur exactly once in `file`. Each mutant is applied to a temporary copy (the
// checkout is never touched), and the extension's tests must fail. Exit 0 when every mutant
// is killed; exit 1 lists the survivors; exit 2 on a usage error or an unreadable, invalid or
// malformed mutants.json. MUTATE_TIMEOUT_MS bounds each test run (default 5 min).
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Mutant { name: string; file: string; from: string; to: string }

// Bad input must exit 2, not crash with exit 1, which reads like "mutants survived".
function usageError(message: string): never {
  console.error(message);
  process.exit(2);
}

const isMutant = (m: unknown): m is Mutant =>
  typeof m === "object" && m !== null && ["name", "file", "from", "to"].every((k) => typeof (m as Record<string, unknown>)[k] === "string");

function readMutants(extension: string, path: string): Mutant[] {
  let all: unknown;
  try {
    all = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return usageError(`${extension}/mutants.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(all) || !all.every(isMutant)) {
    return usageError(`${extension}/mutants.json: expected an array of { name, file, from, to } strings`);
  }
  return all;
}

const here = dirname(fileURLToPath(import.meta.url));
const extensions = dirname(here);
const [extension, ...only] = process.argv.slice(2);
if (!extension) usageError("usage: mutate.ts <extension> [mutant name...]");
const source = join(extensions, extension);
const all = readMutants(extension, join(source, "mutants.json"));
// A misspelt name would otherwise select nothing and report "all 0 mutants killed".
const unknown = only.filter((name) => !all.some((m) => m.name === name));
if (unknown.length) usageError(`unknown mutant: ${unknown.join("; ")}`);
const mutants = all.filter((m) => !only.length || only.includes(m.name));

const work = mkdtempSync(join(tmpdir(), `mutate-${extension}-`));
const copy = join(work, extension);
cpSync(source, copy, { recursive: true });
cpSync(here, join(work, "test-support"), { recursive: true });
const tests = readdirSync(copy).filter((f) => f.endsWith(".test.ts"));

type Outcome = "pass" | "fail" | "error";

// Only a completed run with failing tests kills a mutant. A timeout, or a mutant that breaks
// loading (syntax or import error), says nothing about whether the tests notice the change.
function runTests(): { outcome: Outcome; summary: string } {
  const r = spawnSync(process.execPath, ["--test", ...tests], { cwd: copy, encoding: "utf8", timeout: Number(process.env.MUTATE_TIMEOUT_MS ?? 300_000) });
  const out = `${r.stdout}${r.stderr}`;
  const summary = out.split("\n").filter((l) => /^ℹ pass|^ℹ (fail|cancelled) [1-9]/.test(l)).join(", ") || `exit ${r.status} ${r.signal ?? ""}`;
  if (r.signal || r.error) return { outcome: "error", summary: `${summary} (${r.signal ?? r.error?.message})` };
  if (/SyntaxError|ERR_MODULE_NOT_FOUND|ERR_INVALID_TYPESCRIPT_SYNTAX/.test(out)) return { outcome: "error", summary: `${summary} (load error)` };
  // node:test reports a test that hit its own timeout as cancelled; that's a detection too.
  const count = (what: string) => Number(new RegExp(`^ℹ ${what} (\\d+)`, "m").exec(out)?.[1] ?? NaN);
  const failed = count("fail") + count("cancelled");
  if (r.status === 0 && failed === 0) return { outcome: "pass", summary };
  if (r.status !== 0 && failed > 0) return { outcome: "fail", summary };
  return { outcome: "error", summary: `${summary} (exit ${r.status})` };
}

try {
  const baseline = runTests();
  if (baseline.outcome !== "pass") {
    console.log(`baseline FAILS (${baseline.summary}); fix the tests before mutating`);
    process.exit(1);
  }
  const survivors: string[] = [];
  for (const m of mutants) {
    const file = join(copy, m.file);
    const original = readFileSync(file, "utf8");
    const count = original.split(m.from).length - 1;
    if (count !== 1) {
      console.log(`INVALID ${m.name}: "from" occurs ${count} times in ${m.file}`);
      survivors.push(m.name);
      continue;
    }
    // A function replacement, so a "to" containing $& or $1 is inserted literally.
    writeFileSync(file, original.replace(m.from, () => m.to));
    const run = runTests();
    writeFileSync(file, original);
    const label = { pass: "SURVIVED", fail: "killed  ", error: "ERROR   " }[run.outcome];
    console.log(`${label} ${m.name}${run.outcome === "pass" ? "" : `  (${run.summary})`}`);
    if (run.outcome !== "fail") survivors.push(m.name);
  }
  console.log(survivors.length ? `\n${survivors.length} of ${mutants.length} mutants survived or errored: ${survivors.join("; ")}` : `\nall ${mutants.length} mutants killed`);
  process.exitCode = survivors.length ? 1 : 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}
