import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { SPINNER } from "../run-panel/format.ts";

// A spinner line below the editor while slow git work runs (worktree setup and removal in a big
// repo can take minutes), so a crew start or clean doesn't look hung.

const WIDGET_KEY = "crew-progress";
const FRAME_MS = 80;

/** Updates the line's text as the work moves to its next step. */
export type Step = (text: string) => void;

/** Run `work` with `text` and a spinner shown below the editor; removed when it settles. */
export async function withProgress<T>(ctx: ExtensionContext, text: string, work: (step: Step) => Promise<T>): Promise<T> {
  if (!ctx.hasUI) return work(() => {});
  let line = text;
  let frame = 0;
  let requestRender: (() => void) | undefined;
  ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
    requestRender = () => tui.requestRender();
    return {
      render: (width: number) => [truncateToWidth(`${theme.fg("accent", SPINNER[frame % SPINNER.length])} ${line}`, Math.max(0, width))],
      invalidate() {},
    };
  }, { placement: "belowEditor" });
  const timer = setInterval(() => { frame++; requestRender?.(); }, FRAME_MS);
  try {
    return await work((next) => { line = next; requestRender?.(); });
  } finally {
    clearInterval(timer);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
}
