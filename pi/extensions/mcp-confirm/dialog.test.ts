import assert from "node:assert/strict";
import { test } from "node:test";
// Installs stand-ins for Pi's packages; dialog.ts imports pi-tui, so it's loaded after.
import "../test-support/fake-pi.ts";

const { confirmComponent } = await import("./dialog.ts");

const paint = { accent: (s: string) => s, dim: (s: string) => s };
const keys = { matches: (data: string, id: string) => (id === "tui.select.confirm" ? data === "\r" : data === "\x1b") };

function open() {
  const answers: boolean[] = [];
  const c = confirmComponent({ title: "Allow slack › send?", summary: "Send a message.", rows: [["channel", "C1"]] }, paint, keys, (ok) => answers.push(ok));
  return { c, answers };
}

test("renders the heading, the table, and the key hint within the width", () => {
  const lines = open().c.render(30);
  assert.deepEqual(lines, [
    "─".repeat(30),
    " Allow slack › send?",
    " Send a message.",
    "",
    " ┌─────────┬────┐",
    " │ channel │ C1 │",
    " └─────────┴────┘",
    "",
    " y/enter allow · n/esc deny",
    "─".repeat(30),
  ]);
});

test("y and Enter allow; n and Esc deny; other keys do nothing", () => {
  for (const [key, want] of [["y", true], ["\r", true], ["n", false], ["\x1b", false]] as const) {
    const { c, answers } = open();
    c.handleInput("x");
    c.handleInput(key);
    assert.deepEqual(answers, [want], key);
  }
});
