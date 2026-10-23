// ~/.pi/agent/leader.json: the leader key and the user keymap. Parsed once
// here into typed values; any error rejects the whole file, because a
// half-applied keymap is more confusing than none.
//
//   { "leader": "space",
//     "keymap": [
//       { "keys": "c", "label": "crew" },
//       { "keys": "c l", "label": "list", "command": "crews" },
//       { "keys": "q q", "unbind": true } ] }

import { readFileSync } from "node:fs";
import { isNormalStartKey } from "./keys.ts";
import type { LeaderCommand, LeaderTone } from "./leaderContract.ts";
import { commandNameError, detailError, hasControlChar, keyError, labelError, type KeymapEntry } from "./leaderRegistry.ts";

// key is what the terminal sends; name is how paths are shown ("SPC c l").
export interface LeaderKey {
  key: string;
  name: string;
}

export interface LeaderConfig {
  leader: LeaderKey;
  keymap: KeymapEntry[];
}

export interface LeaderConfigResult {
  config: LeaderConfig;
  errors: string[];
}

const SPACE: LeaderKey = { key: " ", name: "SPC" };
const MAX_KEYS = 4;
const TOP_FIELDS = new Set(["leader", "keymap"]);
const ENTRY_FIELDS = new Set(["keys", "label", "command", "detail", "tone", "unbind"]);

export const defaultLeaderConfig = (): LeaderConfig => ({ leader: { ...SPACE }, keymap: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLeader(value: unknown, errors: string[]): LeaderKey | undefined {
  if (value === "space" || value === " ") return { ...SPACE };
  if (typeof value !== "string" || [...value].length !== 1 || hasControlChar(value)) {
    errors.push(`leader must be "space" or one printable character`);
    return undefined;
  }
  if (isNormalStartKey(value)) {
    errors.push(`leader "${value}" is a vi NORMAL-mode key; pick one NORMAL mode leaves unused, such as "space" or "\\\\"`);
    return undefined;
  }
  return { key: value, name: value };
}

function parseEntry(value: unknown, field: string, errors: string[]): KeymapEntry | undefined {
  const before = errors.length;
  const fail = (message: string): undefined => {
    errors.push(`${field}: ${message}`);
    return undefined;
  };
  if (!isRecord(value)) return fail("must be an object");
  for (const name of Object.keys(value)) if (!ENTRY_FIELDS.has(name)) fail(`unknown field "${name}"`);

  let keys: string[] | undefined;
  if (typeof value.keys !== "string") fail(`keys must be a string of space-separated keys, such as "c l"`);
  else {
    const split = value.keys.trim().toLowerCase().split(/\s+/).filter((k) => k !== "");
    if (split.length < 1 || split.length > MAX_KEYS) fail(`keys must have 1-${MAX_KEYS} keys`);
    for (const key of split) {
      const error = keyError(key);
      if (error) fail(`key "${key}" ${error}`);
    }
    keys = split;
  }

  if (Object.hasOwn(value, "unbind")) {
    if (value.unbind !== true) fail("unbind must be true");
    for (const name of ["label", "command", "detail", "tone"]) {
      if (Object.hasOwn(value, name)) fail(`an unbind entry can't have ${name}`);
    }
    if (keys === undefined || errors.length > before) return undefined;
    return { keys, unbind: true };
  }

  let label: string | undefined;
  if (typeof value.label !== "string") fail("needs a label (or unbind: true)");
  else {
    const error = labelError(value.label.trim());
    if (error) fail(`label ${error}`);
    else label = value.label.trim();
  }

  let command: LeaderCommand | undefined;
  if (value.command !== undefined) {
    if (typeof value.command !== "string") fail(`command must be a string, such as "goal status"`);
    else {
      const text = value.command.trim();
      const space = text.search(/\s/);
      const name = space === -1 ? text : text.slice(0, space);
      const args = space === -1 ? "" : text.slice(space).trim();
      const error = commandNameError(name);
      if (error) fail(`command name ${error}`);
      else if (hasControlChar(args)) fail("command must not contain control characters");
      else command = args ? { name, args } : { name };
    }
  }

  let detail: string | undefined;
  if (value.detail !== undefined) {
    if (typeof value.detail !== "string") fail("detail must be a string");
    else {
      const error = detailError(value.detail.trim());
      if (error) fail(`detail ${error}`);
      else detail = value.detail.trim();
    }
  }

  let tone: LeaderTone | undefined;
  if (value.tone !== undefined) {
    if (value.tone === "default" || value.tone === "exit") tone = value.tone;
    else fail(`tone must be "default" or "exit"`);
  }

  if (keys === undefined || label === undefined || errors.length > before) return undefined;
  return { keys, label, ...(command ? { command } : {}), ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) };
}

export function parseLeaderConfig(value: unknown): LeaderConfigResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { config: defaultLeaderConfig(), errors: ["must be a JSON object"] };
  for (const name of Object.keys(value)) if (!TOP_FIELDS.has(name)) errors.push(`unknown field "${name}"`);

  const leader = value.leader === undefined ? { ...SPACE } : parseLeader(value.leader, errors);
  const keymap: KeymapEntry[] = [];
  if (value.keymap !== undefined) {
    if (!Array.isArray(value.keymap)) errors.push("keymap must be an array");
    else {
      value.keymap.forEach((entry: unknown, i) => {
        const parsed = parseEntry(entry, `keymap[${i}]`, errors);
        if (parsed) keymap.push(parsed);
      });
    }
  }
  if (errors.length > 0 || leader === undefined) return { config: defaultLeaderConfig(), errors };
  return { config: { leader, keymap }, errors: [] };
}

// A missing file is the defaults with no errors; an unreadable or invalid one
// is the defaults plus the errors, for the caller to report.
export function loadLeaderConfig(path: string): LeaderConfigResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { config: defaultLeaderConfig(), errors: [] };
    }
    return { config: defaultLeaderConfig(), errors: [`can't read: ${error instanceof Error ? error.message : String(error)}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { config: defaultLeaderConfig(), errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  return parseLeaderConfig(raw);
}
