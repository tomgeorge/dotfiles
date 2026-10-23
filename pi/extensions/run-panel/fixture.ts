import type { Style, Tone } from "./format.ts";
import { duration, money, oneLine } from "./format.ts";
import type { Content, Entry, Item, Source } from "./source.ts";

// A small crew-shaped source for the presenter's tests: jobs with a header, six columns, five
// views (fields, wrapped text, a collapsible list, a diff, a following transcript), and three
// actions (one confirmed, one synchronous, one asynchronous). No index.ts imports it.

/**
 * Plain text: one column per code point. With `tones`, coloured text is wrapped in
 * <tone>…</tone> so tests can check colours; without, assertions read like the screen.
 */
export function testStyle(tones: boolean): Style {
  const style: Style = {
    fg: (tone: Tone, text) => (tones ? `<${tone}>${text}</${tone}>` : text),
    bold: (text) => text,
    selected: (text) => text,
    width: (text) => [...text.replace(/<\/?[a-zA-Z]+>/g, "")].length,
    truncate(text, width, pad) {
      // Tags take no columns, like ANSI codes on a terminal.
      const parts = text.match(/<\/?[a-zA-Z]+>|[^<]+|</g) ?? [];
      const full = style.width(text);
      const room = full > width ? Math.max(0, width - 1) : width;
      let out = "";
      let used = 0;
      for (const part of parts) {
        if (/^<\/?[a-zA-Z]+>$/.test(part)) { out += part; continue; }
        const chars = [...part].slice(0, room - used);
        out += chars.join("");
        used += chars.length;
      }
      if (full > width && width > 0) out += "…";
      return pad ? out + " ".repeat(Math.max(0, width - style.width(out))) : out;
    },
    wrap(text, width) {
      return text.split("\n").flatMap((line) => {
        const out: string[] = [];
        for (let i = 0; i < Math.max(1, line.length); i += width) out.push(line.slice(i, i + width));
        return out;
      });
    },
  };
  return style;
}

export interface Job {
  id: number;
  kind: "impl" | "rev";
  title: string;
  status: "running" | "done" | "failed";
  branch: string;
  spec: string;
  cost: number;
  ms: number;
  activity: string;
  checks: { command: string; exit?: number; tail: string }[];
  entries: Entry[];
  dropped?: number;
  /** Undefined while loading. */
  diff?: string[];
}

export function job(id: number, over: Partial<Job> = {}): Job {
  return {
    id, kind: "impl", title: `task ${id}`, status: "running", branch: `crew/demo-t${id}`, spec: `spec ${id}`,
    cost: 0.25, ms: 90_000, activity: `read file${id}.ts`, checks: [], entries: [], ...over,
  };
}

const TONE: Record<Job["status"], Tone> = { running: "accent", done: "success", failed: "error" };

export interface FixtureOptions {
  /** Jobs can be cancelled. */
  live?: boolean;
  budget?: number;
  /** Actions append here. */
  log?: string[];
  /** Resolves or rejects the export action. */
  exporter?: (job: Job) => Promise<string>;
  busy?: boolean;
  disposed?: () => void;
  subscribe?: Source<Job>["subscribe"];
}

export function fixtureSource(jobs: Job[], opts: FixtureOptions = {}): Source<Job> {
  const log = opts.log ?? [];
  const spent = () => jobs.reduce((sum, j) => sum + j.cost, 0);
  const budget = opts.budget ?? 10;
  const item = (j: Job): Item<Job> => ({
    id: String(j.id),
    value: j,
    text: [`#${j.id}`, j.status, j.kind, j.title, j.branch],
    cells: {
      id: { text: `#${j.id}`, tone: "accent" },
      kind: { text: j.kind, tone: "muted" },
      title: oneLine(j.title),
      time: { text: duration(j.ms), tone: "dim" },
      cost: { text: money(j.cost), tone: "dim" },
      activity: j.status === "running" ? oneLine(j.activity) : { text: j.status, tone: "dim" },
    },
    glyph: j.status === "running" ? undefined : { text: j.status === "done" ? "✓" : "✗", tone: TONE[j.status] },
    running: j.status === "running",
    title: [{ text: `#${j.id}`, tone: "accent" }, { text: ` ${j.kind} `, tone: "muted" }, { text: oneLine(j.title) }],
  });

  const overview = (j: Job, s: Style): Content => ({
    kind: "sections",
    parts: [
      { content: { kind: "fields", rows: [["status", s.fg(TONE[j.status], j.status)], ["branch", j.branch], ["cost", money(j.cost)]] } },
      { content: { kind: "lines", lines: [s.fg("muted", "checks")] } },
      { content: { kind: "bullets", items: j.checks.map((c) => c.command), empty: "none declared" } },
    ],
  });

  const checks = (j: Job, s: Style): Content => {
    if (!j.checks.length) return { kind: "message", text: "No checks declared." };
    return {
      kind: "collapsible",
      items: j.checks.map((c) => ({
        head: `${c.exit === undefined ? s.fg("dim", "PENDING") : c.exit === 0 ? s.fg("success", "PASS   ") : s.fg("error", `FAIL ${c.exit}`.padEnd(7))} ${c.command}`,
        body: c.exit === undefined ? undefined : c.tail.split("\n"),
        open: c.exit !== undefined && c.exit !== 0,
      })),
    };
  };

  return {
    name: "Tasks",
    empty: "No tasks yet",
    items: () => jobs.map(item),
    columns: [
      { id: "id" },
      { id: "kind", width: 4, drop: 3 },
      { id: "title", fill: 11 },
      { id: "time", width: 5, align: "right" },
      { id: "cost", width: 5, align: "right", drop: 2 },
      { id: "activity", fill: 9, drop: 1 },
    ],
    views: [
      { id: "overview", label: "Overview", render: (j, ctx) => overview(j, ctx.style) },
      { id: "spec", label: "Spec", render: (j) => ({ kind: "lines", lines: j.spec.split("\n"), wrap: true }) },
      { id: "checks", label: "Checks", render: (j, ctx) => checks(j, ctx.style) },
      {
        id: "diff", label: "Diff",
        render: (j, ctx) => (j.diff ? { kind: "lines", lines: [ctx.style.fg("dim", `git diff ${j.branch}`), ...j.diff], paint: "diff" } : { kind: "loading", text: "Loading diff…" }),
      },
      {
        id: "live", label: "Live", tail: true,
        render: (j) => ({ kind: "transcript", note: "streaming from the worker", dropped: j.dropped ?? 0, entries: j.entries }),
      },
    ],
    actions: [
      {
        id: "cancel", label: "cancel", key: "x", description: "cancel the selected running task",
        available: (j) => (j.status !== "running" ? `#${j.id} is not running` : opts.live === false ? "Nothing to cancel in this session" : true),
        confirm: (j) => `Cancel #${j.id} "${j.title}"?`,
        run: (j) => { log.push(`cancel ${j.id}`); return { flash: `Cancelling #${j.id}`, tone: "warning" }; },
      },
      { id: "open", label: "copy path", key: "o", run: (j) => { log.push(`open ${j.id}`); return { flash: `/wt/${j.branch}` }; } },
      {
        id: "export", label: "export", key: "e",
        async run(j, ctx) {
          ctx.flash(`Exporting #${j.id}…`);
          const out = await (opts.exporter ?? (async () => `/out/${j.id}.html`))(j);
          return { flash: `Exported #${j.id} to ${out}`, tone: "success" };
        },
      },
    ],
    header: () => [
      [{ text: "Crew", bold: true }, { text: " " }, { text: "demo-ab12", tone: "accent" }, { text: " active", tone: "success" }],
      [{ text: `${money(spent())}/${money(budget)} ` }, { bar: budget > 0 ? spent() / budget : 1, cells: 10 }],
    ],
    busy: opts.busy === undefined ? undefined : () => opts.busy!,
    subscribe: opts.subscribe,
    dispose: opts.disposed,
  };
}
