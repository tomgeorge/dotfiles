// Scheduling core for watches, free of Pi imports so it can be tested directly.
// A command watch runs a shell check locally and only reports when its condition
// holds, so waiting costs no model tokens. A prompt watch (a loop) reports on
// every interval; the caller decides when the model is free to take it.

export type Kind = "command" | "prompt";
/** `success`: exit 0 ends the watch. `change`: report each change to stdout or exit code. */
export type Until = "success" | "change";
/** How a report reaches the model; see README. Prompt loops always wait for idle. */
export type Deliver = "wake" | "steer" | "notify";
export type EndReason = "met" | "timeout" | "stopped" | "error";

export const UNTIL: readonly Until[] = ["success", "change"];
export const DELIVER: readonly Deliver[] = ["wake", "steer", "notify"];

export const LIMITS = {
  maxActive: 20,
  command: { minInterval: 5_000, interval: 30_000, timeout: 3_600_000 },
  prompt: { minInterval: 60_000, interval: 600_000, timeout: 14_400_000 },
  maxTimeout: 86_400_000,
};

export interface WatchSpec {
  kind: Kind;
  /** Shell command or prompt. */
  text: string;
  description: string;
  cwd: string;
  intervalMs: number;
  timeoutMs: number;
  until: Until;
  deliver: Deliver;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  killed: boolean;
}

export type Runner = (command: string, cwd: string, signal: AbortSignal, timeoutMs: number) => Promise<RunResult>;

export interface Watch extends WatchSpec {
  id: number;
  startedAt: number;
  deadline: number;
  checks: number;
  fires: number;
  state: "waiting" | "running" | "due" | "ended";
  nextAt?: number;
  last?: RunResult;
  /** The check before `last`, so a change report can say what it changed from. */
  previous?: RunResult;
}

export interface Events {
  /** Command: condition met or output changed. Prompt: an iteration is due; call `rearm` once delivered. */
  onFire(watch: Watch, result: RunResult | undefined): void;
  onEnd(watch: Watch, reason: EndReason, detail?: string): void;
  onUpdate(watch: Watch): void;
}

interface Entry {
  watch: Watch;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  baseline?: string;
  first: Promise<RunResult | undefined>;
  resolveFirst: (result: RunResult | undefined) => void;
}

export class Registry {
  private entries = new Map<number, Entry>();
  private run: Runner;
  private events: Events;
  private now: () => number;

  // No parameter properties: Node's type stripping (used by the tests) rejects them.
  constructor(run: Runner, events: Events, now: () => number = Date.now) {
    this.run = run;
    this.events = events;
    this.now = now;
  }

  start(spec: WatchSpec): Watch {
    if (this.entries.size >= LIMITS.maxActive) {
      throw new Error(`${this.entries.size} watches already active (limit ${LIMITS.maxActive}). Stop one first.`);
    }
    const startedAt = this.now();
    // Ids number the active watches (lowest free first), so they stay small.
    let id = 1;
    while (this.entries.has(id)) id++;
    const watch: Watch = {
      ...spec, id, startedAt, deadline: startedAt + spec.timeoutMs,
      checks: 0, fires: 0, state: "waiting",
    };
    let resolveFirst!: Entry["resolveFirst"];
    const first = new Promise<RunResult | undefined>((resolve) => { resolveFirst = resolve; });
    const entry: Entry = { watch, controller: new AbortController(), first, resolveFirst };
    this.entries.set(watch.id, entry);
    // Commands check right away so an already-met condition reports at once;
    // a loop's first iteration waits one interval, as with /loop.
    if (spec.kind === "command") void this.check(entry);
    else this.schedule(entry);
    return watch;
  }

  get(id: number): Watch | undefined {
    return this.entries.get(id)?.watch;
  }

  /**
   * The first check's result, so a broken command (auth error, typo) shows up at
   * once instead of only at the timeout. `undefined` for loops, or if the watch
   * ended before a check finished.
   */
  firstCheck(id: number): Promise<RunResult | undefined> {
    return this.entries.get(id)?.first ?? Promise.resolve(undefined);
  }

  list(): Watch[] {
    return [...this.entries.values()].map((e) => e.watch);
  }

  stop(id: number, reason: EndReason = "stopped", detail?: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.end(entry, reason, detail);
    return true;
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }

  /** Schedule a loop's next iteration after the caller delivered the due one. */
  rearm(id: number): void {
    const entry = this.entries.get(id);
    if (entry?.watch.state === "due") this.schedule(entry);
  }

  private schedule(entry: Entry) {
    const { watch } = entry;
    const remaining = watch.deadline - this.now();
    if (remaining <= 0) return this.end(entry, "timeout");
    const delay = Math.min(watch.intervalMs, remaining);
    watch.state = "waiting";
    watch.nextAt = this.now() + delay;
    entry.timer = setTimeout(() => this.tick(entry), delay);
    this.events.onUpdate(watch);
  }

  private tick(entry: Entry) {
    const { watch } = entry;
    if (watch.state === "ended") return;
    if (this.now() >= watch.deadline) return this.end(entry, "timeout");
    if (watch.kind === "command") return void this.check(entry);
    watch.state = "due";
    watch.nextAt = undefined;
    watch.fires++;
    this.events.onUpdate(watch);
    this.events.onFire(watch, undefined);
  }

  private async check(entry: Entry) {
    const { watch } = entry;
    // A function, so TypeScript doesn't keep "running" narrowed across the await.
    const ended = () => watch.state === "ended";
    watch.state = "running";
    watch.nextAt = undefined;
    watch.checks++;
    this.events.onUpdate(watch);
    let result: RunResult;
    try {
      const budget = Math.max(1_000, watch.deadline - this.now());
      result = await this.run(watch.text, watch.cwd, entry.controller.signal, budget);
    } catch (error) {
      if (!ended()) this.end(entry, "error", error instanceof Error ? error.message : String(error));
      return;
    }
    if (ended()) return;
    watch.previous = watch.last;
    watch.last = result;
    entry.resolveFirst(result);
    // Retrying a missing or non-executable command can never succeed.
    if (result.code === 126 || result.code === 127) {
      return this.end(entry, "error", `exit ${result.code}: ${result.stderr.trim() || "command not found or not executable"}`);
    }
    if (watch.until === "success") {
      if (result.code === 0 && !result.killed) {
        watch.fires++;
        this.events.onFire(watch, result);
        return this.end(entry, "met");
      }
    } else if (!result.killed) {
      const signature = `${result.code}\n${result.stdout.trim()}`;
      if (entry.baseline === undefined) entry.baseline = signature;
      else if (signature !== entry.baseline) {
        entry.baseline = signature;
        watch.fires++;
        this.events.onFire(watch, result);
      }
    }
    this.schedule(entry);
  }

  private end(entry: Entry, reason: EndReason, detail?: string) {
    const { watch } = entry;
    if (watch.state === "ended") return;
    watch.state = "ended";
    watch.nextAt = undefined;
    if (entry.timer) clearTimeout(entry.timer);
    entry.controller.abort();
    this.entries.delete(watch.id);
    entry.resolveFirst(watch.last);
    this.events.onEnd(watch, reason, detail);
  }
}

/** `30s`, `5m`, `2h`, `1d`; a bare number is seconds. */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid duration: ${value}`);
    return Math.round(value * 1000);
  }
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration "${value}"; use e.g. 30s, 5m, 2h`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(match[2] ?? "s").toLowerCase() as "s"];
  const ms = Math.round(Number(match[1]) * unit);
  if (ms <= 0) throw new Error(`Invalid duration "${value}"`);
  return ms;
}

export interface WatchInput {
  command?: string;
  prompt?: string;
  description?: string;
  interval?: string | number;
  timeout?: string | number;
  until?: Until;
  deliver?: Deliver;
}

export function buildSpec(input: WatchInput, cwd: string): WatchSpec {
  const command = input.command?.trim();
  const prompt = input.prompt?.trim();
  if (!command === !prompt) throw new Error("Give exactly one of command or prompt");
  const kind: Kind = command ? "command" : "prompt";
  if (kind === "prompt" && (input.until || input.deliver)) {
    throw new Error("until and deliver apply only to command watches; loops always run when the agent is idle");
  }
  const limits = LIMITS[kind];
  const intervalMs = input.interval === undefined ? limits.interval : parseDuration(input.interval);
  if (intervalMs < limits.minInterval) {
    throw new Error(`Interval must be at least ${formatDuration(limits.minInterval)} for ${kind} watches`);
  }
  const timeoutMs = input.timeout === undefined ? limits.timeout : parseDuration(input.timeout);
  if (timeoutMs > LIMITS.maxTimeout) throw new Error(`Timeout must be at most ${formatDuration(LIMITS.maxTimeout)}`);
  const text = (command ?? prompt)!;
  return {
    kind, text, cwd, intervalMs, timeoutMs,
    description: input.description?.trim() || oneLine(text, 60),
    until: input.until ?? "success",
    deliver: input.deliver ?? "wake",
  };
}

/**
 * Parse `/watch` and `/loop` arguments: leading options, then the command or prompt.
 * Options: an interval like `30s`, `--timeout DUR`, and for `/watch` also
 * `--change`, `--wake`, `--steer`, `--notify`. `--` ends options.
 */
export function parseArgs(args: string, kind: Kind): WatchInput {
  const input: WatchInput = {};
  let rest = args.trim();
  for (;;) {
    const match = rest.match(/^(\S+)\s*([\s\S]*)$/);
    if (!match) break;
    const [, token, after] = match;
    if (token === "--") { rest = after; break; }
    if (/^\d+(?:\.\d+)?[smhd]$/i.test(token) && input.interval === undefined) {
      input.interval = token;
    } else if (token.startsWith("--timeout")) {
      const inline = token.match(/^--timeout=(.+)$/);
      if (inline) input.timeout = inline[1];
      else if (token === "--timeout") {
        const value = after.match(/^(\S+)\s*([\s\S]*)$/);
        if (!value) throw new Error("--timeout needs a duration");
        input.timeout = value[1];
        rest = value[2];
        continue;
      } else break;
    } else if (kind === "command" && token === "--change") {
      input.until = "change";
    } else if (kind === "command" && ["--wake", "--steer", "--notify"].includes(token)) {
      input.deliver = token.slice(2) as Deliver;
    } else break;
    rest = after;
  }
  if (!rest) throw new Error(kind === "command" ? "Usage: /watch [30s] [--change] [--wake|--steer|--notify] [--timeout 1h] <shell command>" : "Usage: /loop [10m] [--timeout 4h] <prompt>");
  if (kind === "command") input.command = rest;
  else input.prompt = rest;
  return input;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
}

/** The end of the output, where status and errors usually are. */
export function tail(text: string, maxLines = 40, maxChars = 4_000): string {
  let lines = text.trimEnd().split("\n");
  const cut = lines.length > maxLines;
  if (cut) lines = lines.slice(-maxLines);
  let out = lines.join("\n");
  const chars = out.length > maxChars;
  if (chars) out = out.slice(-maxChars);
  return cut || chars ? `[...earlier output omitted]\n${out}` : out;
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
