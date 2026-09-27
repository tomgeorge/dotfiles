import assert from "node:assert/strict";
import { test } from "node:test";
import { Parser, type Command } from "./keys.ts";

function parse(keys: string): Command | null | "pending" {
  const p = new Parser();
  const tokens = keys.match(/<C-r>|./gu)!;
  for (const [i, k] of tokens.entries()) {
    const r = p.feed(k);
    if (r.done) {
      assert.equal(i, tokens.length - 1, `finished early at ${i} in ${keys}`);
      return r.command;
    }
  }
  return "pending";
}

test("motions with and without counts", () => {
  assert.deepEqual(parse("w"), { type: "motion", motion: { key: "w" }, count: null });
  assert.deepEqual(parse("12j"), { type: "motion", motion: { key: "j" }, count: 12 });
  assert.deepEqual(parse("0"), { type: "motion", motion: { key: "0" }, count: null });
  assert.deepEqual(parse("10G"), { type: "motion", motion: { key: "G" }, count: 10 });
  assert.deepEqual(parse("gg"), { type: "motion", motion: { key: "gg" }, count: null });
  assert.deepEqual(parse("2fx"), { type: "motion", motion: { key: "f", arg: "x" }, count: 2 });
});

test("operators: counts multiply, doubled operator is linewise", () => {
  assert.deepEqual(parse("2d3w"), { type: "operator", op: "d", count: 6, register: null, target: { motion: { key: "w" } } });
  assert.deepEqual(parse("d3w"), { type: "operator", op: "d", count: 3, register: null, target: { motion: { key: "w" } } });
  assert.deepEqual(parse("dw"), { type: "operator", op: "d", count: null, register: null, target: { motion: { key: "w" } } });
  assert.deepEqual(parse("3cc"), { type: "operator", op: "c", count: 3, register: null, target: { line: true } });
  assert.deepEqual(parse("d0"), { type: "operator", op: "d", count: null, register: null, target: { motion: { key: "0" } } });
  assert.deepEqual(parse("dgg"), { type: "operator", op: "d", count: null, register: null, target: { motion: { key: "gg" } } });
  assert.deepEqual(parse("dt)"), { type: "operator", op: "d", count: null, register: null, target: { motion: { key: "t", arg: ")" } } });
});

test("text objects", () => {
  assert.deepEqual(parse("ci("), { type: "operator", op: "c", count: null, register: null, target: { object: { key: "(", inner: true } } });
  assert.deepEqual(parse("d2aw"), { type: "operator", op: "d", count: 2, register: null, target: { object: { key: "w", inner: false } } });
});

test("registers and simple commands", () => {
  assert.deepEqual(parse('"_dd'), { type: "operator", op: "d", count: null, register: "_", target: { line: true } });
  assert.deepEqual(parse('3"ap'), { type: "simple", key: "p", count: 3, register: "a" });
  assert.deepEqual(parse("rx"), { type: "simple", key: "r", count: null, register: null, arg: "x" });
  assert.deepEqual(parse("<C-r>"), { type: "simple", key: "<C-r>", count: null, register: null });
});

test("pending states and invalid keys", () => {
  assert.equal(parse("d"), "pending");
  assert.equal(parse("2d3"), "pending");
  assert.equal(parse("di"), "pending");
  assert.equal(parse("g"), "pending");
  assert.equal(parse("f"), "pending");
  assert.equal(parse("z"), null);
  assert.equal(parse("dz"), null);
  assert.equal(parse("gz"), null);
  assert.equal(parse("diz"), null);
});

test("pending shows what was typed and clears when done", () => {
  const p = new Parser();
  p.feed("2");
  p.feed("d");
  assert.equal(p.pending, "2d");
  p.feed("w");
  assert.equal(p.pending, "");
});
