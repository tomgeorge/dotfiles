import assert from "node:assert/strict";
import { test } from "node:test";
import mcpConfirm from "./index.ts";

type Tool = { name: string; annotations?: { readOnlyHint?: unknown } };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

// Pins the gate end to end: which calls pass, which ask, and what they say.
function gate(tools: Tool[], answer = false) {
  let handler: Handler | undefined;
  const pi = { on: (_event: string, h: Handler) => { handler = h; }, getAllTools: () => tools };
  mcpConfirm(pi as never);
  const prompts: [string, string][] = [];
  const ui = { confirm: async (title: string, body: string) => (prompts.push([title, body]), answer) };
  const call = (toolName: string, input: Record<string, unknown> = {}, hasUI = true) =>
    handler!({ type: "tool_call", toolCallId: "c1", toolName, input }, { hasUI, ui });
  return { call, prompts };
}

test("non-MCP tools and read-only MCP tools pass without asking", async () => {
  const g = gate([{ name: "mcp__slack__search", annotations: { readOnlyHint: true } }]);
  assert.equal(await g.call("bash"), undefined);
  assert.equal(await g.call("mcp__slack__search"), undefined);
  assert.equal(await g.call("mcp__fantastical__get_events"), undefined, "allowlisted prefix");
  assert.equal(await g.call("mcp__fantastical__search_events"), undefined, "allowlisted name");
  assert.deepEqual(g.prompts, []);
});

test("only readOnlyHint === true counts; missing, false, or truthy non-true hints ask", async () => {
  const g = gate([
    { name: "mcp__a__x", annotations: { readOnlyHint: false } },
    { name: "mcp__a__y", annotations: { readOnlyHint: "true" } },
    { name: "mcp__a__z", annotations: {} },
    { name: "mcp__a__w" },
  ]);
  for (const name of ["mcp__a__x", "mcp__a__y", "mcp__a__z", "mcp__a__w", "mcp__a__unknown", "mcp__fantastical__create_event"]) {
    assert.deepEqual(await g.call(name), { block: true, reason: `User declined ${name}` });
  }
  assert.equal(g.prompts.length, 6);
});

test("the prompt shows the arguments; a yes lets the call run", async () => {
  const g = gate([], true);
  assert.equal(await g.call("mcp__slack__send", { channel: "C1", text: "hi" }), undefined);
  assert.deepEqual(g.prompts, [["Allow mcp__slack__send?", '{\n  "channel": "C1",\n  "text": "hi"\n}']]);
});

test("without a UI, calls that need confirmation are blocked", async () => {
  const g = gate([], true);
  assert.deepEqual(await g.call("mcp__slack__send", {}, false), {
    block: true,
    reason: "mcp__slack__send may modify data and needs confirmation, but no UI is available",
  });
  assert.equal(await g.call("mcp__fantastical__get_events", {}, false), undefined);
  assert.deepEqual(g.prompts, []);
});
