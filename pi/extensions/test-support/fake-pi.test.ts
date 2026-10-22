import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fakePi } from "./fake-pi.ts";
// After fake-pi registers its module stubs.
const { truncateHead } = await import("@earendil-works/pi-coding-agent");

// A tiny extension: one tool, and a tool_call gate that blocks a named tool.
function gate(pi: ReturnType<typeof fakePi>["pi"]) {
  pi.registerTool({
    name: "echo", label: "Echo", description: "echo", parameters: {} as never,
    execute: async (_id, params) => ({ content: [{ type: "text", text: truncateHead(JSON.stringify(params)).content }], details: undefined }),
  });
  pi.on("tool_call", (event) => {
    const known = pi.getAllTools().some((t) => t.name === event.toolName);
    return known ? undefined : { block: true, reason: `unknown tool ${event.toolName}` };
  });
  pi.on("tool_call", () => undefined);
}

test("emit returns each handler's result, so a blocking tool_call is visible", async () => {
  const f = fakePi();
  gate(f.pi);
  const ctx = f.ctx("/tmp");
  assert.deepEqual(await f.emit("tool_call", { toolName: "echo" }, ctx), [undefined, undefined]);
  assert.deepEqual(await f.emit("tool_call", { toolName: "rm" }, ctx), [{ block: true, reason: "unknown tool rm" }, undefined]);
  assert.deepEqual(await f.emit("no_such_event", {}, ctx), []);
});

test("getAllTools lists registered tools, and tool() runs one", async () => {
  const f = fakePi();
  gate(f.pi);
  assert.deepEqual(f.pi.getAllTools().map((t) => t.name), ["echo"]);
  assert.deepEqual(await f.tool("echo", { a: 1 }), { content: [{ type: "text", text: '{"a":1}' }], details: undefined });
  assert.throws(() => f.tool("nope", {}), /no tool "nope"/);
  assert.throws(() => f.command("nope", "", {}), /no command "nope"/);
});

test("flags: registerFlag supplies defaults, tests override", () => {
  const f = fakePi();
  f.pi.registerFlag("a", { type: "string", default: "x" });
  f.pi.registerFlag("b", { type: "boolean" });
  assert.equal(f.pi.getFlag("a"), "x");
  assert.equal(f.pi.getFlag("b"), undefined);
  f.flags.set("b", true);
  assert.equal(f.pi.getFlag("b"), true);
});

test("truncateHead stand-in keeps whole leading lines within the limits", () => {
  assert.deepEqual(truncateHead("a\nb\nc", { maxLines: 2 }).content, "a\nb");
  assert.equal(truncateHead("a\nb\nc", { maxLines: 2 }).truncatedBy, "lines");
  assert.equal(truncateHead("aa\nbb", { maxBytes: 4 }).truncatedBy, "bytes");
  assert.equal(truncateHead("short").truncated, false);
});

// Every extension's index.ts must load against the stubs, or its wiring can't be tested.
test("every extension's index.ts loads with fake-pi's stubs", async () => {
  const extensions = dirname(dirname(fileURLToPath(import.meta.url)));
  const names = readdirSync(extensions, { withFileTypes: true })
    .filter((d) => d.isDirectory() && readdirSync(join(extensions, d.name)).includes("index.ts"))
    .map((d) => d.name);
  assert.ok(names.length > 0);
  for (const name of names) {
    const mod = await import(pathToFileURL(join(extensions, name, "index.ts")).href);
    assert.equal(typeof mod.default, "function", name);
  }
});
