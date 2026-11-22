import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommandArgs, pickModel, taskPreview } from "./picker.ts";

const available = [{ provider: "b", id: "strong" }, { provider: "a", id: "fast" }, { provider: "z", id: "extra" }];

test("picks from every available model, sorted, with the task in the title", async () => {
  const selects: { title: string; options: string[] }[] = [];
  const ui = { select: async (title: string, options: string[]) => { selects.push({ title, options }); return options[2]; } };
  assert.deepEqual(await pickModel("find the race", ui, available), { provider: "z", model: "extra" });
  assert.deepEqual(selects, [{ title: "Subagent model\nTask: find the race", options: ["a/fast", "b/strong", "z/extra"] }]);
});

test("cancelling returns no pick", async () => {
  assert.equal(await pickModel("t", { select: async () => undefined }, available), undefined);
});

test("no available models is an error", async () => {
  await assert.rejects(pickModel("t", { select: async () => undefined }, []), /No available models/);
});

test("task preview is one line and bounded", () => {
  assert.equal(taskPreview("  look at\n\n  this\tdiff "), "look at this diff");
  const long = taskPreview("x".repeat(500));
  assert.equal(long.length, 240);
  assert.ok(long.endsWith("…"));
});

test("command arguments: an exact model and task, a typo'd model, or a task to pick for", () => {
  const available = [{ provider: "anthropic", id: "claude-x" }, { provider: "openrouter", id: "org/model" }];
  assert.deepEqual(parseCommandArgs("  openrouter/org/model  review\nthis ", available), {
    type: "model", picked: { provider: "openrouter", model: "org/model" }, task: "review\nthis",
  });
  assert.throws(() => parseCommandArgs("anthropic/claude-x  ", available), /^Error: Usage: \/subagent/);
  assert.throws(() => parseCommandArgs("anthropic/claude-typo review", available), /Unavailable model: anthropic\/claude-typo\./);
  assert.deepEqual(parseCommandArgs(" review a/b ", available), { type: "pick", task: "review a/b" });
  assert.deepEqual(parseCommandArgs("other/thing review", available), { type: "pick", task: "other/thing review" });
  assert.deepEqual(parseCommandArgs("  ", available), { type: "pick", task: "" });
});
