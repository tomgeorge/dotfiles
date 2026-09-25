import assert from "node:assert/strict";
import { test } from "node:test";
import { formatElapsed, JobRegistry, parseMaxConcurrent, validateLabel } from "./registry.ts";

const add = (registry: JobRegistry, label?: string) => registry.add(label, "test/model", new AbortController());

test("validateLabel accepts short slugs and rejects ambiguous or malformed labels", () => {
  for (const label of ["auth-review", "a1", "x", "a".repeat(64)]) validateLabel(label);
  for (const label of ["", "all", "12", "-x", "Auth", "has space", "a_b", "a".repeat(65)]) {
    assert.throws(() => validateLabel(label), Error, label);
  }
});

test("add fails when full and succeeds again after remove", () => {
  const registry = new JobRegistry(2);
  const first = add(registry, "one");
  add(registry, "two");
  assert.throws(() => add(registry, "three"), /2 subagents are already running/);
  registry.remove(first.id);
  add(registry, "three");
  assert.equal(registry.size, 2);
});

test("labels are unique among running jobs only", () => {
  const registry = new JobRegistry(10);
  const first = add(registry, "auth-review");
  assert.throws(() => add(registry, "auth-review"), /already used by running job #1/);
  registry.remove(first.id);
  assert.equal(add(registry, "auth-review").label, "auth-review");
});

test("invalid labels are rejected before taking a slot", () => {
  const registry = new JobRegistry(1);
  assert.throws(() => add(registry, "all"));
  assert.equal(registry.size, 0);
});

test("ids are never reused; omitted labels become job-<id>", () => {
  const registry = new JobRegistry(10);
  const first = add(registry);
  registry.remove(first.id);
  const second = add(registry);
  assert.equal(first.label, "job-1");
  assert.equal(second.id, 2);
  assert.equal(second.label, "job-2");
  assert.equal(registry.find("1"), undefined);
});

test("find and cancel match by label or number and abort only that job", () => {
  const registry = new JobRegistry(10);
  const a = add(registry, "alpha");
  const b = add(registry, "beta");
  assert.equal(registry.find("2"), b);
  assert.equal(registry.find("#2"), b);
  assert.equal(registry.cancel("alpha"), a);
  assert.ok(a.controller.signal.aborted);
  assert.ok(!b.controller.signal.aborted);
  assert.equal(registry.cancel("missing"), undefined);
  registry.cancelAll();
  assert.ok(b.controller.signal.aborted);
});

test("parseMaxConcurrent defaults to 10 and falls back with a warning", () => {
  assert.deepEqual(parseMaxConcurrent(undefined), { max: 10 });
  assert.deepEqual(parseMaxConcurrent(""), { max: 10 });
  assert.deepEqual(parseMaxConcurrent("4"), { max: 4 });
  for (const value of ["0", "-1", "x", "2.5", "1e3"]) {
    const result = parseMaxConcurrent(value);
    assert.equal(result.max, 10, value);
    assert.match(result.warning!, /PI_SUBAGENT_MAX_CONCURRENT/);
  }
});

test("formatElapsed", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12_000), "12s");
  assert.equal(formatElapsed(59_999), "59s");
  assert.equal(formatElapsed(60_000), "1m00s");
  assert.equal(formatElapsed(72_000), "1m12s");
});
