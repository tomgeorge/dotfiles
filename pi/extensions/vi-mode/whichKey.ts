// The which-key panel: the options under the current leader path, drawn as a
// grid of two-line cards below the editor. Pure; colours and width
// measurement are injected so tests render plain text.
//
// Layout from DoomPi's leaderHints.ts (MIT, github.com/AgiFlow/doompi @ c3f057a,
// packages/foundations/doompi-ui/src/tui/leaderHints.ts), without its frame,
// shading, root trail, and session-diagnostics rows.

import type { LeaderGroup, LeaderOption } from "./leaderRegistry.ts";

// A subset of Pi's ThemeColor names, so Milestone 3 can pass theme.fg through.
export type WhichKeyColor = "accent" | "warning" | "dim" | "text";

export interface WhichKeyStyle {
  fg(color: WhichKeyColor, text: string): string;
  bold(text: string): string;
  // Makes the key a badge. Pi's theme has it; plain text doesn't need it.
  inverse(text: string): string;
  visibleWidth(text: string): number;
  // Cut plain text to at most width columns, with no ellipsis: whichKeyLines adds the `…`.
  truncate(text: string, width: number): string;
}

// Plain text, one column per code point. For tests and anything without a theme.
export const plainStyle: WhichKeyStyle = {
  fg: (_color, text) => text,
  bold: (text) => text,
  inverse: (text) => text,
  visibleWidth: (text) => [...text].length,
  truncate: (text, width) => [...text].slice(0, Math.max(0, width)).join(""),
};

export const MAX_LINES = 21;
const HINT = "esc cancel · backspace up";
const HEADER_GAP = 2;
const GRID_GAP = 2;
// Puts the detail under the label: badge " k " plus a space.
const DETAIL_INDENT = 4;
const GROUP_MARKER = "+";
const ELLIPSIS = "…";

// Column count comes from width alone, so every board lines up at one size.
const COLUMN_BREAKPOINTS: readonly { minWidth: number; columns: number }[] = [
  { minWidth: 130, columns: 4 },
  { minWidth: 90, columns: 3 },
  { minWidth: 56, columns: 2 },
];

export function columnsFor(width: number): number {
  return COLUMN_BREAKPOINTS.find((b) => width >= b.minWidth)?.columns ?? 1;
}

function fit(text: string, width: number, style: WhichKeyStyle): string {
  if (width <= 0) return "";
  if (style.visibleWidth(text) <= width) return text;
  return style.truncate(text, width - 1) + ELLIPSIS;
}

interface Cell {
  // Styled text and its plain width, so padding never measures escape codes.
  heading: string;
  headingWidth: number;
  detail: string;
  detailWidth: number;
}

function cell(option: LeaderOption, width: number, style: WhichKeyStyle): Cell {
  const key = ` ${option.key} `;
  const badge = style.inverse(style.bold(style.fg(option.tone === "exit" ? "warning" : "accent", key)));
  const label = fit(`${option.hasChildren ? GROUP_MARKER : ""}${option.label}`, width - DETAIL_INDENT, style);
  const heading = label === "" ? badge : `${badge} ${style.bold(style.fg("text", label))}`;
  const headingWidth = style.visibleWidth(key) + (label === "" ? 0 : 1 + style.visibleWidth(label));
  const detail = option.detail ? fit(option.detail, width - DETAIL_INDENT, style) : "";
  return {
    heading,
    headingWidth,
    detail: detail === "" ? "" : " ".repeat(DETAIL_INDENT) + style.fg("dim", detail),
    detailWidth: detail === "" ? 0 : DETAIL_INDENT + style.visibleWidth(detail),
  };
}

function header(path: string[], label: string, leaderName: string, width: number, style: WhichKeyStyle): string {
  const crumb = fit(`${[leaderName, ...path].join(" › ")} / ${label}`, width, style);
  const crumbWidth = style.visibleWidth(crumb);
  const left = style.bold(style.fg("text", crumb));
  // The hint goes first when there's no room: the breadcrumb says where you are.
  const room = width - crumbWidth - HEADER_GAP;
  if (room < style.visibleWidth(HINT)) return left;
  return left + " ".repeat(room - style.visibleWidth(HINT) + HEADER_GAP) + style.fg("dim", HINT);
}

// Rows of the option grid within budget lines. Details go before options do;
// when even one line per row is too many, the last line says what's hidden.
function grid(options: LeaderOption[], width: number, budget: number, style: WhichKeyStyle): string[] {
  if (options.length === 0 || budget <= 0) return [];
  const columns = columnsFor(width);
  const cellWidth = Math.max(1, Math.floor((width - GRID_GAP * (columns - 1)) / columns));
  const cells = options.map((o) => cell(o, cellWidth, style));
  const rowCount = Math.ceil(cells.length / columns);
  const withDetail = rowCount * 2 <= budget;
  const gap = " ".repeat(GRID_GAP);

  const join = (row: Cell[], text: (c: Cell) => string, size: (c: Cell) => number): string =>
    row
      .map((c, i) => (i === row.length - 1 ? text(c) : text(c) + " ".repeat(Math.max(0, cellWidth - size(c)))))
      .join(gap)
      .trimEnd();

  const lines: string[] = [];
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  const shown = rowCount <= budget ? rows : rows.slice(0, budget - 1);
  for (const row of shown) {
    lines.push(join(row, (c) => c.heading, (c) => c.headingWidth));
    // Kept even when every detail is empty, so each card is two lines.
    if (withDetail) lines.push(join(row, (c) => c.detail, (c) => c.detailWidth));
  }
  const hidden = options.length - shown.length * columns;
  if (hidden > 0) lines.push(style.fg("dim", fit(`${ELLIPSIS} ${hidden} more`, width, style)));
  return lines;
}

// The panel for group at path. leaderName is the leader key's display name (SPC, \).
export function whichKeyLines(group: LeaderGroup, path: string[], leaderName: string, width: number, style: WhichKeyStyle): string[] {
  if (width <= 0) return [];
  const head = header(path, group.label, leaderName, width, style);
  // No frame and no diagnostics, so everything below the header is the options'.
  return [head, ...grid(group.options, width, MAX_LINES - 1, style)];
}
