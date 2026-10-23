import assert from "node:assert/strict";
import { test } from "node:test";
import { box, clean, duration, elapsedClock, expandTabs, money, oneLine, padStart, tildify, wallClock, type Style } from "./format.ts";

// Plain text: one column per code point, no colors, so assertions read like the screen.
const plain: Style = {
  fg: (_tone, text) => text,
  bold: (text) => text,
  selected: (text) => text,
  width: (text) => [...text].length,
  truncate(text, width, pad) {
    const chars = [...text];
    const cut = chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join("") + (width > 0 ? "…" : "") : text;
    return pad ? cut + " ".repeat(Math.max(0, width - [...cut].length)) : cut;
  },
  wrap: (text) => text.split("\n"),
};

test("formats durations and money compactly", () => {
  assert.deepEqual([0, 12_400, 64_000, 3_720_000].map(duration), ["0s", "12s", "1m04s", "1h02m"]);
  assert.deepEqual([0, 0.004, 0.281].map(money), ["$0.00", "<$0.01", "$0.28"]);
});

test("elapsedClock counts mm:ss from a start; wallClock is the local time of day", () => {
  assert.deepEqual([0, 5_900, 61_000, 3_725_000].map(elapsedClock), ["00:00", "00:05", "01:01", "62:05"]);
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
  assert.equal(wallClock(at), "03:04:05");
});

test("worker text is cleaned of escapes, tabs, and control characters before layout", () => {
  assert.equal(clean("a\x1b[31mred\x1b[0m\tb\r\x07c\x1b]8;;http://x\x07link"), "ared    bclink");
  assert.equal(oneLine("  a\n\tb  c \x1b[1m"), "a b c");
});

test("tabs expand to 8-column stops", () => {
  assert.equal(expandTabs("a\tb\nabcdefgh\tc"), "a       b\nabcdefgh        c");
});

test("padStart right-aligns by display width; tildify shortens paths under HOME", () => {
  assert.equal(padStart("ab", 4, plain), "  ab");
  assert.equal(padStart("abcde", 4, plain), "abcde");
  const home = process.env.HOME;
  if (home) {
    assert.equal(tildify(home), "~");
    assert.equal(tildify(`${home}/x`), "~/x");
    assert.equal(tildify(`${home}x`), `${home}x`);
  }
  assert.equal(tildify("/elsewhere"), "/elsewhere");
});

test("box draws a title, pads the body, and puts bottom text in the border when it fits", () => {
  assert.deepEqual(box("T", ["hi"], 12, 4, false, plain), [
    "┌─ T ──────┐",
    "│hi        │",
    "│          │",
    "└──────────┘",
  ]);
  assert.equal(box("T", [], 12, 3, true, plain, "1/9").at(-1), "└──── 1/9 ─┘");
  // Too long for the border: dropped rather than cut.
  assert.equal(box("T", [], 12, 3, true, plain, "far too long").at(-1), "└──────────┘");
});
