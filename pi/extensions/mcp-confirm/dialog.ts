import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { boxTable, wrap, type Row } from "./format.ts";

type Paint = { accent(s: string): string; dim(s: string): string };
type Keys = { matches(data: string, id: "tui.select.confirm" | "tui.select.cancel"): boolean };

/** What the dialog shows: a heading, an optional one-line summary, and the argument rows. */
export type Call = { title: string; summary?: string; rows: Row[] };

/**
 * The confirm dialog as a TUI component: renders at whatever width Pi gives
 * it, so the table re-wraps on resize. y or Enter allows; n or Esc denies.
 */
export function confirmComponent(call: Call, paint: Paint, keys: Keys, done: (ok: boolean) => void) {
  return {
    render(width: number): string[] {
      const inner = Math.max(1, width - 2);
      const text = (s: string) => wrap(s, inner, visibleWidth).map((l) => ` ${l}`);
      return [
        paint.dim("─".repeat(width)),
        ...text(call.title).map(paint.accent),
        ...(call.summary ? text(call.summary).map(paint.dim) : []),
        "",
        ...boxTable(call.rows, inner, visibleWidth).map((l) => ` ${l}`),
        "",
        paint.dim(" y/enter allow · n/esc deny"),
        paint.dim("─".repeat(width)),
      ];
    },
    handleInput(data: string) {
      if (data === "y" || data === "Y" || keys.matches(data, "tui.select.confirm")) done(true);
      else if (data === "n" || data === "N" || keys.matches(data, "tui.select.cancel")) done(false);
    },
    invalidate() {},
  };
}

/** Asks with the table dialog in the TUI; RPC clients get the plain confirm with the same table as text. */
export async function askToAllow(ctx: ExtensionContext, call: Call): Promise<boolean> {
  if (ctx.mode === "tui") {
    return ctx.ui.custom<boolean>((_tui, theme, keybindings, done) =>
      confirmComponent(
        call,
        { accent: (s) => theme.fg("accent", theme.bold(s)), dim: (s) => theme.fg("dim", s) },
        keybindings,
        done,
      ),
    );
  }
  const body = [call.summary, boxTable(call.rows, 80).join("\n")].filter((s) => s).join("\n\n");
  return ctx.ui.confirm(call.title, body);
}
