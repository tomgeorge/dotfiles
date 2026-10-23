import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatStatus, formatWidget, listCrews, loadState, saveState, slugify, spent, type CrewState } from "./state.ts";

const state = (commonDir: string, slug: string, createdAt: number): CrewState => ({
  version: 1, status: "active", nextId: 3,
  config: {
    slug, goal: "g", repoRoot: "/r", repoName: "r", commonDir, integrationBranch: `crew/${slug}`,
    integrationPath: "/wt", baseSha: "abc", workerModel: { provider: "p", model: "w" },
    reviewerModel: { provider: "p", model: "r" }, maxConcurrent: 3, budgetUsd: 5, taskTimeoutMin: 45, stallMin: 10, createdAt,
  },
  tasks: [
    { id: 1, kind: "implement", title: "A", spec: "", acceptance: [], checks: [], paths: [], model: "p/w", status: "integrated",
      startedAt: 0, endedAt: 65_000, cost: 0.5, toolCalls: 9, activity: "", lastEventAt: 0 },
    { id: 2, kind: "review", reviewOf: 1, title: "B", spec: "", acceptance: [], checks: [], paths: [], model: "p/r", status: "running",
      startedAt: 100_000, cost: 0.25, toolCalls: 2, activity: "read a.ts", lastEventAt: 130_000 },
  ],
});

test("state round-trips and lists newest first", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-state-"));
  saveState(state(dir, "old", 1));
  saveState(state(dir, "new", 2));
  assert.deepEqual(listCrews(dir).map((s) => s.config.slug), ["new", "old"]);
  assert.equal(loadState(dir, "old").tasks.length, 2);
  assert.deepEqual(listCrews(join(dir, "missing")), []);
});

test("status shows spend, liveness, and review targets", () => {
  const s = state("/x", "s", 0);
  assert.equal(spent(s), 0.75);
  const out = formatStatus(s, 160_000);
  assert.match(out, /spent \$0\.75 of \$5\.00 · 1\/3 running/);
  assert.match(out, /#1 implement \[integrated\] "A" · p\/w · 1m05s/);
  assert.match(out, /#2 review of #1 \[running\] .* 1m00s, last event 30s ago · \$0\.25 · 2 tools · read a\.ts/);
});

test("the widget lists running tasks only, flagging quiet ones", () => {
  const s = state("/x", "s", 0);
  assert.deepEqual(formatWidget(s, "hint", 160_000), [
    "crew s \u00b7 1/3 running \u00b7 $0.75/$5.00 \u00b7 hint",
    " #2 review      1m00s    2 tools  $0.25  read a.ts",
  ]);
  assert.match(formatWidget(s, "hint", 191_000)[1], /1m31s .* \(quiet 61s\) read a\.ts$/);
});

test("slugs are short, safe, and unique-ish", () => {
  const slug = slugify("Add OAuth login & refresh tokens to the API gateway!!");
  assert.match(slug, /^add-oauth-login-refresh-tokens-t-[a-z0-9]{4}$/);
  assert.match(slugify("!!!"), /^crew-/);
});
