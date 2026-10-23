import { box, clean, padStart, SPINNER, type Style, type Tone } from "./format.ts";
import { visible } from "./input.ts";
import type { Cell, Column, Content, Entry, Item, Segment, Source, View, ViewContext } from "./source.ts";
import type { PanelState } from "./state.ts";

// Drawing for every panel: a header, a list of items in declared columns, and a details pane
// with one tab per view. Pure: it returns lines and writes back only what later key presses
// need (scroll clamped to the content, the page height, the collapsible entries on screen).

/** Panes sit side by side from this panel width; below it they stack. */
const SIDE_BY_SIDE = 100;
/** The narrowest a fill column gets before columns start to drop. */
const MIN_FILL = 9;
const FIELD_LABEL_W = 13;
const TAIL_LINES = 40;
const PROMPT_LINES = 6;
const RESULT_LINES = 8;
const ERROR_LINES = 20;

export interface RenderOptions {
  /** Animation frame for spinners. */
  frame: number;
  /** Shown in the footer, e.g. the shortcut that closes the panel. */
  closeHint?: string;
  /** Handed to views as `ctx.changed`: an asynchronous load finished. */
  changed?: () => void;
}

export interface PanelRender {
  lines: string[];
  /** Detail body height, for paging. Also written to `state.page`. */
  page: number;
}

// ── Pieces ───────────────────────────────────────────────────────────────

const cellText = (cell: Cell | undefined) => (cell === undefined ? "" : typeof cell === "string" ? cell : cell.text);
const paintCell = (cell: Cell | undefined, text: string, s: Style) =>
  typeof cell === "object" && cell.tone ? s.fg(cell.tone, text) : text;

function bar(fraction: number, cells: number, s: Style): string {
  const filled = Math.max(0, Math.min(cells, Math.round(fraction * cells)));
  const tone: Tone = fraction >= 1 ? "error" : fraction >= 0.75 ? "warning" : "success";
  return s.fg(tone, "█".repeat(filled)) + s.fg("dim", "░".repeat(cells - filled));
}

export function segments(parts: string | Segment[], s: Style): string {
  if (typeof parts === "string") return parts;
  return parts.map((p) => {
    if ("bar" in p) return bar(p.bar, p.cells, s);
    const text = p.tone ? s.fg(p.tone, p.text) : p.text;
    return p.bold ? s.bold(text) : text;
  }).join("");
}

function headerLines(source: Source<any>, width: number, s: Style): string[] {
  // Padded, so the overlay covers what's beneath it.
  return (source.header?.() ?? []).map((line) => s.truncate(` ${segments(line, s)}`, width, true));
}

interface Layout { column: Column; width: number }

/**
 * Column widths for a list `width` columns wide, after the selection mark and glyph. Columns
 * drop, highest `drop` first, until every fixed column fits and each fill column has MIN_FILL.
 */
export function layoutColumns(columns: Column[], items: Item<any>[], width: number, s: Style): Layout[] {
  const natural = (c: Column) => c.width ?? Math.max(0, ...items.map((i) => s.width(cellText(i.cells[c.id]))));
  let active = [...columns];
  const need = (cols: Column[]) =>
    cols.reduce((sum, c) => sum + (c.fill ? MIN_FILL : natural(c)), 0) + Math.max(0, cols.length - 1);
  while (need(active) > width) {
    const droppable = active.filter((c) => c.drop !== undefined);
    if (!droppable.length) break;
    const worst = droppable.reduce((a, b) => (b.drop! > a.drop! ? b : a));
    active = active.filter((c) => c !== worst);
  }
  const fixed = active.reduce((sum, c) => sum + (c.fill ? 0 : natural(c)), 0) + Math.max(0, active.length - 1);
  const weight = (c: Column) => (c.fill === true ? 1 : typeof c.fill === "number" ? c.fill : 0);
  const fills = active.filter((c) => weight(c) > 0);
  const total = fills.reduce((sum, c) => sum + weight(c), 0);
  let left = Math.max(fills.length, width - fixed);
  const room = left;
  return active.map((column) => {
    if (!weight(column)) return { column, width: natural(column) };
    const last = column === fills.at(-1);
    const w = last ? left : Math.max(1, Math.floor((room * weight(column)) / total));
    left -= w;
    return { column, width: Math.max(1, w) };
  });
}

function itemRow(item: Item<any>, layout: Layout[], width: number, s: Style, selected: boolean, frame: number): string {
  const glyph = item.glyph === undefined ? s.fg("accent", SPINNER[frame % SPINNER.length]) : paintCell(item.glyph, cellText(item.glyph), s);
  const cells = layout.map(({ column, width: w }, i) => {
    const cell = item.cells[column.id];
    const text = s.truncate(cellText(cell), w, column.align !== "right" && i < layout.length - 1);
    return paintCell(cell, column.align === "right" ? padStart(text, w, s) : text, s);
  });
  const row = `${selected ? s.fg("accent", "▸") : " "}${glyph} ${cells.join(" ")}`;
  return selected ? s.selected(s.truncate(row, width, true)) : s.truncate(row, width);
}

function tabBar(views: View<any>[], active: string, width: number, s: Style): string {
  const line = (short: boolean) => views.map((view, i) => {
    const label = `${i + 1} ${view.label}`;
    return view.id === active ? s.bold(s.fg("accent", `[${label}]`)) : s.fg("dim", short ? `${i + 1}` : label);
  }).join(" ");
  // In a narrow pane, inactive tabs shrink to their number so the active one stays visible.
  const full = line(false);
  return s.truncate(s.width(full) <= width ? full : line(true), width);
}

// ── Content ──────────────────────────────────────────────────────────────

/** The scrollable content of one details tab. */
interface Body {
  lines: string[];
  /** Colours a line at render time, after scrolling has picked it. */
  paint?: (line: string) => string;
  /** Line the cursor is on, kept on screen when `followCursor` is set. */
  anchor?: number;
}

export function paintDiff(line: string, s: Style): string {
  if (line.startsWith("diff --git")) return s.bold(s.fg("accent", line));
  if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) return s.fg("muted", line);
  if (line.startsWith("@@")) return s.fg("accent", line);
  if (line.startsWith("+")) return s.fg("success", line);
  if (line.startsWith("-")) return s.fg("error", line);
  if (line.startsWith("[diff truncated")) return s.fg("warning", line);
  return line;
}

const wrapAll = (text: string, width: number, s: Style) => text.split("\n").flatMap((l) => s.wrap(l, Math.max(10, width)));

function fieldLines(rows: [string, string][], width: number, s: Style): string[] {
  const labelW = Math.max(FIELD_LABEL_W, ...rows.map(([label]) => label.length + 2));
  return rows.flatMap(([label, value]) =>
    s.wrap(value, Math.max(10, width - labelW)).map((line, i) => `${s.fg("muted", (i ? "" : label).padEnd(labelW))}${line}`));
}

function bullets(items: string[], width: number, s: Style, tone?: Tone): string[] {
  return items.flatMap((item) => s.wrap(clean(item), Math.max(10, width - 2)).map((line, i) => `${i ? "  " : s.fg("dim", "- ")}${tone ? s.fg(tone, line) : line}`));
}

function sectionRule(title: string, tone: Tone, width: number, s: Style): string {
  const head = `── ${title} `;
  return s.fg(tone, head + "─".repeat(Math.max(0, width - 1 - s.width(head))));
}

export function entryLines(entry: Entry, width: number, s: Style): string[] {
  const wrap = (text: string, w = width) => clean(text).split("\n").flatMap((l) => s.wrap(l, Math.max(10, w)));
  switch (entry.kind) {
    case "user": {
      const lines = wrap(entry.text);
      const shown = lines.slice(0, PROMPT_LINES).map((l) => s.fg("dim", l));
      const more = lines.length - PROMPT_LINES;
      return [s.fg("muted", "prompt"), ...shown, ...(more > 0 ? [s.fg("dim", `… ${more} more lines`)] : [])];
    }
    case "thinking":
      return wrap(entry.text.trim(), width - 2).map((l, i) => s.fg("dim", `${i ? "  " : "∴ "}${l}`));
    case "text":
      return wrap(entry.text.trim());
    case "note":
      return wrap(entry.text).map((l) => s.fg("warning", l));
    case "tool": {
      const mark = entry.state === "ok" ? s.fg("success", "✓") : entry.state === "error" ? s.fg("error", "✗")
        : entry.state === "running" ? s.fg("accent", "▸") : s.fg("dim", "·");
      const call = wrap(entry.args, width - 4 - entry.name.length);
      const lines = [`${mark} ${s.fg("accent", entry.name)} ${call[0] ?? ""}`, ...call.slice(1).map((l) => `  ${l}`)];
      const out = clean(entry.result).trimEnd();
      if (!out) return lines;
      const all = out.split("\n");
      const keep = entry.state === "error" ? ERROR_LINES : RESULT_LINES;
      if (all.length > keep) lines.push(s.fg("dim", `    … ${all.length - keep} earlier lines`));
      const tone: Tone = entry.state === "error" ? "error" : "dim";
      return [...lines, ...all.slice(-keep).map((l) => s.fg(tone, s.truncate(`    ${l}`, width)))];
    }
  }
}

/** Where a collapsible view is drawn, so its cursor and open entries can be tracked. */
interface Place { state: PanelState; key: string }

function collapsibleBody(content: Extract<Content, { kind: "collapsible" }>, place: Place, width: number, s: Style): Body {
  const { state, key } = place;
  state.collapsible = { key, open: content.items.map((i) => i.open) };
  if (!content.items.length) return { lines: content.note ? wrapAll(content.note, width, s) : [] };
  const lines: string[] = [];
  let anchor = 0;
  const focused = state.focus === "detail";
  content.items.forEach((entry, i) => {
    const open = entry.body !== undefined && (state.expanded[`${key}:${i}`] ?? entry.open);
    const cursor = focused && i === state.cursor;
    if (cursor) anchor = lines.length;
    const marker = entry.body === undefined ? " " : open ? "▾" : "▸";
    const head = `${cursor ? s.fg("accent", "›") : " "}${marker} `;
    const wrapped = s.wrap(entry.head, Math.max(10, width - s.width(head)));
    lines.push(...wrapped.map((l, j) => (j ? " ".repeat(s.width(head)) : head) + l));
    if (open) {
      const body = entry.body!.slice(-TAIL_LINES);
      lines.push(...(body.join("").trim() ? body.map((l) => s.fg("dim", s.truncate(`    ${l}`, width))) : [s.fg("dim", "    (no output)")]));
    }
  });
  if (content.note) lines.push("", ...wrapAll(content.note, width, s));
  lines.push("", s.fg("dim", focused ? "j/k pick an entry · enter opens or closes it" : "enter to pick an entry and open it"));
  return { lines, anchor };
}

function contentBody(content: Content, place: Place, width: number, s: Style): Body {
  switch (content.kind) {
    case "loading": return { lines: [s.fg("dim", content.text ?? "Loading…")] };
    case "message": return { lines: wrapAll(content.text, width, s).map((l) => s.fg(content.tone ?? "dim", l)) };
    case "fields": return { lines: fieldLines(content.rows, width, s) };
    case "markdown": return { lines: s.markdown ? s.markdown(content.text, width) : wrapAll(clean(content.text), width, s) };
    case "lines": {
      const lines = content.wrap ? content.lines.flatMap((l) => s.wrap(l, Math.max(10, width))) : content.lines;
      return { lines, paint: content.paint === "diff" ? (line) => paintDiff(line, s) : undefined };
    }
    case "bullets":
      return { lines: content.items.length ? bullets(content.items, width, s, content.tone) : content.empty ? [s.fg("dim", `  ${content.empty}`)] : [] };
    case "collapsible": return collapsibleBody(content, place, width, s);
    case "transcript": {
      const lines = [s.fg("dim", content.note)];
      if (content.dropped) lines.push(s.fg("dim", `… ${content.dropped} earlier entries not kept here`));
      if (!content.entries.length) lines.push("", s.fg("dim", "No output yet."));
      for (const entry of content.entries) lines.push("", ...entryLines(entry, width, s));
      return { lines };
    }
    case "sections": {
      const lines: string[] = [];
      let anchor: number | undefined;
      content.parts.forEach((part, i) => {
        if (part.title) {
          if (i > 0) lines.push("");
          lines.push(sectionRule(part.title, part.tone ?? "accent", width, s));
        }
        const body = contentBody(part.content, place, width, s);
        if (body.anchor !== undefined) anchor = lines.length + body.anchor;
        lines.push(...(body.paint ? body.lines.map(body.paint) : body.lines));
      });
      return { lines, anchor };
    }
  }
}

// ── Help and footer ──────────────────────────────────────────────────────

function helpRows(source: Source<any>): [string, string][] {
  const views = source.views;
  const tails = views.filter((v) => v.tail).map((v) => v.label);
  const rows: [string, string][] = [
    ["type, /", "filter the list"],
    ["j/k, ↑/↓", "move (scroll in details)"],
    ["enter, l", "focus details · in an expandable list, open an entry"],
    ["h, esc", "back to the list"],
  ];
  if (views.length > 1) rows.push([`tab, 1-${views.length}`, `switch tab: ${views.map((v) => v.label.toLowerCase()).join(", ")}`]);
  rows.push(
    ["ctrl+d/u", "page the details"],
    ["g/G", tails.length ? `top/bottom; on ${tails.join(", ")}, k pauses and G follows again` : "top/bottom"],
    ["ctrl+o", "zoom the details to the full panel"],
  );
  for (const a of source.actions) rows.push([a.key, `${a.description ?? a.label}${a.confirm ? " (asks first)" : ""}`]);
  rows.push(["esc", "clear the filter, then close"], ["q", "close"]);
  return rows;
}

export function helpLines(source: Source<any>, width: number, s: Style): string[] {
  const rows = helpRows(source);
  const keyW = Math.max(11, ...rows.map(([k]) => k.length + 2));
  return [
    s.bold("Keys"), "",
    ...rows.map(([keys, what]) => s.truncate(`${s.fg("accent", keys.padEnd(keyW))}${what}`, width)),
    "", s.fg("dim", "Any key closes this help."),
  ];
}

function footer(source: Source<any>, state: PanelState, width: number, s: Style, opts: RenderOptions): string {
  if (state.confirm) {
    const label = source.actions.find((a) => a.id === state.confirm!.action)?.label ?? "go ahead";
    return s.truncate(s.fg("warning", ` ${state.confirm.text} y to ${label}, any other key to leave it`), width, true);
  }
  if (state.flash) return s.truncate(` ${s.fg(state.flash.tone, state.flash.text)}`, width, true);
  const n = source.views.length;
  const tabs = n > 1 ? [`tab/1-${n} tabs`] : [];
  const actions = source.actions.map((a) => `${a.key} ${a.label}`);
  const hints = state.filtering ? ["type to filter", "↑/↓ move", "enter keep filter", "esc clear"]
    : state.focus === "detail" ? ["j/k scroll", ...tabs, "ctrl+d/u page", "ctrl+o zoom", ...actions, "h back", "? help"]
    : ["j/k move", "type to filter", ...tabs, "enter details", ...actions, "? help", `esc ${state.query ? "clear" : "close"}`];
  if (opts.closeHint) hints.push(opts.closeHint);
  return s.truncate(s.fg("dim", ` ${hints.join(" · ")}`), width, true);
}

// ── Panel ────────────────────────────────────────────────────────────────

export function render<T>(source: Source<T>, state: PanelState, now: number, width: number, height: number, s: Style, opts: RenderOptions, items: Item<T>[] = source.items()): PanelRender {
  const header = headerLines(source, width, s);
  const paneH = Math.max(6, height - header.length - 1);
  const { shown, item } = visible(state, source, items);
  const view = source.views.find((v) => v.id === state.view) ?? source.views[0];

  const listPane = (w: number, h: number) => {
    const rows = h - 2;
    const index = Math.max(0, shown.findIndex((i) => i.id === state.selected));
    // Scroll just enough to keep the selection visible.
    const first = Math.max(0, Math.min(index - rows + 1, shown.length - rows));
    // Laid out over every item, not just the matches, so columns don't jump while filtering.
    const layout = layoutColumns(source.columns, items, w - 2 - 3, s);
    const body = shown.slice(first, first + rows)
      .map((i) => itemRow(i, layout, w - 2, s, i.id === state.selected, opts.frame));
    if (!items.length) body.push(s.fg("dim", ` ${source.empty ?? "Nothing yet"}`));
    else if (!shown.length) body.push(s.fg("dim", ` Nothing matches "${state.query}"`));
    const status = source.status ? source.status(shown.length, items.length) : state.query ? `${shown.length}/${items.length}` : `${items.length}`;
    const busy = source.busy?.() ? ` ${s.fg("accent", SPINNER[opts.frame % SPINNER.length])}` : "";
    const filter = state.filtering ? s.fg("accent", ` /${state.query}▏`) : state.query ? s.fg("muted", ` filter: ${state.query}`) : "";
    return box(`${s.bold(source.name)}${busy} ${s.fg("muted", status)}${filter}`, body, w, h, state.focus === "list" && !state.zoom, s);
  };

  let page = 1;
  const detailPane = (w: number, h: number) => {
    const inner = w - 3;
    const room = Math.max(1, h - 3);
    page = room;
    if (state.help) return box(s.bold("Help"), helpLines(source, inner, s).map((l) => ` ${l}`), w, h, true, s);
    if (!item) return box("Details", [], w, h, false, s);
    const ctx: ViewContext = { now, style: s, changed: opts.changed ?? (() => {}) };
    const key = `${item.id}:${view.id}`;
    state.collapsible = undefined;
    const body = contentBody(view.render(item.value, ctx), { state, key }, inner, s);
    const max = Math.max(0, body.lines.length - room);
    if (view.tail && state.follow) state.scroll = max;
    if (state.followCursor && body.anchor !== undefined) {
      if (body.anchor < state.scroll) state.scroll = body.anchor;
      else if (body.anchor >= state.scroll + room) state.scroll = body.anchor - room + 1;
    }
    state.followCursor = false;
    // Write back so later key presses scroll from what's on screen.
    state.scroll = Math.min(state.scroll, max);
    const paint = body.paint ?? ((line: string) => line);
    const visibleLines = body.lines.slice(state.scroll, state.scroll + room).map((l) => ` ${paint(l)}`);
    const range = max > 0 ? s.fg("dim", `${state.scroll + 1}-${Math.min(body.lines.length, state.scroll + room)}/${body.lines.length}`) : "";
    const follow = view.tail ? (state.follow ? "following" : s.fg("warning", "paused · G follows")) : "";
    const more = [follow, range].filter(Boolean).join(s.fg("dim", " · "));
    return box(segments(item.title, s), [` ${tabBar(source.views, view.id, inner, s)}`, ...visibleLines], w, h, state.focus === "detail" || state.zoom, s, more);
  };

  let panes: string[];
  if (state.zoom || state.help && width < SIDE_BY_SIDE) {
    panes = detailPane(width, paneH);
  } else if (width >= SIDE_BY_SIDE) {
    const leftW = Math.min(90, Math.max(50, Math.round(width * 0.5)));
    const left = listPane(leftW, paneH);
    const right = detailPane(width - leftW, paneH);
    panes = left.map((line, i) => line + right[i]);
  } else {
    const listH = Math.max(4, Math.min(shown.length + 2, Math.floor(paneH * 0.4)));
    panes = [...listPane(width, listH), ...detailPane(width, paneH - listH)];
  }
  state.page = page;
  return { lines: [...header, ...panes, footer(source, state, width, s, opts)], page };
}
