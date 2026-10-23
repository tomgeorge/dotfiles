import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type KeyId, type OverlayOptions } from "@earendil-works/pi-tui";
import type { Style, Tone } from "./format.ts";
import { input, type PanelInput, type PanelKey } from "./input.ts";
import { render } from "./render.ts";
import type { Action, ActionContext, Item, Result, Source } from "./source.ts";
import { initialState } from "./state.ts";

// Everything that touches Pi: raw key data to panel input, the theme to a Style, and the
// overlay that draws a source, ticks its spinners, and carries out the actions input() returns.

const TICK_MS = 500;
const HEIGHT = 0.85;
const OVERLAY: OverlayOptions = { anchor: "center", width: "95%", minWidth: 60, maxHeight: "85%" };

// First match wins. Printable keys that aren't listed go to the panel as characters.
export const PANEL_KEYS: [KeyId[], PanelKey][] = [
  [["up", "ctrl+p"], "up"],
  [["down", "ctrl+n"], "down"],
  [["pageUp", "ctrl+u"], "pageUp"],
  [["pageDown", "ctrl+d"], "pageDown"],
  [["home"], "top"],
  [["end"], "bottom"],
  [["enter", "right"], "enter"],
  [["left"], "left"],
  [["escape"], "escape"],
  [["tab"], "tab"],
  [["shift+tab"], "backTab"],
  [["backspace"], "backspace"],
  [["ctrl+o"], "zoom"],
  [["ctrl+c"], "close"],
];

/** `closeKeys`, e.g. the shortcut that opened the panel, close it too. */
export function panelEvent(data: string, closeKeys: KeyId[] = []): PanelInput | undefined {
  if (closeKeys.some((id) => matchesKey(data, id))) return { key: "close" };
  const key = PANEL_KEYS.find(([ids]) => ids.some((id) => matchesKey(data, id)))?.[1];
  if (key) return { key };
  // Kitty's keyboard protocol sends even plain letters as escape sequences.
  const char = data.length === 1 && data >= " " && data !== "\x7f" ? data : decodeKittyPrintable(data);
  return char ? { char } : undefined;
}

export function makeStyle(theme: Theme, markdown?: Style["markdown"]): Style {
  return {
    fg: (tone, text) => theme.fg(tone, text),
    bold: (text) => theme.bold(text),
    selected: (text) => theme.bg("selectedBg", text),
    width: visibleWidth,
    truncate: (text, width, pad) => truncateToWidth(text, Math.max(0, width), "…", pad),
    wrap: (text, width) => wrapTextWithAnsi(text, Math.max(1, width)),
    ...(markdown ? { markdown } : {}),
  };
}

export interface PanelOptions {
  /** Guards against opening the same panel twice; default the source's name. */
  id?: string;
  /** The shortcut that opens the panel: it closes it too, and the footer says so. */
  closeKey?: KeyId;
  /** Spinner and refresh interval. */
  tickMs?: number;
  overlay?: OverlayOptions;
  /** Default `makeStyle(theme)`. */
  style?(theme: Theme): Style;
}

export interface PanelHandle {
  close(): void;
  /** Settles when the panel has closed. */
  closed: Promise<void>;
}

/** Panels open in this extension, by id. Per extension: Pi loads each with its own module cache. */
const open = new Set<string>();

const notifyType = (tone: Tone) => (tone === "error" ? "error" : tone === "warning" ? "warning" : "info");

/**
 * Show `source` in an overlay. Returns at once, not when the panel closes: Pi blocks the editor
 * while a command handler runs. Undefined without a UI or when this panel is already open.
 * Throws when the source declares a reserved key.
 */
export function openPanel<T>(ctx: ExtensionContext, source: Source<T>, opts: PanelOptions = {}): PanelHandle | undefined {
  const id = opts.id ?? source.name;
  if (!ctx.hasUI || open.has(id)) return undefined;
  const state = initialState(source);
  open.add(id);
  let finish: (() => void) | undefined;
  let closeRequested = false;
  const closeKeys = opts.closeKey ? [opts.closeKey] : [];
  const closeHint = opts.closeKey ? `${opts.closeKey} close` : undefined;

  const closed = ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    finish = () => done();
    const style = (opts.style ?? makeStyle)(theme);
    const rerender = () => tui.requestRender();
    let frame = 0;
    // Counts key presses, so a slow action's result doesn't clobber a newer flash.
    let keys = 0;
    const ticker = setInterval(() => { frame++; rerender(); }, opts.tickMs ?? TICK_MS);
    const unsubscribe = source.subscribe?.(rerender);

    const run = (action: Action<T>, item: Item<T>) => {
      const started = keys;
      const show = (flash: { text: string; tone: Tone }) => {
        // A later key press cleared or replaced the flash: notify instead of clobbering it.
        if (keys === started) state.flash = flash;
        else ctx.ui.notify(flash.text, notifyType(flash.tone));
        rerender();
      };
      const settle = (result: Result) => {
        if (result === "close") done();
        else if (result) show({ text: result.flash, tone: result.tone ?? "accent" });
        else rerender();
      };
      const fail = (error: unknown) => show({ text: `${action.label} failed: ${(error as Error)?.message ?? String(error)}`, tone: "error" });
      const actx: ActionContext = {
        flash(text, tone = "dim") {
          if (keys !== started) return;
          state.flash = { text, tone };
          rerender();
        },
      };
      let result: Result | Promise<Result>;
      try {
        result = action.run(item.value, actx);
      } catch (error) {
        return fail(error);
      }
      // Synchronous results show at once, before the next render.
      if (result instanceof Promise) result.then(settle, fail);
      else settle(result);
    };

    if (closeRequested) queueMicrotask(() => done());
    return {
      render(width: number) {
        const height = Math.max(12, Math.floor(tui.terminal.rows * HEIGHT));
        return render(source, state, Date.now(), width, height, style, { frame, closeHint, changed: rerender }).lines;
      },
      handleInput(data: string) {
        const event = panelEvent(data, closeKeys);
        if (!event) return;
        keys++;
        const command = input(state, source, event);
        if (command.type === "close") return done();
        if (command.type === "run") run(command.action, command.item);
        rerender();
      },
      invalidate() {},
      dispose() {
        clearInterval(ticker);
        unsubscribe?.();
        source.dispose?.();
      },
    };
  }, { overlay: true, overlayOptions: opts.overlay ?? OVERLAY })
    .catch((error: unknown) => ctx.ui.notify(`${source.name} panel: ${(error as Error).message}`, "error"))
    .finally(() => { open.delete(id); });

  return {
    close() {
      if (finish) finish();
      else closeRequested = true;
    },
    closed,
  };
}
