// Helpers shared by the crew, subagent, and watch panels. This directory has no index.ts and
// no link.sh line, so Pi never loads it as an extension; each extension imports it by relative
// path, which resolves through the symlinks to the real files. It must import nothing from
// those extensions. Styling is injected (Pi's theme and pi-tui in production) so layout is
// testable without Pi.

// Pi theme colour tokens. Past the semantic ones, `mdLink` (blue), `syntaxVariable` (cyan),
// `syntaxString` (gold), and `mdHeading` (yellow) are borrowed for colour that pops.
export type Tone = "accent" | "muted" | "dim" | "success" | "error" | "warning" | "border" | "borderAccent" | "borderMuted" | "text"
  | "mdLink" | "syntaxVariable" | "syntaxString" | "mdHeading";

export interface Style {
  fg(tone: Tone, text: string): string;
  bold(text: string): string;
  /** Highlight for the selected list row. */
  selected(text: string): string;
  width(text: string): number;
  /** Cut to `width` columns with an ellipsis; `pad` fills short text with spaces. */
  truncate(text: string, width: number, pad?: boolean): string;
  wrap(text: string, width: number): string[];
  /** Render markdown to lines no wider than `width`. Only panels that show markdown need it. */
  markdown?(text: string, width: number): string[];
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TAB_WIDTH = 8;

/** Compact elapsed time: `12s`, `1m04s`, `1h02m`. */
export function duration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

/** Elapsed time as `mm:ss`, for timestamps relative to a start. */
export function elapsedClock(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

/** Local wall-clock time of an epoch ms, as `hh:mm:ss`. */
export function wallClock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Dollars to the cent; a non-zero amount under a cent shows as `<$0.01` rather than `$0.00`. */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

const home = process.env.HOME ?? "";
export const tildify = (path: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

/** Worker output and check tails can carry ANSI colours and tabs; either breaks column math. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b./g, "")
    .replace(/\t/g, "    ")
    .replace(/\r/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
}

export const oneLine = (text: string) => clean(text).replace(/\s+/g, " ").trim();

export const padStart = (text: string, width: number, s: Style) => " ".repeat(Math.max(0, width - s.width(text))) + text;

/** Expand tabs to 8-column stops: the width helpers count a tab as one column. */
export function expandTabs(text: string): string {
  return text.split("\n").map((line) => {
    let out = "";
    for (const [i, part] of line.split("\t").entries()) {
      if (i > 0) out += " ".repeat(TAB_WIDTH - ([...out].length % TAB_WIDTH));
      out += part;
    }
    return out;
  }).join("\n");
}

/**
 * A rounded, bordered pane `height` lines tall, with `title` in the top border and optional
 * `bottom` text in the bottom one. Focused panes get an accent border and a bold title; `tone`
 * overrides the border colour.
 */
export function box(title: string, body: string[], width: number, height: number, focused: boolean, s: Style, bottom = "", tone: Tone = focused ? "borderAccent" : "borderMuted"): string[] {
  const inner = Math.max(1, width - 2);
  const head = s.truncate(` ${focused ? s.bold(title) : title} `, Math.max(0, inner - 1));
  const lines = [s.fg(tone, "╭─") + head + s.fg(tone, `${"─".repeat(Math.max(0, inner - 1 - s.width(head)))}╮`)];
  for (let i = 0; i < height - 2; i++) lines.push(s.fg(tone, "│") + s.truncate(body[i] ?? "", inner, true) + s.fg(tone, "│"));
  const tail = bottom && s.width(bottom) + 3 <= inner ? ` ${bottom} ` : "";
  lines.push(tail
    ? s.fg(tone, `╰${"─".repeat(inner - s.width(tail) - 1)}`) + tail + s.fg(tone, "─╯")
    : s.fg(tone, `╰${"─".repeat(inner)}╯`));
  return lines;
}
