// vi-mode's own leader bindings, loaded before any extension's. Unlike
// contributions they may target Pi app actions (the handlers Pi copies into
// the editor's actionHandlers).

import type { LeaderSegment } from "./leaderContract.ts";
import type { CoreBinding } from "./leaderRegistry.ts";

const MODELS: LeaderSegment = { key: "m", label: "models" };
const SESSIONS: LeaderSegment = { key: "s", label: "sessions" };
const HELP: LeaderSegment = { key: "h", label: "help" };
const QUIT: LeaderSegment = { key: "q", label: "quit" };

const app = (id: string, group: LeaderSegment, key: string, label: string, action: string): CoreBinding => ({
  id,
  path: [group, { key, label }],
  target: { app: action },
});

const command = (id: string, group: LeaderSegment, key: string, label: string, name: string): CoreBinding => ({
  id,
  path: [group, { key, label }],
  target: { command: { name } },
});

export const CORE_BINDINGS: readonly CoreBinding[] = [
  app("models.select", MODELS, "m", "select", "app.model.select"),
  app("models.next", MODELS, "n", "next", "app.model.cycleForward"),
  app("models.thinking", MODELS, "t", "thinking", "app.thinking.cycle"),
  app("sessions.new", SESSIONS, "n", "new", "app.session.new"),
  app("sessions.resume", SESSIONS, "r", "resume", "app.session.resume"),
  app("sessions.tree", SESSIONS, "t", "tree", "app.session.tree"),
  app("sessions.fork", SESSIONS, "f", "fork", "app.session.fork"),
  command("help.hotkeys", HELP, "h", "hotkeys", "hotkeys"),
  command("help.leader", HELP, "l", "leader map", "leader"),
  command("quit", QUIT, "q", "quit", "quit"),
];

// Pi's own slash commands that bindings use. pi.getCommands() lists only
// extension, prompt, and skill commands, so these are checked by name.
export const PI_BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["hotkeys", "quit"]);
