import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeaderBinding } from "./leaderContract.ts";
import { LeaderRegistry, type CoreBinding } from "./leaderRegistry.ts";

const CORE: CoreBinding[] = [
  { id: "model.select", path: [{ key: "m", label: "models" }, { key: "m", label: "select", detail: "choose model" }], target: { app: "app.model.select" } },
  { id: "model.next", path: [{ key: "m", label: "models" }, { key: "n", label: "next" }], target: { app: "app.model.cycleForward" } },
  { id: "session.new", path: [{ key: "s", label: "sessions" }, { key: "n", label: "new" }], target: { app: "app.session.new" } },
  { id: "session.resume", path: [{ key: "s", label: "sessions" }, { key: "r", label: "resume" }], target: { app: "app.session.resume" } },
  { id: "session.fork", path: [{ key: "s", label: "sessions" }, { key: "f", label: "fork" }], target: { app: "app.session.fork" } },
  { id: "quit", path: [{ key: "q", label: "quit" }, { key: "q", label: "quit" }], target: { command: { name: "quit" } } },
];

const LIST: LeaderBinding = { id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } };
const STATUS: LeaderBinding = { id: "status", path: [{ key: "c", label: "crew" }, { key: "s", label: "status" }], command: { name: "crew-status" } };

const keys = (r: LeaderRegistry, path: string[] = []) => r.group(path)?.options.map((o) => o.key);
const option = (r: LeaderRegistry, path: string[], key: string) => r.group(path)?.options.find((o) => o.key === key);
const messages = (d: { message: string }[]) => d.map((x) => x.message);

test("core bindings load first, sorted by key at every level", () => {
  const r = new LeaderRegistry(CORE);
  assert.deepEqual(keys(r), ["m", "q", "s"]);
  // Declared new/resume/fork; shown by key.
  assert.deepEqual(keys(r, ["s"]), ["f", "n", "r"]);
  assert.deepEqual(r.group(["m"]), {
    label: "models",
    options: [
      { key: "m", label: "select", detail: "choose model", hasChildren: false, target: { app: "app.model.select" } },
      { key: "n", label: "next", hasChildren: false, target: { app: "app.model.cycleForward" } },
    ],
  });
  assert.equal(r.group(["m", "m"]), undefined, "a leaf isn't a group");
  assert.equal(r.group(["z"]), undefined);
  assert.deepEqual(r.diagnostics(), []);
});

test("a conflict among core bindings throws", () => {
  const dup: CoreBinding = { id: "other", path: [{ key: "q", label: "quit" }, { key: "q", label: "other" }], target: { command: { name: "other" } } };
  assert.throws(() => new LeaderRegistry([...CORE, dup]), /taken over from core/);
  const relabel: CoreBinding = { id: "x", path: [{ key: "q", label: "leave" }, { key: "x", label: "x" }], target: { command: { name: "x" } } };
  assert.throws(() => new LeaderRegistry([...CORE, relabel]), /keeps the label/);
});

test("merges a contribution into the tree", () => {
  const r = new LeaderRegistry(CORE);
  assert.deepEqual(r.register({ source: "crew", bindings: [STATUS, LIST] }), { accepted: true, diagnostics: [] });
  assert.deepEqual(keys(r), ["c", "m", "q", "s"]);
  assert.deepEqual(option(r, [], "c"), { key: "c", label: "crew", hasChildren: true });
  assert.deepEqual(r.group(["c"])?.options, [
    { key: "l", label: "list", hasChildren: false, target: { command: { name: "crews" } } },
    { key: "s", label: "status", hasChildren: false, target: { command: { name: "crew-status" } } },
  ]);
});

test("carries tones through, and ignores an unknown tone without rejecting", () => {
  const r = new LeaderRegistry();
  const result = r.register({
    source: "crew",
    bindings: [
      { id: "stop", path: [{ key: "c", label: "crew" }, { key: "x", label: "stop", tone: "exit" }], command: { name: "crew-stop" } },
      { id: "open", path: [{ key: "c", label: "crew" }, { key: "o", label: "open", tone: "shouting" }], command: { name: "crew" } },
    ],
  });
  assert.deepEqual(result, { accepted: true, diagnostics: [] });
  assert.equal(option(r, ["c"], "x")?.tone, "exit");
  assert.equal(option(r, ["c"], "o")?.tone, undefined);
});

test("lower-cases keys and otherwise keeps text exactly as sent", () => {
  const r = new LeaderRegistry();
  const result = r.register({ source: "crew", bindings: [{ id: "list", path: [{ key: "C", label: "crew" }, { key: "L", label: "list" }], command: { name: "crews", args: " all " } }] });
  assert.equal(result.accepted, true);
  assert.deepEqual(r.bindings(), [{ keys: ["c", "l"], labels: ["crew", "list"], target: { command: { name: "crews", args: " all " } }, source: "crew" }]);
});

test("checks raw text, so trimming can't launder a bad value", () => {
  const r = new LeaderRegistry();
  const one = { key: "c", label: "crew" };
  const cases: [unknown, RegExp][] = [
    [{ id: "x", path: [{ key: " c ", label: "\ncrew" }], command: { name: "crews\n" } }, /key must be one character[\s\S]*label must be 1-32[\s\S]*name must not contain whitespace/],
    [{ id: "x", path: [{ key: " c ", label: "crew" }], command: { name: "crews" } }, /key must be one character/],
    [{ id: "x", path: [{ key: "c", label: "\ncrew" }], command: { name: "crews" } }, /label must be 1-32 characters with no control/],
    [{ id: "x", path: [{ key: "c", label: " crew" }], command: { name: "crews" } }, /label must not have leading or trailing whitespace/],
    [{ id: "x", path: [{ key: "c", label: "crew", detail: "list\u001b" }], command: { name: "crews" } }, /detail must be at most 80 characters with no control/],
    [{ id: "x", path: [{ key: "c", label: "crew", detail: "list " }], command: { name: "crews" } }, /detail must not have leading/],
    [{ id: "x", path: [one], command: { name: "crews\n" } }, /name must not contain whitespace/],
    [{ id: "x", path: [one], command: { name: " crews" } }, /name must not contain whitespace/],
    [{ id: "x", path: [one], command: { name: "crews", args: "all\n" } }, /args must not contain control/],
    [{ id: "x\n", path: [one], command: { name: "crews" } }, /id must be 1-128 characters with no control/],
    [{ id: " x", path: [one], command: { name: "crews" } }, /id must not have leading/],
  ];
  for (const [binding, pattern] of cases) {
    const result = r.register({ source: "crew", bindings: [binding] });
    assert.equal(result.accepted, false, `${JSON.stringify(binding)} accepted`);
    assert.match(messages(result.diagnostics).join("\n"), pattern, JSON.stringify(binding));
  }
  assert.deepEqual(r.bindings(), []);
});

test("rejects a malformed contribution whole, keeping the previous one", () => {
  const r = new LeaderRegistry();
  r.register({ source: "crew", bindings: [LIST] });
  const bad = (bindings: unknown[]) => r.register({ source: "crew", bindings: [STATUS, ...bindings] });
  const cases: [unknown[], RegExp][] = [
    [[{ id: "a", path: [{ key: "!", label: "x" }], command: { name: "x" } }], /key must be one character/],
    [[{ id: "a", path: [{ key: "ab", label: "x" }], command: { name: "x" } }], /key must be one character/],
    [[{ id: "a", path: [{ key: "a", label: "" }], command: { name: "x" } }], /label must be 1-32/],
    [[{ id: "a", path: [{ key: "a", label: "x".repeat(33) }], command: { name: "x" } }], /label must be 1-32/],
    [[{ id: "a", path: [{ key: "a", label: "bad\u001b[31m" }], command: { name: "x" } }], /control/],
    [[{ id: "a", path: [{ key: "a", label: "x", detail: "d".repeat(81) }], command: { name: "x" } }], /detail must be at most 80/],
    [[{ id: "a", path: [{ key: "a", label: "x", detail: "a\nb" }], command: { name: "x" } }], /detail/],
    [[{ id: "a", path: [], command: { name: "x" } }], /1-4 segments/],
    [[{ id: "a", path: ["a", "b", "c", "d", "e"].map((key) => ({ key, label: key })), command: { name: "x" } }], /1-4 segments/],
    [[{ id: "", path: [{ key: "a", label: "x" }], command: { name: "x" } }], /id must be/],
    [[{ path: [{ key: "a", label: "x" }], command: { name: "x" } }], /id must be a string/],
    [[STATUS], /duplicated/],
    [[{ id: "a", path: [{ key: "a", label: "x" }] }], /needs a command/],
    [[{ id: "a", path: [{ key: "a", label: "x" }], app: "app.exit" }], /can't use an app target/],
    [[{ id: "a", path: [{ key: "a", label: "x" }], command: { name: "x" }, app: "app.exit" }], /can't use an app target/],
    [[{ id: "a", path: [{ key: "a", label: "x" }], command: { name: "/x" } }], /must not start with \//],
    [[{ id: "a", path: [{ key: "a", label: "x" }], command: { name: "goal status" } }], /whitespace/],
    [[{ id: "a", path: [{ key: "a", label: "x" }], command: { name: "" } }], /must not be empty/],
    [[{ id: "a", path: [{ key: "a", label: "x" }], command: "x" }], /command must be an object/],
    [["nope"], /must be an object/],
  ];
  for (const [bindings, pattern] of cases) {
    const result = bad(bindings);
    assert.equal(result.accepted, false, `${JSON.stringify(bindings)} accepted`);
    assert.match(messages(result.diagnostics).join("\n"), pattern);
  }
  assert.deepEqual(keys(r, ["c"]), ["l"], "the valid binding STATUS didn't land either");
});

test("rejects a bad source, a reserved source, and a non-array", () => {
  const r = new LeaderRegistry();
  assert.equal(r.register(null).accepted, false);
  assert.match(messages(r.register({}).diagnostics)[0] ?? "", /source/);
  assert.equal(r.register({ source: "bad source", bindings: [] }).accepted, false);
  assert.equal(r.register({ source: "-crew", bindings: [] }).accepted, false);
  assert.equal(r.register({ source: "a".repeat(129), bindings: [] }).accepted, false);
  for (const source of ["crew\n", "crew\r", "\ncrew", "cr\u0000ew", " crew"]) {
    assert.equal(r.register({ source, bindings: [LIST] }).accepted, false, JSON.stringify(source));
  }
  assert.deepEqual(r.bindings(), []);
  assert.equal(r.register({ source: "@scope/pkg.name:x_y-z", bindings: [] }).accepted, true);
  assert.match(messages(r.register({ source: "user", bindings: [LIST] }).diagnostics)[0] ?? "", /reserved/);
  assert.match(messages(r.register({ source: "crew", bindings: "nope" }).diagnostics)[0] ?? "", /array/);
});

test("an empty list unregisters, and a re-registration replaces the source's bindings", () => {
  const r = new LeaderRegistry();
  r.register({ source: "crew", bindings: [LIST] });
  r.register({ source: "crew", bindings: [{ id: "w", path: [{ key: "w", label: "watches" }], command: { name: "watches" } }] });
  assert.deepEqual(keys(r), ["w"]);
  r.register({ source: "crew", bindings: [] });
  assert.deepEqual(keys(r), []);
  assert.deepEqual(r.bindings(), []);
});

test("a leaf takeover wins, is reported, and is undone when the winner unregisters", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  const result = r.register({ source: "other", bindings: [{ id: "x", path: [{ key: "c", label: "crew" }, { key: "l", label: "ls" }], command: { name: "ls" } }] });
  assert.deepEqual(messages(result.diagnostics), ["c l taken over from crew"]);
  assert.deepEqual(option(r, ["c"], "l"), { key: "l", label: "ls", hasChildren: false, target: { command: { name: "ls" } } });
  assert.deepEqual(messages(r.diagnostics()), ["c l taken over from crew"]);

  r.register({ source: "other", bindings: [] });
  assert.deepEqual(option(r, ["c"], "l")?.target, { command: { name: "crews" } });
  assert.deepEqual(r.diagnostics(), []);
});

test("a contribution can take a key from core", () => {
  const r = new LeaderRegistry(CORE);
  const result = r.register({ source: "x", bindings: [{ id: "m", path: [{ key: "m", label: "models" }, { key: "m", label: "mine" }], command: { name: "mine" } }] });
  assert.deepEqual(messages(result.diagnostics), ["m m taken over from core"]);
  assert.deepEqual(option(r, ["m"], "m")?.target, { command: { name: "mine" } });
});

test("a leaf replacing a group, and a group replacing a leaf, are both reported", () => {
  const r = new LeaderRegistry(CORE);
  const leaf = r.register({ source: "x", bindings: [{ id: "s", path: [{ key: "s", label: "search" }], command: { name: "search" } }] });
  assert.deepEqual(messages(leaf.diagnostics), ["s taken over from core, displacing 3 bindings"]);
  assert.equal(r.group(["s"]), undefined);

  const group = r.register({ source: "y", bindings: [{ id: "q", path: [{ key: "q", label: "quit" }, { key: "q", label: "quit" }, { key: "x", label: "deep" }], command: { name: "deep" } }] });
  assert.deepEqual(messages(group.diagnostics), ["q q taken over from core to open a group"]);
  assert.deepEqual(keys(r, ["q", "q"]), ["x"]);
});

test("re-registering moves a source to the back, so it wins again", () => {
  const r = new LeaderRegistry();
  const mine = (name: string): LeaderBinding[] => [{ id: "k", path: [{ key: "k", label: name }], command: { name } }];
  r.register({ source: "a", bindings: mine("a") });
  r.register({ source: "b", bindings: mine("b") });
  assert.deepEqual(option(r, [], "k")?.target, { command: { name: "b" } });
  const again = r.register({ source: "a", bindings: mine("a") });
  assert.deepEqual(option(r, [], "k")?.target, { command: { name: "a" } });
  assert.deepEqual(messages(again.diagnostics), ["k taken over from b"]);
});

test("within one contribution, bindings insert in id order", () => {
  const r = new LeaderRegistry();
  const result = r.register({
    source: "a",
    bindings: [
      { id: "z", path: [{ key: "k", label: "z" }], command: { name: "z" } },
      { id: "b", path: [{ key: "k", label: "b" }], command: { name: "b" } },
    ],
  });
  assert.deepEqual(option(r, [], "k")?.target, { command: { name: "z" } });
  assert.deepEqual(messages(result.diagnostics), ["k taken over from a"]);
});

test("a group label disagreement keeps the first label and still binds", () => {
  const r = new LeaderRegistry();
  r.register({ source: "crew", bindings: [LIST] });
  const result = r.register({ source: "other", bindings: [{ id: "y", path: [{ key: "c", label: "crews", detail: "all crews" }, { key: "y", label: "yank" }], command: { name: "yank" } }] });
  assert.equal(result.accepted, true);
  assert.deepEqual(messages(result.diagnostics), ['c keeps the label "crew" from crew, not "crews"']);
  assert.equal(r.group(["c"])?.label, "crew");
  assert.deepEqual(keys(r, ["c"]), ["l", "y"]);
  // A group without a detail adopts the first one offered.
  assert.equal(option(r, [], "c")?.detail, "all crews");
});

test("subscribers hear every rebuild until they unsubscribe", () => {
  const r = new LeaderRegistry();
  let calls = 0;
  const off = r.subscribe(() => calls++);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([]);
  r.register(null); // rejected: no rebuild
  off();
  r.register({ source: "crew", bindings: [] });
  assert.equal(calls, 2);
});

test("bindings() lists every leaf with its path, labels, target, and source", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([{ keys: ["o"], label: "open", command: { name: "crews" } }]);
  const leaves = r.bindings();
  assert.deepEqual(leaves.map((l) => `${l.keys.join(" ")} ${l.labels.join(" › ")} ${l.source}`), [
    "c l crew › list crew",
    "m m models › select core",
    "m n models › next core",
    "o open user",
    "q q quit › quit core",
    "s f sessions › fork core",
    "s n sessions › new core",
    "s r sessions › resume core",
  ]);
  assert.deepEqual(leaves[1]?.target, { app: "app.model.select" });
  assert.equal(leaves[1]?.detail, "choose model");
});

// --- the user keymap ---------------------------------------------------------

test("a keymap bind beats a contribution and isn't reported", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([{ keys: ["c", "l"], label: "mine", command: { name: "mine", args: "x" } }]);
  assert.deepEqual(option(r, ["c"], "l"), { key: "l", label: "mine", hasChildren: false, target: { command: { name: "mine", args: "x" } } });
  assert.deepEqual(r.diagnostics(), []);
  assert.equal(r.bindings().find((l) => l.keys.join(" ") === "c l")?.source, "user");
});

test("a contribution re-registering doesn't beat the keymap", () => {
  const r = new LeaderRegistry();
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([{ keys: ["c", "l"], label: "mine", command: { name: "mine" } }]);
  r.register({ source: "crew", bindings: [LIST] });
  assert.deepEqual(option(r, ["c"], "l")?.target, { command: { name: "mine" } });
});

test("a keymap bind creates missing groups labelled with their key until relabelled", () => {
  const r = new LeaderRegistry();
  r.setKeymap([{ keys: ["x", "y", "z"], label: "deep", tone: "exit", command: { name: "deep" } }]);
  assert.deepEqual(option(r, [], "x"), { key: "x", label: "x", hasChildren: true });
  assert.equal(r.group(["x", "y"])?.label, "y");
  assert.equal(option(r, ["x", "y"], "z")?.tone, "exit");
  r.setKeymap([
    { keys: ["x", "y", "z"], label: "deep", command: { name: "deep" } },
    { keys: ["x"], label: "extra", detail: "my stuff" },
  ]);
  assert.deepEqual(option(r, [], "x"), { key: "x", label: "extra", detail: "my stuff", hasChildren: true });
});

test("a keymap bind can turn a leaf into a group, silently", () => {
  const r = new LeaderRegistry(CORE);
  r.setKeymap([{ keys: ["q", "q", "a"], label: "all", command: { name: "quit-all" } }]);
  assert.deepEqual(keys(r, ["q", "q"]), ["a"]);
  assert.deepEqual(r.diagnostics(), []);
});

test("a keymap label relabels a group, and creates an empty one that isn't shown", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([
    { keys: ["c"], label: "crews!" },
    { keys: ["z"], label: "later" },
  ]);
  assert.equal(option(r, [], "c")?.label, "crews!");
  assert.equal(r.group(["c"])?.label, "crews!");
  assert.deepEqual(keys(r), ["c", "m", "q", "s"]);
  assert.equal(r.group(["z"]), undefined);
  // A later binding fills it.
  r.setKeymap([
    { keys: ["z"], label: "later" },
    { keys: ["z", "a"], label: "a", command: { name: "a" } },
  ]);
  assert.deepEqual(option(r, [], "z"), { key: "z", label: "later", hasChildren: true });
});

test("a label-only keymap entry never destroys a leaf on its path", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([
    { keys: ["q", "q", "x"], label: "later" },
    { keys: ["c", "l", "x", "y"], label: "deeper" },
  ]);
  const leaves = r.bindings().map((b) => b.keys.join(" "));
  assert.ok(leaves.includes("q q"), "the quit leaf survives");
  assert.ok(leaves.includes("c l"), "the crew leaf survives");
  assert.equal(option(r, ["q"], "q")?.hasChildren, false);
  assert.deepEqual(messages(r.diagnostics()), [
    "q q x skipped: q q is a binding, and a label-only entry can't replace it",
    "c l x y skipped: c l is a binding, and a label-only entry can't replace it",
  ]);
  assert.ok(r.diagnostics().every((d) => d.source === "user"));

  // The plan's repro: a top-level leaf, then a label-only entry under it.
  const top = new LeaderRegistry();
  top.register({ source: "x", bindings: [{ id: "q", path: [{ key: "q", label: "quit" }], command: { name: "quit" } }] });
  top.setKeymap([{ keys: ["q", "x"], label: "later" }]);
  assert.deepEqual(top.bindings().map((b) => b.keys), [["q"]]);

  // A keymap bind still wins over the same leaf.
  top.setKeymap([{ keys: ["q", "x"], label: "x", command: { name: "x" } }]);
  assert.deepEqual(top.bindings().map((b) => b.keys), [["q", "x"]]);
  assert.deepEqual(top.diagnostics(), []);
});

test("a keymap unbind removes a leaf or a whole group", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST, STATUS] });
  r.setKeymap([
    { keys: ["q", "q"], unbind: true },
    { keys: ["c", "l"], unbind: true },
    { keys: ["m"], unbind: true },
  ]);
  assert.deepEqual(keys(r), ["c", "s"], "q is empty, so hidden; m is gone");
  assert.deepEqual(keys(r, ["c"]), ["s"]);
  assert.equal(r.group(["q"]), undefined);
  assert.deepEqual(r.diagnostics(), []);
});

test("unbinding a path that doesn't exist is reported", () => {
  const r = new LeaderRegistry(CORE);
  r.setKeymap([
    { keys: ["z", "z"], unbind: true },
    { keys: ["q", "q", "q"], unbind: true },
    { keys: ["q", "x"], unbind: true },
  ]);
  assert.deepEqual(r.diagnostics(), [
    { source: "user", message: "z z isn't bound, so there's nothing to unbind" },
    { source: "user", message: "q q q isn't bound, so there's nothing to unbind" },
    { source: "user", message: "q x isn't bound, so there's nothing to unbind" },
  ]);
});

test("moving a binding is an unbind plus a bind, applied in file order", () => {
  const r = new LeaderRegistry(CORE);
  r.register({ source: "crew", bindings: [LIST] });
  r.setKeymap([
    { keys: ["c", "l"], unbind: true },
    { keys: ["l"], label: "crews", command: { name: "crews" } },
  ]);
  assert.deepEqual(keys(r), ["l", "m", "q", "s"]);
  assert.deepEqual(option(r, [], "l")?.target, { command: { name: "crews" } });
  // Unbinding after binding removes it again: order matters.
  r.setKeymap([
    { keys: ["l"], label: "crews", command: { name: "crews" } },
    { keys: ["l"], unbind: true },
  ]);
  assert.equal(option(r, [], "l"), undefined);
});

test("the keymap survives contributions coming and going", () => {
  const r = new LeaderRegistry();
  r.setKeymap([{ keys: ["c", "l"], unbind: true }]);
  assert.equal(r.diagnostics().length, 1, "nothing to unbind yet");
  r.register({ source: "crew", bindings: [LIST, STATUS] });
  assert.deepEqual(keys(r, ["c"]), ["s"]);
  assert.deepEqual(r.diagnostics(), []);
});
