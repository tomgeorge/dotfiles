import type { Style, Tone } from "./format.ts";

// What a panel shows, described as data. A source lists items and declares how to show them
// (columns, views) and what can be done to them (actions); the presenter in render.ts and
// input.ts does layout, keys, filtering, scrolling, and help. Borrowed from telescope.nvim
// (entry makers, entry_display columns, previewers, named actions) and mini.pick (one source
// table with defaults, help generated from the mappings, a busy state).

export interface Source<T = unknown> {
  /** List pane title, e.g. "Tasks", "Subagents", "Watches". */
  name: string;
  /** Display order. Called on every render, so keep it cheap. */
  items(): Item<T>[];
  columns: Column[];
  /** Tabs of the details pane. At least one. */
  views: View<T>[];
  /** Help and footer hints are generated from these. */
  actions: Action<T>[];
  /** Lines above the panes, e.g. crew's goal, branch, and budget bar. */
  header?(): Segment[][];
  /** Shown beside the list title; default `matched/total`, or `total` with no filter. */
  status?(matched: number, total: number): string;
  /** Shows a spinner beside the list title. */
  busy?(): boolean;
  /** Shown in an empty list; default "Nothing yet". */
  empty?: string;
  /** Re-render when data changes; without it the panel re-renders on its tick only. */
  subscribe?(onChange: () => void): () => void;
  /** The panel closed: stop timers, drop caches. */
  dispose?(): void;
}

export interface Item<T = unknown> {
  /** Unique within the source. */
  id: string;
  /** The record itself, handed back to views and actions. */
  value: T;
  /**
   * What the filter matches. With several fields, a filter token must match within one field,
   * so letters scattered across fields don't count as a match.
   */
  text: string | string[];
  /** One per column id; a missing cell is blank. */
  cells: Record<string, Cell>;
  /** Status mark, e.g. ✓ or ◷. Unset: an animated spinner. */
  glyph?: Cell;
  /** Running items are picked first when the panel opens. */
  running: boolean;
  /** Details pane title. */
  title: string | Segment[];
  /** View shown when this item is selected, e.g. "result" once a job has finished. */
  defaultView?: string;
}

export interface Column {
  id: string;
  /** Fixed width; unset and not `fill`, the widest cell sets it. */
  width?: number;
  /** Takes a share of the leftover width: `true` is a weight of 1. */
  fill?: boolean | number;
  align?: "left" | "right";
  /** Columns with higher numbers disappear first as the list narrows; unset never drops. */
  drop?: number;
}

export type Cell = { text: string; tone?: Tone } | string;

export type Segment = { text: string; tone?: Tone; bold?: boolean } | { bar: number; cells: number };

export interface View<T = unknown> {
  id: string;
  label: string;
  /** Synchronous; return `{ kind: "loading" }` and call `ctx.changed()` once the data is ready. */
  render(value: T, ctx: ViewContext): Content;
  /** Opens at the end and follows new lines until the user scrolls up. */
  tail?: boolean;
}

export interface ViewContext {
  now: number;
  /** Re-render: an asynchronous load finished. */
  changed(): void;
  /** For colouring text inside content. */
  style: Style;
}

export interface Action<T = unknown> {
  id: string;
  /** Short, for the footer and the confirmation: "cancel", "copy path". */
  label: string;
  /** A single printable character, not one the presenter reserves. */
  key: string;
  /** Longer text for the help; default `label`. */
  description?: string;
  /** A string is the reason it's unavailable, shown as a flash. */
  available?(value: T): true | string;
  /** Ask with this text first; y runs the action. */
  confirm?(value: T): string;
  run(value: T, ctx: ActionContext): Result | Promise<Result>;
}

export interface ActionContext {
  /** Progress while an asynchronous action runs, e.g. "Exporting #1…". */
  flash(text: string, tone?: Tone): void;
}

export type Result = void | "close" | { flash: string; tone?: Tone };

export type Content =
  | { kind: "loading"; text?: string }
  | { kind: "message"; text: string; tone?: Tone }
  | { kind: "fields"; rows: [label: string, value: string][] }
  | { kind: "markdown"; text: string }
  /** `wrap` wraps long lines; otherwise they're cut at the pane's edge. */
  | { kind: "lines"; lines: string[]; paint?: "diff"; wrap?: boolean }
  | { kind: "bullets"; items: string[]; tone?: Tone; empty?: string }
  /** `body` unset: the item can't be opened. */
  | { kind: "collapsible"; items: { head: string; body?: string[]; open: boolean }[]; note?: string }
  | { kind: "transcript"; note: string; dropped: number; entries: Entry[] }
  | { kind: "sections"; parts: { title?: string; tone?: Tone; content: Content }[] };

export type ToolState = "pending" | "running" | "ok" | "error";

export interface TextEntry { kind: "user" | "thinking" | "text" | "note"; text: string }
export interface ToolEntry { kind: "tool"; id: string; name: string; args: string; result: string; state: ToolState }
/** One transcript entry: a prompt, thinking, text, a note, or a tool call. */
export type Entry = TextEntry | ToolEntry;

/** Keys the presenter handles itself; a source action can't use them. */
export const RESERVED_KEYS = new Set(["j", "k", "g", "G", "l", "h", "q", "?", "/", " ", ..."0123456789"]);

/** Throws when a source declares a reserved, repeated, or unprintable action key, or no views. */
export function checkSource(source: Source<any>): void {
  if (!source.views.length) throw new Error(`${source.name}: a source needs at least one view`);
  const seen = new Set<string>();
  for (const action of source.actions) {
    if ([...action.key].length !== 1 || action.key < " " || action.key === "\x7f") {
      throw new Error(`${source.name}: action ${action.id} needs a single printable key, not ${JSON.stringify(action.key)}`);
    }
    if (RESERVED_KEYS.has(action.key)) throw new Error(`${source.name}: action ${action.id} uses reserved key ${JSON.stringify(action.key)}`);
    if (seen.has(action.key)) throw new Error(`${source.name}: key ${JSON.stringify(action.key)} is used twice`);
    seen.add(action.key);
  }
}
