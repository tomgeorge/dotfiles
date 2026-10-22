import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReport, parseHandoff, type TaskReport } from "./handoff.ts";

test("parses the last handoff block and normalizes fields", () => {
  const text = [
    "draft:", "```handoff", '{"status":"partial"}', "```",
    "final:", "```handoff", JSON.stringify({ status: "done", summary: "Added X", concerns: "one", findings: ["a", { b: 1 }] }), "```",
  ].join("\n");
  const { handoff, error } = parseHandoff(text);
  assert.equal(error, undefined);
  assert.equal(handoff?.status, "done");
  assert.equal(handoff?.summary, "Added X");
  assert.deepEqual(handoff?.concerns, ["one"]);
  assert.deepEqual(handoff?.findings, ["a", '{"b":1}']);
  assert.deepEqual(handoff?.next, []);
});

test("reports missing, malformed, and invalid handoffs", () => {
  assert.match(parseHandoff("no block").error!, /no ```handoff/);
  assert.match(parseHandoff("```handoff\n{nope\n```").error!, /not valid JSON/);
  assert.match(parseHandoff('```handoff\n{"status":"finished"}\n```').error!, /status must be/);
  assert.match(parseHandoff("```handoff\n[1]\n```").error!, /JSON object/);
});

const base: TaskReport = {
  id: 3, kind: "implement", title: "Add flag", outcome: "submitted", model: "p/m",
  branch: "crew/x-t3", base: "abcdef1234567", commits: ["abc123 Add flag"], diffStat: " a.ts | 2 +\n",
  outOfScope: ["README.md"], autoCommitted: true, cost: 0.123, durationMs: 90_000,
  checks: [
    { command: "npm test", exit: 1, tail: "1 failing", timedOut: false },
    { command: "npm run lint", exit: 0, tail: "", timedOut: false },
  ],
  handoff: { status: "done", summary: "Did it", notes: "", concerns: ["edge case"], deviations: [], findings: ["bug in y"], next: [] },
};

test("report separates worker claims from harness observations", () => {
  const out = formatReport(base);
  assert.match(out, /task #3 \(implement\) "Add flag": SUBMITTED/);
  assert.ok(out.indexOf("Worker's handoff (claims)") < out.indexOf("Observed by the harness"));
  assert.match(out, /concerns:\n- edge case/);
  assert.match(out, /changed OUTSIDE declared paths:\n- README.md/);
  assert.match(out, /harness committed them/);
  assert.match(out, /FAIL \(exit 1\): npm test\n {4}1 failing/);
  assert.match(out, /PASS: npm run lint/);
});

test("report flags files the checks left modified", () => {
  const out = formatReport({ ...base, dirtyAfterChecks: ["package-lock.json"] });
  assert.match(out, /checks left uncommitted changes[^\n]*:\n- package-lock.json/);
  assert.doesNotMatch(formatReport(base), /checks left uncommitted/);
});

test("report flags unverified work and shows partial output when the handoff is missing", () => {
  const out = formatReport({ ...base, checks: [], handoff: undefined, parseError: "no block", partial: "was editing a.ts", outcome: "timeout" });
  assert.match(out, /TIMEOUT/);
  assert.match(out, /\(missing: no block\)/);
  assert.match(out, /was editing a.ts/);
  assert.match(out, /UNVERIFIED/);
});

test("review reports carry only the reviewer's findings", () => {
  const out = formatReport({ ...base, kind: "review", checks: [], commits: [], diffStat: "", outOfScope: [] });
  assert.match(out, /findings:\n- bug in y/);
  assert.doesNotMatch(out, /Observed by the harness/);
});
