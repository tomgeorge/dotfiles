import assert from "node:assert/strict";
import { test } from "node:test";
// Installs stand-ins for Pi's packages; pi.ts imports pi-tui, so it's loaded after.
import "../test-support/fake-pi.ts";
import { fixtureSource, job, type FixtureOptions, type Job } from "./fixture.ts";
import type { Source } from "./source.ts";

const { openPanel, panelEvent } = await import("./pi.ts");

/**
 * A ctx whose ui.custom captures the component, with a plain-text theme and a fixed terminal.
 * Like Pi's showExtensionCustom, it installs the component in a later microtask and disposes
 * only an installed one. `deferFactory` also calls the factory in a later microtask.
 */
function fakeCtx(hasUI = true, { deferFactory = false } = {}) {
  const opened: { component: any; installed: boolean; closed: boolean; renders: number; options: any; close: () => void }[] = [];
  const notes: string[] = [];
  const ctx: any = {
    hasUI,
    ui: {
      notify: (message: string, type = "info") => { notes.push(`${type}: ${message}`); },
      custom: (factory: any, options: any) => new Promise<void>((resolve, reject) => {
        const panel = { component: undefined as any, installed: false, closed: false, renders: 0, options, close: () => {} };
        const tui = { terminal: { rows: 40 }, requestRender: () => { panel.renders++; } };
        const theme = { fg: (_tone: string, text: string) => text, bold: (text: string) => text, bg: (_tone: string, text: string) => text };
        const done = () => {
          if (panel.closed) return;
          panel.closed = true;
          resolve();
          if (panel.installed) panel.component.dispose?.();
        };
        panel.close = done;
        opened.push(panel);
        const build = () => {
          panel.component = factory(tui, theme, {}, done);
          return panel.component;
        };
        (deferFactory ? Promise.resolve().then(build) : Promise.resolve(build()))
          .then(() => {
            if (!panel.closed) panel.installed = true;
          })
          .catch((error) => {
            if (!panel.closed) reject(error);
          });
      }),
    },
  };
  const last = () => opened.at(-1)!;
  const screen = () => last().component.render(120).join("\n") as string;
  const type = (...keys: string[]) => { for (const k of keys) last().component.handleInput(k); };
  return { ctx, opened, notes, screen, type, last };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Counts intervals started and not cleared while `fn` runs. */
async function liveTimers(fn: () => Promise<void>): Promise<number> {
  const live = new Set<unknown>();
  const { setInterval: set, clearInterval: clear } = globalThis;
  globalThis.setInterval = ((...args: Parameters<typeof set>) => {
    const id = set(...args);
    live.add(id);
    return id;
  }) as typeof set;
  globalThis.clearInterval = ((id: Parameters<typeof clear>[0]) => {
    live.delete(id);
    clear(id);
  }) as typeof clear;
  try {
    await fn();
  } finally {
    globalThis.setInterval = set;
    globalThis.clearInterval = clear;
    for (const id of live) clear(id as any);
  }
  return live.size;
}

let opens = 0;

function open(jobs: Job[], opts: FixtureOptions = {}, closeKey?: string) {
  const f = fakeCtx();
  const log: string[] = [];
  const handle = openPanel(f.ctx, fixtureSource(jobs, { log, ...opts }), { id: `fixture ${++opens}`, closeKey: closeKey as any, tickMs: 10_000 });
  return { ...f, log, handle: handle! };
}

test("raw key data maps to panel keys and characters; the opening shortcut closes", () => {
  assert.deepEqual(panelEvent("up"), { key: "up" });
  assert.deepEqual(panelEvent("ctrl+d"), { key: "pageDown" });
  assert.deepEqual(panelEvent("ctrl+o"), { key: "zoom" });
  assert.deepEqual(panelEvent("ctrl+c"), { key: "close" });
  assert.deepEqual(panelEvent("x"), { char: "x" });
  assert.deepEqual(panelEvent(" "), { char: " " });
  assert.equal(panelEvent("\x7f"), undefined);
  assert.equal(panelEvent("ctrl+shift+c"), undefined);
  assert.deepEqual(panelEvent("ctrl+shift+c", ["ctrl+shift+c"]), { key: "close" });
});

test("the panel opens as an overlay, once at a time, and closes on q", async () => {
  const f = fakeCtx();
  const handle = openPanel(f.ctx, fixtureSource([job(1)]), { closeKey: "ctrl+shift+c" })!;
  try {
    assert.equal(f.opened.length, 1);
    assert.equal(f.opened[0].options.overlay, true);
    assert.equal(f.opened[0].options.overlayOptions.anchor, "center");
    const text = f.last().component.render(200).join("\n");
    assert.match(text, /Crew demo-ab12 active/);
    assert.match(text, /#1 impl task 1/);
    assert.match(text, /ctrl\+shift\+c close/);
    // Height follows the terminal: 85% of 40 rows.
    assert.equal(f.last().component.render(120).length, 34);
    assert.equal(openPanel(f.ctx, fixtureSource([job(1)])), undefined, "already open");
    assert.equal(f.opened.length, 1);
    f.type("ctrl+shift+c");
    assert.ok(f.opened[0].closed);
  } finally {
    handle.close();
    await handle.closed;
  }
  const again = openPanel(f.ctx, fixtureSource([job(1)]));
  assert.ok(again, "opens again once closed");
  f.type("q");
  assert.ok(f.opened[1].closed);
  await again!.closed;
});

test("without a UI nothing opens; a reserved key throws before anything opens", () => {
  const f = fakeCtx(false);
  assert.equal(openPanel(f.ctx, fixtureSource([job(1)])), undefined);
  const g = fakeCtx();
  const bad: Source<Job> = { ...fixtureSource([job(1)]), name: "Bad", actions: [{ id: "j", label: "j", key: "j", run: () => {} }] };
  assert.throws(() => openPanel(g.ctx, bad), /reserved key/);
  assert.equal(g.opened.length, 0);
  const handle = openPanel(g.ctx, { ...bad, actions: [] });
  assert.ok(handle, "a failed open doesn't hold the guard");
  handle!.close();
  return handle!.closed;
});

test("a confirmed action runs on y and its result shows at once", async () => {
  const p = open([job(1)]);
  try {
    p.type("x");
    assert.match(p.screen(), /Cancel #1 "task 1"\? y to cancel/);
    p.type("n");
    assert.deepEqual(p.log, []);
    p.type("x", "y");
    assert.deepEqual(p.log, ["cancel 1"]);
    assert.match(p.screen(), /Cancelling #1/);
    p.type("o");
    assert.match(p.screen(), /\/wt\/crew\/demo-t1/);
  } finally {
    p.handle.close();
    await p.handle.closed;
  }
});

test("an asynchronous action shows progress, then its result, or notifies when a key came first", async () => {
  let release!: (out: string) => void;
  let reject!: (error: Error) => void;
  const p = open([job(1)], { exporter: () => new Promise((res, rej) => { release = res; reject = rej; }) });
  try {
    p.type("e");
    assert.match(p.screen(), /Exporting #1…/);
    release("/tmp/one.html");
    await tick();
    assert.match(p.screen(), /Exported #1 to \/tmp\/one\.html/);

    p.type("e");
    reject(new Error("pi exploded"));
    await tick();
    assert.match(p.screen(), /export failed: pi exploded/);

    // A key press after the action started: the result goes to a notification instead.
    p.type("e", "j");
    release("/tmp/two.html");
    await tick();
    assert.doesNotMatch(p.screen(), /Exported/);
    assert.deepEqual(p.notes, ["info: Exported #1 to /tmp/two.html"]);
  } finally {
    p.handle.close();
    await p.handle.closed;
  }
});

test("an action that throws, or returns close, is handled", () => {
  const f = fakeCtx();
  const base = fixtureSource([job(1)]);
  const source: Source<Job> = {
    ...base,
    actions: [
      { id: "boom", label: "boom", key: "b", run: () => { throw new Error("bang"); } },
      { id: "done", label: "done", key: "d", run: () => "close" },
    ],
  };
  const handle = openPanel(f.ctx, source)!;
  f.type("b");
  assert.match(f.screen(), /boom failed: bang/);
  f.type("d");
  assert.ok(f.opened[0].closed);
  return handle.closed;
});

test("subscribe re-renders on change; closing unsubscribes, stops the tick, and disposes the source", async () => {
  let listener: (() => void) | undefined;
  let disposed = 0;
  const p = open([job(1)], {
    subscribe: (fn) => { listener = fn; return () => { listener = undefined; }; },
    disposed: () => { disposed++; },
  });
  const before = p.opened[0].renders;
  listener!();
  assert.equal(p.opened[0].renders, before + 1);
  p.handle.close();
  await p.handle.closed;
  assert.equal(listener, undefined);
  assert.equal(disposed, 1);
});

test("the tick animates spinners and re-renders", async () => {
  const f = fakeCtx();
  const handle = openPanel(f.ctx, fixtureSource([job(1)]), { tickMs: 5 })!;
  try {
    const first = f.screen();
    // Polled, not a fixed sleep: timers run late when the whole suite runs in parallel.
    const deadline = Date.now() + 2_000;
    while (f.opened[0].renders < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    assert.ok(f.opened[0].renders >= 2);
    assert.notEqual(f.screen(), first, "the spinner moved");
  } finally {
    handle.close();
  }
  await handle.closed;
});

test("closing before Pi installs the component still stops the tick, unsubscribes, and disposes once", async () => {
  for (const deferFactory of [false, true]) {
    let subscribed = 0;
    let disposed = 0;
    const leaked = await liveTimers(async () => {
      const f = fakeCtx(true, { deferFactory });
      const source = fixtureSource([job(1)], {
        subscribe: () => { subscribed++; return () => { subscribed--; }; },
        disposed: () => { disposed++; },
      });
      const handle = openPanel(f.ctx, source, { id: `early close ${deferFactory}` })!;
      try {
        // Before the factory runs (deferred) or before Pi installs what it returned.
        handle.close();
      } finally {
        await handle.closed;
      }
      assert.equal(f.opened[0].installed, false, "closed before it was installed");
      assert.ok(f.opened[0].closed);
    });
    assert.equal(leaked, 0, `no ticker left running (deferFactory ${deferFactory})`);
    assert.equal(subscribed, 0, `unsubscribed (deferFactory ${deferFactory})`);
    assert.equal(disposed, 1, `disposed once (deferFactory ${deferFactory})`);
  }
});

test("an installed panel cleans up once, though Pi disposes it too", async () => {
  let disposed = 0;
  const leaked = await liveTimers(async () => {
    const p = open([job(1)], { disposed: () => { disposed++; } });
    try {
      await tick();
      assert.ok(p.last().installed);
      p.type("q");
    } finally {
      p.handle.close();
      await p.handle.closed;
    }
  });
  assert.equal(leaked, 0);
  assert.equal(disposed, 1);
});

test("a subscribe that throws stops the tick, notifies, and frees the guard", async () => {
  let disposed = 0;
  const f = fakeCtx();
  const leaked = await liveTimers(async () => {
    const source = fixtureSource([job(1)], {
      subscribe: () => { throw new Error("no feed"); },
      disposed: () => { disposed++; },
    });
    const handle = openPanel(f.ctx, source, { id: "throwing subscribe" })!;
    try {
      assert.ok(handle);
    } finally {
      handle.close();
      await handle.closed;
    }
  });
  assert.equal(leaked, 0);
  assert.equal(disposed, 1);
  assert.deepEqual(f.notes, ["error: Tasks panel: no feed"]);
  const again = openPanel(f.ctx, fixtureSource([job(1)]), { id: "throwing subscribe" });
  assert.ok(again, "the guard was released");
  again!.close();
  await again!.closed;
});
