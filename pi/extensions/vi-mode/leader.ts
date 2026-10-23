// The leader step: given the key tree, the path so far, and one key, decide
// what happens next. Pure; editor.ts applies the result.

import type { LeaderGroup, LeaderTarget } from "./leaderRegistry.ts";

// Only group() is needed, so tests can pass a real LeaderRegistry or a stub.
export interface LeaderTree {
  group(path: string[]): LeaderGroup | undefined;
}

// A single printable character, or one of the two named keys.
export type LeaderInput = string;

export type LeaderStep =
  | { type: "descend"; path: string[] }
  | { type: "run"; target: LeaderTarget; path: string[] }
  | { type: "close"; missed?: string[] };

export interface OpenCheck {
  mode: "insert" | "normal";
  pending: string;
  key: string;
  leaderKey: string;
}

// NORMAL mode with nothing half-typed only: in INSERT the key is text, and
// after `f` or `d` it's that command's argument.
export function opensLeader({ mode, pending, key, leaderKey }: OpenCheck): boolean {
  return mode === "normal" && pending === "" && key === leaderKey;
}

export function leaderKey(tree: LeaderTree, path: string[], key: LeaderInput): LeaderStep {
  if (key === "escape") return { type: "close" };
  if (key === "backspace") {
    if (path.length === 0) return { type: "close" };
    const up = path.slice(0, -1);
    // The tree may have changed under an open leader; don't descend into nothing.
    return tree.group(up) ? { type: "descend", path: up } : { type: "close" };
  }
  // Anything else that isn't one character (an arrow, a chord) has no path to show.
  if ([...key].length !== 1) return { type: "close" };

  const lower = key.toLowerCase();
  const next = [...path, lower];
  const option = tree.group(path)?.options.find((o) => o.key === lower);
  if (option?.hasChildren) return { type: "descend", path: next };
  if (option?.target) return { type: "run", target: option.target, path: next };
  return { type: "close", missed: next };
}
