import { spawnSync } from "node:child_process";

/** Render markdown to terminal lines no wider than `width`. */
export type MarkdownRenderer = (text: string, width: number) => string[];

const CACHE_LIMIT = 64;
const GLOW_TIMEOUT_MS = 2000;
const ANSI = /\x1b\[[0-9;]*m/g;
const blank = (line: string) => line.replace(ANSI, "").trim() === "";

/** Drop blank lines glow adds above and below the document. */
export function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && blank(lines[start])) start++;
  while (end > start && blank(lines[end - 1])) end--;
  return lines.slice(start, end);
}

export interface GlowOptions {
  /** Executable; tests point this at a stub. */
  command?: string;
  /** Glamour style. "auto" falls back to plain text when stdout isn't a TTY, so name one. */
  style?: string;
}

/**
 * Render with `glow`, falling back to `fallback` when glow is missing or fails.
 * The popup re-renders every spinner tick, so results are cached per text and width.
 */
export function glowRenderer(fallback: MarkdownRenderer, opts: GlowOptions = {}): MarkdownRenderer {
  const command = opts.command ?? "glow";
  const style = opts.style ?? process.env.PI_SUBAGENT_GLOW_STYLE ?? "dark";
  let missing = false;
  const cache = new Map<string, string[]>();

  function glow(text: string, width: number): string[] | undefined {
    if (missing) return undefined;
    const run = spawnSync(command, ["-s", style, "-w", String(width), "-"], {
      input: text, encoding: "utf8", timeout: GLOW_TIMEOUT_MS,
    });
    if (run.error) {
      // Not installed: stop trying. Other errors (timeout) only affect this text.
      if ((run.error as NodeJS.ErrnoException).code === "ENOENT") missing = true;
      return undefined;
    }
    if (run.status !== 0) return undefined;
    return trimBlank(run.stdout.replace(/\n$/, "").split("\n"));
  }

  return (text, width) => {
    const key = `${width}\0${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const lines = glow(text, width) ?? fallback(text, width);
    if (cache.size >= CACHE_LIMIT) {
      // Maps iterate in insertion order, so the first key is the oldest entry.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, lines);
    return lines;
  };
}
