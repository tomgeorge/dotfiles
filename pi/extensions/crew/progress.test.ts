import assert from "node:assert/strict";
import test from "node:test";
// Installs stand-ins for Pi's packages; progress.ts imports pi-tui, so it's loaded after.
import "../test-support/fake-pi.ts";

const { withProgress } = await import("./progress.ts");

type Factory = (tui: { requestRender(): void }, theme: { fg(tone: string, text: string): string }) => { render(width: number): string[] };

function fakeCtx(hasUI = true) {
  const widgets: (Factory | undefined)[] = [];
  let renders = 0;
  const ctx = { hasUI, ui: { setWidget: (_key: string, content: Factory | undefined) => { widgets.push(content); } } };
  const draw = () => widgets.at(-1)!({ requestRender: () => { renders++; } }, { fg: (_tone, text) => text }).render(80)[0];
  return { ctx: ctx as any, widgets, draw, renders: () => renders };
}

test("shows the text with a spinner while the work runs, follows its steps, and clears after", async () => {
  const f = fakeCtx();
  let release!: () => void;
  const running = withProgress(f.ctx, "Crew: checking", async (step) => {
    assert.match(f.draw(), /^⠋ Crew: checking$/);
    step("Crew: step 2");
    await new Promise<void>((r) => { release = r; });
    return 42;
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(f.draw(), /Crew: step 2$/);
  release();
  assert.equal(await running, 42);
  assert.equal(f.widgets.at(-1), undefined, "cleared when done");
});

test("clears after a failure and passes the error on", async () => {
  const f = fakeCtx();
  await assert.rejects(withProgress(f.ctx, "x", async () => { throw new Error("git broke"); }), /git broke/);
  assert.equal(f.widgets.length, 2);
  assert.equal(f.widgets.at(-1), undefined);
});

test("without a UI it just runs the work", async () => {
  const f = fakeCtx(false);
  assert.equal(await withProgress(f.ctx, "x", async (step) => { step("y"); return "ok"; }), "ok");
  assert.equal(f.widgets.length, 0);
});
