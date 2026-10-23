// The leader registry: turns vi-mode's core bindings, every extension's
// contribution, and the user's keymap into one key tree. Pure, no Pi imports.
//
// Ported from DoomPi's leader registry (MIT,
// github.com/AgiFlow/doompi @ c3f057a, packages/foundations/doompi-ui/src/services/leaderRegistry).
// Dropped: the Cordis hub, telemetry, deferred registration, extension actions
// and option order. Added: the user keymap layer.
//
// The tree is rebuilt from scratch on every change, in this order:
//   1. core bindings (a conflict among them throws: it's a bug in vi-mode);
//   2. contributions in registration order, each one's bindings in id order.
//      The last to claim a key wins, and the takeover is reported;
//   3. the user keymap, in file order. It always wins and isn't reported.
// Because nothing is mutated in place, a binding displaced by a later source
// comes back when that source unregisters.

import type { LeaderCommand, LeaderSegment, LeaderTone } from "./leaderContract.ts";

export type LeaderTarget = { command: LeaderCommand } | { app: string };
export type LeaderPath = [LeaderSegment, ...LeaderSegment[]];

// vi-mode's own bindings. Unlike contributions they may target Pi app actions.
export interface CoreBinding {
  id: string;
  path: LeaderPath;
  target: LeaderTarget;
}

// One parsed leader.json keymap entry (see leaderConfig.ts). With a command it
// binds a leaf; without one it relabels whatever is at keys, or creates an
// empty group there.
export type KeymapEntry =
  | { keys: string[]; label: string; detail?: string; tone?: LeaderTone; command?: LeaderCommand }
  | { keys: string[]; unbind: true };

export interface LeaderOption {
  key: string;
  label: string;
  detail?: string;
  tone?: LeaderTone;
  hasChildren: boolean;
  target?: LeaderTarget;
}

export interface LeaderGroup {
  label: string;
  options: LeaderOption[];
}

// One leaf of the tree, for /leader.
export interface LeaderLeaf {
  keys: string[];
  labels: string[];
  detail?: string;
  tone?: LeaderTone;
  target: LeaderTarget;
  source: string;
}

export interface LeaderDiagnostic {
  source: string;
  bindingId?: string;
  message: string;
}

export interface LeaderRegistration {
  accepted: boolean;
  diagnostics: LeaderDiagnostic[];
}

export const CORE_SOURCE = "core";
export const USER_SOURCE = "user";
const UNKNOWN_SOURCE = "unknown";
const ROOT_LABEL = "leader";
const MAX_PATH = 4;
const MAX_SOURCE = 128;
const MAX_ID = 128;
const MAX_LABEL = 32;
const MAX_DETAIL = 80;
const SAFE_KEY = /^[a-z0-9]$/;
const SAFE_SOURCE = /^[A-Za-z0-9@][A-Za-z0-9@/._:-]*$/;

interface ParsedBinding {
  id: string;
  path: LeaderPath;
  command: LeaderCommand;
}

interface Node {
  key: string;
  label: string;
  detail?: string;
  tone?: LeaderTone;
  // Who created the node (or, for a leaf, who it runs for).
  owner: string;
  // Set on leaves only; a node with a target has no children.
  target?: LeaderTarget;
  children: Map<string, Node>;
}

interface Insert {
  id: string;
  source: string;
  path: readonly LeaderSegment[];
  target: LeaderTarget;
}

// --- parsing -----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const length = (text: string): number => [...text].length;

function diag(source: string, message: string, bindingId?: string): LeaderDiagnostic {
  return bindingId === undefined ? { source, message } : { source, bindingId, message };
}

// The checks contributions and leader.json share. Each returns an error
// message, or undefined when the value is fine.
export function labelError(label: string): string | undefined {
  if (length(label) < 1 || length(label) > MAX_LABEL || hasControlChar(label)) {
    return `must be 1-${MAX_LABEL} characters with no control characters`;
  }
  return undefined;
}

export function detailError(detail: string): string | undefined {
  if (length(detail) > MAX_DETAIL || hasControlChar(detail)) {
    return `must be at most ${MAX_DETAIL} characters with no control characters`;
  }
  return undefined;
}

export function keyError(key: string): string | undefined {
  return SAFE_KEY.test(key) ? undefined : "must be one character from a-z or 0-9";
}

export function commandNameError(name: string): string | undefined {
  if (name === "") return "must not be empty";
  if (name.startsWith("/")) return "must not start with /";
  if (/\s/.test(name)) return "must not contain whitespace";
  if (hasControlChar(name)) return "must not contain control characters";
  return undefined;
}

type Report = (message: string) => void;

// Contributions are code, not hand-typed, so text is checked and kept exactly
// as sent: trimming first would let " c " or "crews\n" through as "c" or "crews".
const surroundError = (text: string): string | undefined => (text !== text.trim() ? "must not have leading or trailing whitespace" : undefined);

function parseText(value: unknown, field: string, check: (text: string) => string | undefined, report: Report): string | undefined {
  if (typeof value !== "string") {
    report(`${field} must be a string`);
    return undefined;
  }
  const error = check(value);
  if (error) {
    report(`${field} ${error}`);
    return undefined;
  }
  return value;
}

function parseSegment(value: unknown, field: string, report: Report): LeaderSegment | undefined {
  if (!isRecord(value)) {
    report(`${field} must be an object`);
    return undefined;
  }
  const key = typeof value.key === "string" ? value.key.toLowerCase() : value.key;
  const parsedKey = parseText(key, `${field}.key`, keyError, report);
  const label = parseText(value.label, `${field}.label`, (t) => labelError(t) ?? surroundError(t), report);
  const detail = value.detail === undefined ? undefined : parseText(value.detail, `${field}.detail`, (t) => detailError(t) ?? surroundError(t), report);
  // An unknown tone is cosmetic, so it's dropped rather than costing the
  // contributor its whole menu (a contributor built against a later contract).
  const tone: LeaderTone | undefined = value.tone === "default" || value.tone === "exit" ? value.tone : undefined;
  if (parsedKey === undefined || label === undefined) return undefined;
  return { key: parsedKey, label, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) };
}

function parseCommand(value: unknown, field: string, report: Report): LeaderCommand | undefined {
  if (!isRecord(value)) {
    report(`${field} must be an object`);
    return undefined;
  }
  const name = parseText(value.name, `${field}.name`, commandNameError, report);
  const args = value.args === undefined ? undefined : parseText(value.args, `${field}.args`, (a) => (hasControlChar(a) ? "must not contain control characters" : undefined), report);
  if (name === undefined) return undefined;
  return args ? { name, args } : { name };
}

function parseBinding(value: unknown, index: number, report: (message: string, id?: string) => void): ParsedBinding | undefined {
  const field = `bindings[${index}]`;
  if (!isRecord(value)) {
    report(`${field} must be an object`);
    return undefined;
  }
  const id = parseText(value.id, `${field}.id`, (t) => (t === "" || length(t) > MAX_ID || hasControlChar(t) ? `must be 1-${MAX_ID} characters with no control characters` : surroundError(t)), report);
  const tagged: Report = (message) => report(message, id);

  let path: LeaderPath | undefined;
  if (!Array.isArray(value.path) || value.path.length < 1 || value.path.length > MAX_PATH) {
    tagged(`${field}.path must have 1-${MAX_PATH} segments`);
  } else {
    const segments = value.path.map((s: unknown, i) => parseSegment(s, `${field}.path[${i}]`, tagged));
    const valid = segments.filter((s): s is LeaderSegment => s !== undefined);
    const [first, ...rest] = valid;
    if (first && valid.length === segments.length) path = [first, ...rest];
  }

  let command: LeaderCommand | undefined;
  if (Object.hasOwn(value, "app")) tagged(`${field} can't use an app target; contributions bind commands only`);
  else if (!Object.hasOwn(value, "command")) tagged(`${field} needs a command`);
  else command = parseCommand(value.command, `${field}.command`, tagged);

  if (id === undefined || path === undefined || command === undefined) return undefined;
  return { id, path, command };
}

type Parsed = { ok: true; source: string; bindings: ParsedBinding[] } | { ok: false; diagnostics: LeaderDiagnostic[] };

// Validates a contribution from the event bus. Any problem rejects it whole.
function parseContribution(value: unknown): Parsed {
  if (!isRecord(value)) return { ok: false, diagnostics: [diag(UNKNOWN_SOURCE, "contribution must be an object")] };
  const { source } = value;
  // JS `$` (without the m flag) only matches at the very end, but the explicit
  // control-character check keeps that from being the only thing between a
  // trailing newline and the tree.
  if (typeof source !== "string" || length(source) > MAX_SOURCE || hasControlChar(source) || !SAFE_SOURCE.test(source)) {
    return { ok: false, diagnostics: [diag(UNKNOWN_SOURCE, `source must match ${SAFE_SOURCE} and be at most ${MAX_SOURCE} characters`)] };
  }
  if (source === USER_SOURCE) return { ok: false, diagnostics: [diag(source, `source "${USER_SOURCE}" is reserved for the leader.json keymap`)] };
  if (!Array.isArray(value.bindings)) return { ok: false, diagnostics: [diag(source, "bindings must be an array")] };

  const diagnostics: LeaderDiagnostic[] = [];
  const report = (message: string, id?: string): void => {
    diagnostics.push(diag(source, message, id));
  };
  const bindings = value.bindings.map((b: unknown, i) => parseBinding(b, i, report));
  const valid = bindings.filter((b): b is ParsedBinding => b !== undefined);
  const seen = new Set<string>();
  for (const { id } of valid) {
    if (seen.has(id)) report(`binding id "${id}" is duplicated`, id);
    seen.add(id);
  }
  if (diagnostics.length > 0 || valid.length !== bindings.length) return { ok: false, diagnostics };
  return { ok: true, source, bindings: valid };
}

// --- the tree ----------------------------------------------------------------

const rootNode = (): Node => ({ key: "", label: ROOT_LABEL, owner: CORE_SOURCE, children: new Map() });

function segmentNode(segment: LeaderSegment, owner: string, target?: LeaderTarget): Node {
  return {
    key: segment.key,
    label: segment.label,
    ...(segment.detail ? { detail: segment.detail } : {}),
    ...(segment.tone ? { tone: segment.tone } : {}),
    owner,
    ...(target ? { target } : {}),
    children: new Map(),
  };
}

const keysOf = (path: readonly { key: string }[]): string => path.map((s) => s.key).join(" ");

function leafCount(node: Node): number {
  if (node.target) return 1;
  let total = 0;
  for (const child of node.children.values()) total += leafCount(child);
  return total;
}

// Empty groups (left by an unbind, or made by a label-only keymap entry) aren't shown.
const visible = (node: Node): boolean => node.target !== undefined || [...node.children.values()].some(visible);

const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const cloneTarget = (target: LeaderTarget): LeaderTarget => ("app" in target ? { app: target.app } : { command: { ...target.command } });

// Inserts one binding; the newcomer always wins. Returns what it displaced.
function insertBinding(root: Node, binding: Insert): LeaderDiagnostic[] {
  const diagnostics: LeaderDiagnostic[] = [];
  const report = (message: string): void => {
    diagnostics.push(diag(binding.source, message, binding.id));
  };
  let current = root;
  for (const [index, segment] of binding.path.entries()) {
    const isLeaf = index === binding.path.length - 1;
    const keys = keysOf(binding.path.slice(0, index + 1));
    const existing = current.children.get(segment.key);
    if (isLeaf) {
      if (existing) {
        const displaced = leafCount(existing);
        if (displaced > 0) report(`${keys} taken over from ${existing.owner}${displaced > 1 ? `, displacing ${displaced} bindings` : ""}`);
      }
      current.children.set(segment.key, segmentNode(segment, binding.source, binding.target));
      return diagnostics;
    }
    if (existing && !existing.target) {
      // Shared group: the first label stays. Detail is a subtitle, not
      // identity, so it isn't compared; a group without one adopts the first offered.
      if (existing.label !== segment.label) {
        report(`${keys} keeps the label "${existing.label}" from ${existing.owner}, not "${segment.label}"`);
      }
      if (!existing.detail && segment.detail) existing.detail = segment.detail;
      current = existing;
      continue;
    }
    if (existing) report(`${keys} taken over from ${existing.owner} to open a group`);
    const group = segmentNode(segment, binding.source);
    current.children.set(segment.key, group);
    current = group;
  }
  return diagnostics;
}

// Applies one keymap entry. A bind always wins, so only a no-op unbind and a
// label-only entry that would have to destroy a leaf are reported.
function applyKeymap(root: Node, entry: KeymapEntry): LeaderDiagnostic[] {
  const keys = entry.keys.join(" ");
  const last = entry.keys.at(-1);
  if (last === undefined) return [diag(USER_SOURCE, "keymap entry has no keys")];

  if ("unbind" in entry) {
    let parent: Node | undefined = root;
    for (const key of entry.keys.slice(0, -1)) {
      parent = parent.children.get(key);
      if (!parent || parent.target) break;
    }
    if (!parent || parent.target || !parent.children.delete(last)) {
      return [diag(USER_SOURCE, `${keys} isn't bound, so there's nothing to unbind`)];
    }
    return [];
  }

  // A label only names things; it must never cost a command. Checked before
  // anything is created so a skipped entry leaves no stray groups.
  if (!entry.command) {
    let probe: Node | undefined = root;
    for (const [index, key] of entry.keys.slice(0, -1).entries()) {
      probe = probe.children.get(key);
      if (!probe) break;
      if (probe.target) {
        return [diag(USER_SOURCE, `${keys} skipped: ${entry.keys.slice(0, index + 1).join(" ")} is a binding, and a label-only entry can't replace it`)];
      }
    }
  }

  let current = root;
  for (const key of entry.keys.slice(0, -1)) {
    const existing = current.children.get(key);
    if (existing && !existing.target) {
      current = existing;
      continue;
    }
    // Labelled with its key until a keymap entry labels it.
    const group: Node = { key, label: key, owner: USER_SOURCE, children: new Map() };
    current.children.set(key, group);
    current = group;
  }

  const existing = current.children.get(last);
  if (entry.command) {
    const segment: LeaderSegment = { key: last, label: entry.label, ...(entry.detail ? { detail: entry.detail } : {}), ...(entry.tone ? { tone: entry.tone } : {}) };
    current.children.set(last, segmentNode(segment, USER_SOURCE, { command: { ...entry.command } }));
  } else if (existing) {
    existing.label = entry.label;
    if (entry.detail) existing.detail = entry.detail;
    if (entry.tone) existing.tone = entry.tone;
  } else {
    const segment: LeaderSegment = { key: last, label: entry.label, ...(entry.detail ? { detail: entry.detail } : {}), ...(entry.tone ? { tone: entry.tone } : {}) };
    current.children.set(last, segmentNode(segment, USER_SOURCE));
  }
  return [];
}

function collectLeaves(node: Node, keys: string[], labels: string[], out: LeaderLeaf[]): void {
  for (const child of [...node.children.values()].sort(byKey)) {
    const childKeys = [...keys, child.key];
    const childLabels = [...labels, child.label];
    if (child.target) {
      out.push({
        keys: childKeys,
        labels: childLabels,
        ...(child.detail ? { detail: child.detail } : {}),
        ...(child.tone ? { tone: child.tone } : {}),
        target: cloneTarget(child.target),
        source: child.owner,
      });
    } else {
      collectLeaves(child, childKeys, childLabels, out);
    }
  }
}

export class LeaderRegistry {
  private readonly core: readonly CoreBinding[];
  // Map order is registration order; re-registering deletes first, so it moves to the back.
  private readonly contributions = new Map<string, ParsedBinding[]>();
  private keymap: KeymapEntry[] = [];
  private root: Node = rootNode();
  private latest: LeaderDiagnostic[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(core: CoreBinding[] = []) {
    this.core = core.map((b) => ({ ...b }));
    this.rebuild();
  }

  register(value: unknown): LeaderRegistration {
    const parsed = parseContribution(value);
    if (!parsed.ok) return { accepted: false, diagnostics: parsed.diagnostics };
    this.contributions.delete(parsed.source);
    if (parsed.bindings.length > 0) this.contributions.set(parsed.source, parsed.bindings);
    this.rebuild();
    return { accepted: true, diagnostics: this.latest.filter((d) => d.source === parsed.source).map((d) => ({ ...d })) };
  }

  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries.map((e) => ({ ...e }));
    this.rebuild();
  }

  // The visible options under path, sorted by key, or undefined if path isn't a (non-empty) group.
  group(path: string[]): LeaderGroup | undefined {
    let current = this.root;
    for (const key of path) {
      const next = current.children.get(key);
      if (!next || next.target || !visible(next)) return undefined;
      current = next;
    }
    const options = [...current.children.values()]
      .filter(visible)
      .sort(byKey)
      .map((node): LeaderOption => ({
        key: node.key,
        label: node.label,
        ...(node.detail ? { detail: node.detail } : {}),
        ...(node.tone ? { tone: node.tone } : {}),
        hasChildren: node.target === undefined,
        ...(node.target ? { target: cloneTarget(node.target) } : {}),
      }));
    return { label: current.label, options };
  }

  bindings(): LeaderLeaf[] {
    const out: LeaderLeaf[] = [];
    collectLeaves(this.root, [], [], out);
    return out;
  }

  diagnostics(): LeaderDiagnostic[] {
    return this.latest.map((d) => ({ ...d }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private rebuild(): void {
    const root = rootNode();
    for (const binding of this.core) {
      // Core lands in an empty tree, so any report here is two core bindings
      // disagreeing: a bug in vi-mode, not something to live with.
      const [issue] = insertBinding(root, { id: binding.id, source: CORE_SOURCE, path: binding.path, target: binding.target });
      if (issue) throw new Error(`leader core binding ${binding.id}: ${issue.message}`);
    }
    const diagnostics: LeaderDiagnostic[] = [];
    for (const [source, bindings] of this.contributions) {
      for (const binding of [...bindings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        diagnostics.push(...insertBinding(root, { id: binding.id, source, path: binding.path, target: { command: binding.command } }));
      }
    }
    for (const entry of this.keymap) diagnostics.push(...applyKeymap(root, entry));
    this.root = root;
    this.latest = diagnostics;
    for (const listener of this.listeners) listener();
  }
}
