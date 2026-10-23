import type { Tone } from "./format.ts";
import type { Item, Source } from "./source.ts";
import { checkSource } from "./source.ts";

// The presenter's interaction state. Sources own data and effects; everything about what's on
// screen and where the user is lives here, so every source gets the same keys and behaviour.

export interface PanelState {
  /** Selected item id. */
  selected: string | undefined;
  query: string;
  /** Keys go to the filter query rather than to actions. */
  filtering: boolean;
  focus: "list" | "detail";
  /** Id of the details view (tab) on screen. */
  view: string;
  /** Detail body scroll offset in lines. */
  scroll: number;
  /** Selected entry of a collapsible view. */
  cursor: number;
  /** Keep the cursor on screen at the next render. */
  followCursor?: boolean;
  /** Per `${itemId}:${viewId}:${index}` overrides of whether a collapsible entry is open. */
  expanded: Record<string, boolean>;
  /** A tail view sticks to the newest output until the user scrolls up. */
  follow: boolean;
  /** Detail pane fills the panel. */
  zoom: boolean;
  help: boolean;
  /** Awaiting y to run this action on this item. */
  confirm?: { action: string; item: string; text: string };
  /** One-line message in the footer until the next key. */
  flash?: { text: string; tone: Tone };
  /** Detail body height at the last render, for paging. */
  page: number;
  /**
   * The collapsible view at the last render (`${itemId}:${viewId}`) and whether the source opens
   * each entry by default, so a key press can move the cursor and toggle without rendering the
   * view again.
   */
  collapsible?: { key: string; open: boolean[] };
}

/** Throws when the source declares a reserved action key, so the mistake shows in tests. */
export function initialState<T>(source: Source<T>, items: Item<T>[] = source.items()): PanelState {
  checkSource(source);
  // Newest running item, else the newest item.
  const pick = [...items].reverse().find((i) => i.running) ?? items.at(-1);
  const view = pick?.defaultView && source.views.some((v) => v.id === pick.defaultView) ? pick.defaultView : source.views[0].id;
  return {
    selected: pick?.id, query: "", filtering: false, focus: "list", view, scroll: 0, cursor: 0,
    expanded: {}, follow: true, zoom: false, help: false, page: 1,
  };
}
