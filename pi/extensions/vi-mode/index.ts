import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ViEditor } from "./editor.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new ViEditor(tui, theme, keybindings);
      if (editor.missing.length > 0) {
        // A Pi upgrade changed the editor internals the bridge relies on.
        // Say so, rather than misbehave; the editor acts like the default.
        ctx.ui.notify(`vi-mode disabled: this Pi's editor lacks ${editor.missing.join(", ")} (checked against Pi 0.87.1)`, "error");
      }
      return editor;
    });
  });
}
