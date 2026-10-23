import type { Action, Item, Source } from "./source.ts";
import type { PanelState } from "./state.ts";

// Key handling for every panel. Synchronous and free of effects: it mutates the state and
// returns the action to run, which pi.ts carries out.

export type PanelKey =
  | "up" | "down" | "pageUp" | "pageDown" | "top" | "bottom" | "enter" | "left" | "escape"
  | "tab" | "backTab" | "backspace" | "zoom" | "close";

export type PanelInput = { key: PanelKey } | { char: string };

export type Command<T = unknown> =
  | { type: "none" }
  | { type: "close" }
  | { type: "run"; action: Action<T>; item: Item<T> };

const NONE = { type: "none" } as const;
const CLOSE = { type: "close" } as const;

// ── Filtering ────────────────────────────────────────────────────────────

/** Subsequence match; lower scores are better. Undefined when `query` isn't in `text` in order. */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let last = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, last + 1);
    if (i < 0) return undefined;
    if (i === last + 1 && last >= 0) score -= 5;
    else if (last >= 0) score += i - last - 1;
    if (i === 0 || /[\s\-_./:#]/.test(t[i - 1])) score -= 8;
    score += i * 0.01;
    last = i;
  }
  return score;
}

/** A token matches within one field, so letters scattered across fields don't. */
const fieldScore = (token: string, fields: string[]) =>
  fields.reduce<number | undefined>((best, field) => {
    const score = fuzzyScore(token, field);
    return score !== undefined && (best === undefined || score < best) ? score : best;
  }, undefined);

/** Items matching every space-separated token, best first; source order breaks ties. */
export function filterItems<T>(items: Item<T>[], query: string): Item<T>[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return items;
  const scored: { item: Item<T>; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const fields = typeof item.text === "string" ? [item.text] : item.text;
    let total = 0;
    for (const token of tokens) {
      const score = fieldScore(token, fields);
      if (score === undefined) return;
      total += score;
    }
    scored.push({ item, score: total, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((x) => x.item);
}

// ── Selection ────────────────────────────────────────────────────────────

/** The visible items and the selected one, re-anchoring the selection when the filter hides it. */
export function visible<T>(state: PanelState, source: Source<T>, items: Item<T>[]): { shown: Item<T>[]; item: Item<T> | undefined; index: number } {
  const shown = filterItems(items, state.query);
  let index = shown.findIndex((i) => i.id === state.selected);
  if (index < 0 && shown.length) {
    index = 0;
    select(state, source, shown[0]);
  }
  const item = shown[index];
  if (item && !state.viewPicked) followDefault(state, source, item);
  return { shown, item, index };
}

function select<T>(state: PanelState, source: Source<T>, item: Item<T>) {
  if (item.id === state.selected) return;
  state.selected = item.id;
  state.scroll = 0;
  state.cursor = 0;
  state.follow = true;
  state.viewPicked = false;
  followDefault(state, source, item);
}

/** Show the item's default view, unless the user picked one; it can change on a refresh. */
function followDefault<T>(state: PanelState, source: Source<T>, item: Item<T>) {
  if (item.defaultView && source.views.some((v) => v.id === item.defaultView)) setView(state, item.defaultView);
}

/** A view the user asked for sticks until they select another item. */
function pickView(state: PanelState, view: string) {
  state.viewPicked = true;
  setView(state, view);
}

function setView(state: PanelState, view: string) {
  if (view === state.view) return;
  state.view = view;
  state.scroll = 0;
  state.cursor = 0;
  state.follow = true;
}

// ── Keys ─────────────────────────────────────────────────────────────────

const KEY_CHARS: Record<string, PanelKey> = { j: "down", k: "up", g: "top", G: "bottom", l: "enter", h: "left", q: "close", " ": "enter" };

/** Apply one key press. Mutates `state`; returns what the caller should do. */
export function input<T>(state: PanelState, source: Source<T>, event: PanelInput, items: Item<T>[] = source.items()): Command<T> {
  state.flash = undefined;
  const key = "key" in event ? event.key : undefined;
  const char = "char" in event ? event.char : undefined;
  if (key === "close") return CLOSE;

  if (state.confirm) {
    const { action: id, item: itemId } = state.confirm;
    state.confirm = undefined;
    const action = source.actions.find((a) => a.id === id);
    const item = items.find((i) => i.id === itemId);
    if (!action || !item) {
      state.flash = { text: "That item is gone", tone: "dim" };
      return NONE;
    }
    if (char !== "y" && char !== "Y") {
      state.flash = { text: "Nothing done", tone: "dim" };
      return NONE;
    }
    // The item may have changed while the question was up, e.g. the run finished.
    const ok = action.available ? action.available(item.value) : true;
    if (ok !== true) {
      state.flash = { text: ok, tone: "warning" };
      return NONE;
    }
    return { type: "run", action, item };
  }
  if (state.help) {
    state.help = false;
    return char === "q" ? CLOSE : NONE;
  }

  if (state.filtering) {
    if (char !== undefined) { state.query += char; return NONE; }
    if (key === "backspace") {
      state.query = state.query.slice(0, -1);
      if (!state.query) state.filtering = false;
      return NONE;
    }
    if (key === "escape") { state.query = ""; state.filtering = false; return NONE; }
    if (key === "enter" || key === "tab") { state.filtering = false; return NONE; }
    return move(state, source, items, key!);
  }

  if (char !== undefined) return pressChar(state, source, items, char);

  switch (key) {
    case "tab": case "backTab": {
      const views = source.views;
      const i = views.findIndex((v) => v.id === state.view) + (key === "tab" ? 1 : -1);
      pickView(state, views[(i + views.length) % views.length].id);
      return NONE;
    }
    case "zoom": state.zoom = !state.zoom; return NONE;
    case "backspace": return NONE;
    case "escape":
      if (state.query) state.query = "";
      else if (state.focus === "detail") state.focus = "list";
      else if (state.zoom) state.zoom = false;
      else return CLOSE;
      return NONE;
    default: return move(state, source, items, key!);
  }
}

/** A printable key outside the filter: a view number, an action, a vi key, or the start of a filter. */
function pressChar<T>(state: PanelState, source: Source<T>, items: Item<T>[], char: string): Command<T> {
  if (/^[1-9]$/.test(char) && Number(char) <= source.views.length) {
    pickView(state, source.views[Number(char) - 1].id);
    return NONE;
  }
  if (char === "?") { state.help = true; return NONE; }
  const action = source.actions.find((a) => a.key === char);
  if (action) {
    const { item } = visible(state, source, items);
    return item ? request(state, action, item) : NONE;
  }
  const mapped = KEY_CHARS[char];
  if (mapped === "close") return CLOSE;
  if (mapped) return move(state, source, items, mapped);
  // Any other printable key starts a filter: type to jump.
  state.filtering = true;
  if (char !== "/") state.query = char;
  return NONE;
}

/** Run the action, unless it's unavailable for this item or wants a y first. */
function request<T>(state: PanelState, action: Action<T>, item: Item<T>): Command<T> {
  const ok = action.available ? action.available(item.value) : true;
  if (ok !== true) {
    state.flash = { text: ok, tone: "warning" };
    return NONE;
  }
  if (action.confirm) {
    state.confirm = { action: action.id, item: item.id, text: action.confirm(item.value) };
    return NONE;
  }
  return { type: "run", action, item };
}

function move<T>(state: PanelState, source: Source<T>, items: Item<T>[], key: PanelKey): Command<T> {
  const { shown, item, index } = visible(state, source, items);
  // Paging always scrolls the details, so a long view reads without leaving the list.
  if (key === "pageUp" || key === "pageDown") {
    if (key === "pageUp") state.follow = false;
    state.scroll = Math.max(0, state.scroll + (key === "pageDown" ? state.page : -state.page));
    return NONE;
  }
  if (state.focus === "list" && !state.filtering) {
    if (key === "enter") { if (item) state.focus = "detail"; return NONE; }
    if (key === "left") return NONE;
  }
  if (state.focus === "detail" && !state.filtering) {
    if (key === "left") { state.focus = "list"; return NONE; }
    const collapsible = item && state.collapsible?.key === `${item.id}:${state.view}` ? state.collapsible : undefined;
    if (item && collapsible) moveCursor(state, item, collapsible.open, key);
    else if (key === "enter") state.focus = "list";
    else scrollDetail(state, key);
    return NONE;
  }
  const last = shown.length - 1;
  const target = key === "up" ? index - 1 : key === "down" ? index + 1 : key === "top" ? 0 : key === "bottom" ? last : index;
  const next = shown[Math.min(last, Math.max(0, target))];
  if (next) select(state, source, next);
  return NONE;
}

/** In a collapsible view the keys pick an entry; enter opens or closes it. */
function moveCursor<T>(state: PanelState, item: Item<T>, open: boolean[], key: PanelKey) {
  const count = open.length;
  if (!count) return;
  // Entries may have gone since the cursor was placed.
  state.cursor = Math.min(count - 1, Math.max(0, state.cursor));
  if (key === "enter") {
    const id = `${item.id}:${state.view}:${state.cursor}`;
    state.expanded[id] = !(state.expanded[id] ?? open[state.cursor]);
    state.followCursor = true;
    return;
  }
  const step = key === "down" ? 1 : key === "up" ? -1 : key === "top" ? -Infinity : key === "bottom" ? Infinity : 0;
  if (!step) return;
  state.cursor = Math.min(count - 1, Math.max(0, state.cursor + step));
  state.followCursor = true;
}

function scrollDetail(state: PanelState, key: PanelKey) {
  // Only G resumes following: a resize or eviction that clamps the scroll mustn't.
  if (key === "up" || key === "top") state.follow = false;
  if (key === "bottom") state.follow = true;
  if (key === "top") state.scroll = 0;
  else if (key === "bottom") state.scroll = Number.MAX_SAFE_INTEGER;
  else if (key === "up" || key === "down") state.scroll = Math.max(0, state.scroll + (key === "down" ? 1 : -1));
}
