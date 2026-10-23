import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultLeaderConfig, loadLeaderConfig, parseLeaderConfig } from "./leaderConfig.ts";

const DEFAULTS = { leader: { key: " ", name: "SPC" }, keymap: [] };

function withFile(content: string | undefined, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "leader-config-"));
  try {
    const path = join(dir, "leader.json");
    if (content !== undefined) writeFileSync(path, content);
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const errorsOf = (value: unknown) => parseLeaderConfig(value).errors;

test("a missing file is the defaults with no errors", () => {
  withFile(undefined, (path) => {
    assert.deepEqual(loadLeaderConfig(path), { config: DEFAULTS, errors: [] });
  });
  assert.deepEqual(defaultLeaderConfig(), DEFAULTS);
});

test("a valid file parses every entry kind", () => {
  const file = {
    leader: "space",
    keymap: [
      { keys: "c", label: " crew " },
      { keys: "C L", label: "list", command: "crews" },
      { keys: "g s", label: "status", command: "goal  status --verbose ", detail: "show the goal", tone: "exit" },
      { keys: "  q   q ", unbind: true },
    ],
  };
  withFile(JSON.stringify(file), (path) => {
    assert.deepEqual(loadLeaderConfig(path), {
      config: {
        leader: { key: " ", name: "SPC" },
        keymap: [
          { keys: ["c"], label: "crew" },
          { keys: ["c", "l"], label: "list", command: { name: "crews" } },
          { keys: ["g", "s"], label: "status", command: { name: "goal", args: "status --verbose" }, detail: "show the goal", tone: "exit" },
          { keys: ["q", "q"], unbind: true },
        ],
      },
      errors: [],
    });
  });
});

test("both fields are optional", () => {
  assert.deepEqual(parseLeaderConfig({}), { config: DEFAULTS, errors: [] });
  assert.deepEqual(parseLeaderConfig({ leader: "\\" }), { config: { leader: { key: "\\", name: "\\" }, keymap: [] }, errors: [] });
});

test("a custom leader must be a key NORMAL mode leaves unused", () => {
  for (const leader of ["\\", "Q", "z", "-", "+", "!", "é", " "]) {
    assert.deepEqual(errorsOf({ leader }), [], `leader ${leader}`);
  }
  for (const leader of ["d", ",", "1", "0", "g", "f", "x", "i", '"', "$", "~", "r"]) {
    assert.match(errorsOf({ leader }).join(""), /vi NORMAL-mode key/, `leader ${leader}`);
  }
  for (const leader of ["", "ab", "\u001b", "\t", 32, null, "SPC"]) {
    assert.match(errorsOf({ leader }).join(""), /"space" or one printable character/, `leader ${JSON.stringify(leader)}`);
  }
});

test("each kind of error is reported", () => {
  const cases: [unknown, RegExp][] = [
    [[], /must be a JSON object/],
    [{ leaders: "space" }, /unknown field "leaders"/],
    [{ keymap: {} }, /keymap must be an array/],
    [{ keymap: ["c"] }, /keymap\[0\]: must be an object/],
    [{ keymap: [{ label: "x", command: "x" }] }, /keys must be a string/],
    [{ keymap: [{ keys: "", label: "x" }] }, /keys must have 1-4 keys/],
    [{ keymap: [{ keys: "a b c d e", label: "x" }] }, /keys must have 1-4 keys/],
    [{ keymap: [{ keys: "cl", label: "x" }] }, /key "cl" must be one character/],
    [{ keymap: [{ keys: "!", label: "x" }] }, /key "!" must be one character/],
    [{ keymap: [{ keys: "c" }] }, /needs a label/],
    [{ keymap: [{ keys: "c", label: "" }] }, /label must be 1-32/],
    [{ keymap: [{ keys: "c", label: "x".repeat(33) }] }, /label must be 1-32/],
    [{ keymap: [{ keys: "c", label: "a\u0007" }] }, /label must be 1-32 characters with no control/],
    // Control characters are checked before trimming, so edges don't hide them.
    [{ keymap: [{ keys: "c", label: "\ncrew" }] }, /label must be 1-32 characters with no control/],
    [{ keymap: [{ keys: "c", label: "crew\u001b" }] }, /label must be 1-32 characters with no control/],
    [{ keymap: [{ keys: "c", label: "x", detail: "\tshow" }] }, /detail must be at most 80 characters with no control/],
    [{ keymap: [{ keys: "c", label: "x", detail: "show\n" }] }, /detail must be at most 80 characters with no control/],
    [{ keymap: [{ keys: "c", label: "x", command: "crews\n" }] }, /command must not contain control/],
    [{ keymap: [{ keys: "\nc", label: "x" }] }, /keys must not contain control/],
    [{ keymap: [{ keys: "c", label: "x", command: "/crews" }] }, /command name must not start with \//],
    [{ keymap: [{ keys: "c", label: "x", command: "" }] }, /command name must not be empty/],
    [{ keymap: [{ keys: "c", label: "x", command: ["crews"] }] }, /command must be a string/],
    [{ keymap: [{ keys: "c", label: "x", command: "a b\u0000" }] }, /control/],
    [{ keymap: [{ keys: "c", label: "x", detail: "d".repeat(81) }] }, /detail must be at most 80/],
    [{ keymap: [{ keys: "c", label: "x", detail: 3 }] }, /detail must be a string/],
    [{ keymap: [{ keys: "c", label: "x", tone: "loud" }] }, /tone must be "default" or "exit"/],
    [{ keymap: [{ keys: "c", label: "x", action: "y" }] }, /keymap\[0\]: unknown field "action"/],
    [{ keymap: [{ keys: "c", unbind: false }] }, /unbind must be true/],
    [{ keymap: [{ keys: "c", unbind: true, label: "x" }] }, /an unbind entry can't have label/],
    [{ keymap: [{ keys: "c", unbind: true, command: "x" }] }, /an unbind entry can't have command/],
  ];
  for (const [value, pattern] of cases) {
    const { config, errors } = parseLeaderConfig(value);
    assert.match(errors.join("\n"), pattern, JSON.stringify(value));
    assert.deepEqual(config, DEFAULTS, JSON.stringify(value));
  }
});

test("any error rejects the whole file, and every error is returned", () => {
  const result = parseLeaderConfig({
    leader: "\\",
    keymap: [
      { keys: "c l", label: "list", command: "crews" },
      { keys: "q q", unbind: "yes" },
      { keys: "x", label: "x", command: "/x" },
    ],
  });
  assert.deepEqual(result.config, DEFAULTS);
  assert.deepEqual(result.errors, ["keymap[1]: unbind must be true", "keymap[2]: command name must not start with /"]);

  const badLeader = parseLeaderConfig({ leader: "d", keymap: [{ keys: "c", label: "crew" }] });
  assert.deepEqual(badLeader.config, DEFAULTS);
  assert.equal(badLeader.errors.length, 1);
});

test("a file that isn't JSON is the defaults plus an error", () => {
  withFile("{ leader: space", (path) => {
    const { config, errors } = loadLeaderConfig(path);
    assert.deepEqual(config, DEFAULTS);
    assert.match(errors.join(""), /not valid JSON/);
  });
});

test("an unreadable path is the defaults plus an error", () => {
  withFile(undefined, (path) => {
    // A directory: reading it fails with EISDIR, not ENOENT.
    const { config, errors } = loadLeaderConfig(join(path, ".."));
    assert.deepEqual(config, DEFAULTS);
    assert.match(errors.join(""), /can't read/);
  });
});
