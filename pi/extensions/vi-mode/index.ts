import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CHECKED_PI_VERSION } from "./bridge.ts";
import { CORE_BINDINGS } from "./coreBindings.ts";
import { ViEditor } from "./editor.ts";
import { defaultLeaderConfig, loadLeaderConfig, type LeaderConfig } from "./leaderConfig.ts";
import { LEADER_CONTRIBUTE, LEADER_DISCOVER } from "./leaderContract.ts";
import { LeaderRegistry, type LeaderDiagnostic, type LeaderLeaf } from "./leaderRegistry.ts";
import type { WhichKeyStyle } from "./whichKey.ts";

type Level = "info" | "warning" | "error";
interface Notice {
  text: string;
  level: Level;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "leader.json");

// The theme is read on each draw, so a theme switch applies to an open panel.
// whichKeyLines adds its own "…", so the cut carries no ellipsis.
const panelStyle = (theme: () => Theme): WhichKeyStyle => ({
  fg: (color, text) => theme().fg(color, text),
  bold: (text) => theme().bold(text),
  inverse: (text) => theme().inverse(text),
  visibleWidth,
  truncate: (text, width) => truncateToWidth(text, width, ""),
});

const describeDiagnostics = (diagnostics: LeaderDiagnostic[]): string =>
  diagnostics.map((d) => `${d.source}${d.bindingId ? ` ${d.bindingId}` : ""}: ${d.message}`).join("; ");

// One /leader row: `SPC c l  crew › list  → /crews  (crew)`.
export function leaderRow(leaderName: string, leaf: LeaderLeaf): string {
  const target =
    "app" in leaf.target ? leaf.target.app : `/${leaf.target.command.name}${leaf.target.command.args ? ` ${leaf.target.command.args}` : ""}`;
  return `${[leaderName, ...leaf.keys].join(" ")}  ${leaf.labels.join(" › ")}  → ${target}  (${leaf.source})`;
}

export function leaderReport(config: LeaderConfig, configPath: string, configErrors: string[], registry: LeaderRegistry): string {
  const lines = [`Leader key: ${config.leader.name}`, ""];
  const leaves = registry.bindings();
  lines.push(...(leaves.length ? leaves.map((leaf) => leaderRow(config.leader.name, leaf)) : ["(no bindings)"]));
  const diagnostics = registry.diagnostics();
  if (diagnostics.length) {
    lines.push("", "Conflicts:", ...diagnostics.map((d) => `  ${describeDiagnostics([d])}`));
  }
  if (configErrors.length) {
    lines.push("", `Errors in ${configPath} (defaults in use):`, ...configErrors.map((e) => `  ${e}`));
  }
  return lines.join("\n");
}

// configPath is for tests; Pi loads the extension with the real one.
export default function (pi: ExtensionAPI, deps: { configPath?: string } = {}) {
  const configPath = deps.configPath ?? DEFAULT_CONFIG_PATH;
  const registry = new LeaderRegistry(CORE_BINDINGS);
  let config = defaultLeaderConfig();
  let configErrors: string[] = [];
  // Contributions can be rejected before any session has a UI to tell; they
  // wait here until one does.
  let notify: ((text: string, level: Level) => void) | undefined;
  const queued: Notice[] = [];
  const tell = (text: string, level: Level): void => {
    if (notify) notify(text, level);
    else queued.push({ text, level });
  };

  // Subscribe before asking, so the answers to discover aren't missed.
  pi.events.on(LEADER_CONTRIBUTE, (data) => {
    const result = registry.register(data);
    // Takeovers aren't news; /leader lists them.
    if (!result.accepted) tell(`Leader: rejected a contribution: ${describeDiagnostics(result.diagnostics)}`, "warning");
  });
  pi.events.emit(LEADER_DISCOVER, undefined);

  // The editor this extension last installed. Pi doesn't dispose a replaced
  // editor, so an open leader in it would keep redrawing from the registry.
  let active: ViEditor | undefined;
  const retire = (): void => {
    active?.dispose();
    active = undefined;
  };

  pi.registerCommand("leader", {
    description: "Show the leader key map, where each binding came from, conflicts, and leader.json errors",
    async handler(_args, ctx) {
      const report = leaderReport(config, configPath, configErrors, registry);
      if (ctx.hasUI) ctx.ui.notify(report, "info");
      else console.log(report);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    // Read at every session start, so /reload picks up edits.
    const loaded = loadLeaderConfig(configPath);
    config = loaded.config;
    configErrors = loaded.errors;
    registry.setKeymap(config.keymap);
    retire();
    if (!ctx.hasUI) return;
    const ui = ctx.ui;
    notify = (text, level) => ui.notify(text, level);
    for (const notice of queued.splice(0)) notify(notice.text, notice.level);
    if (configErrors.length) ui.notify(`Leader: ignoring ${configPath}, using the defaults: ${configErrors.join("; ")}`, "error");
    // A panel left open by the previous session's editor.
    ui.setWidget("leader", undefined);

    const leader = config.leader;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      retire();
      const editor = new ViEditor(tui, theme, keybindings, {
        registry,
        key: leader.key,
        name: leader.name,
        style: panelStyle(() => ui.theme),
        showPanel: (lines) => ui.setWidget("leader", lines, { placement: "belowEditor" }),
        commandExists: (name) => pi.getCommands().some((c) => c.name === name),
        notify: (text, level) => ui.notify(text, level),
      });
      if (editor.missing.length > 0) {
        // A Pi upgrade changed the editor internals the bridge relies on.
        // Say so, rather than misbehave; the editor acts like the default.
        ctx.ui.notify(`vi-mode disabled: this Pi's editor lacks ${editor.missing.join(", ")} (checked against Pi ${CHECKED_PI_VERSION})`, "error");
      }
      active = editor;
      return editor;
    });
  });

  pi.on("session_shutdown", () => retire());
}
