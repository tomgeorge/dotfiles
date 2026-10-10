import { execFile } from "node:child_process";

// Same binary pi/mcp.json runs, so the tools and the MCP servers share one login.
export const HEY_BIN = "/etc/profiles/per-user/tgeorge/bin/hey";
export const MAX_IDS = 100;

// Box kinds, not names: kinds are stable and `hey move --to` accepts them.
// Imbox is allowed so a wrong move can be undone.
export const BOXES = { feed: "feedbox", trail: "trailbox", aside: "asidebox", imbox: "imbox" } as const;
export type Box = keyof typeof BOXES;

// `hey bubble up` takes exactly one of these; "on" also needs a date.
export const BUBBLE_WHEN = ["now", "tomorrow", "weekend", "next-week", "on"] as const;
export type BubbleWhen = (typeof BUBBLE_WHEN)[number];

export type Op =
  | { kind: "move"; postingIds: number[]; to: Box }
  | { kind: "label"; postingIds: number[]; labelId: number }
  | { kind: "collection"; threadIds: number[]; collectionId: number }
  | { kind: "seen"; postingIds: number[] }
  | { kind: "bubble"; postingIds: number[]; when: BubbleWhen; on?: string }
  | { kind: "bubble-pop"; postingIds: number[] }
  | { kind: "list-labels" }
  | { kind: "list-collections" };

function checkId(id: number, what: string): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${what} must be a positive integer, got ${id}`);
  return String(id);
}

function checkDate(date: string | undefined): string {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : undefined;
  // Round-tripping rejects dates like 2026-02-30 that Date would roll over.
  if (!parsed || parsed.toISOString().slice(0, 10) !== date) throw new Error(`on must be a YYYY-MM-DD date, got ${date}`);
  return date;
}

function checkIds(ids: number[], what: string): string[] {
  if (ids.length === 0) throw new Error(`Give at least one ${what}`);
  if (ids.length > MAX_IDS) throw new Error(`At most ${MAX_IDS} ${what}s per call, got ${ids.length}`);
  return [...new Set(ids)].map((id) => checkId(id, what));
}

/** The hey argv for an op. Every op maps to one fixed subcommand; nothing else is reachable. */
export function buildArgs(op: Op): string[] {
  switch (op.kind) {
    case "move":
      if (!(op.to in BOXES)) throw new Error(`Unknown box ${op.to}`);
      return ["move", ...checkIds(op.postingIds, "posting ID"), "--to", BOXES[op.to], "--json"];
    case "label":
      return ["label", "add", ...checkIds(op.postingIds, "posting ID"), "--to", checkId(op.labelId, "labelId"), "--json"];
    case "collection":
      return ["collection", "add", ...checkIds(op.threadIds, "thread ID"), "--to", checkId(op.collectionId, "collectionId"), "--json"];
    case "seen":
      return ["seen", ...checkIds(op.postingIds, "posting ID"), "--json"];
    case "bubble": {
      const ids = checkIds(op.postingIds, "posting ID");
      if (!BUBBLE_WHEN.includes(op.when)) throw new Error(`Unknown bubble time ${op.when}`);
      if (op.when !== "on" && op.on !== undefined) throw new Error(`on is only allowed with when=on`);
      const when = op.when === "on" ? ["--on", checkDate(op.on)] : [`--${op.when}`];
      return ["bubble", "up", ...ids, ...when, "--json"];
    }
    case "bubble-pop":
      return ["bubble", "pop", ...checkIds(op.postingIds, "posting ID"), "--json"];
    case "list-labels":
      return ["label", "list", "--all", "--json"];
    case "list-collections":
      return ["collection", "list", "--all", "--json"];
  }
}

type Envelope = { ok?: boolean; data?: unknown; error?: string; hint?: string };

function envelope(text: string): Envelope | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parse hey's `--json` envelope; throw with hey's error and hint when it reports failure. */
export function parseResult(stdout: string, stderr: string, exitCode: number): unknown {
  // hey prints success to stdout and its error envelope to stderr.
  const body = envelope(stdout) ?? envelope(stderr);
  if (body?.ok === true && exitCode === 0) return body.data ?? null;
  const reason = body?.error ?? (stderr.trim() || stdout.trim() || "no output");
  throw new Error(`hey failed (exit code ${exitCode}): ${reason}${body?.hint ? ` (${body.hint})` : ""}`);
}

export function runHey(args: string[], signal?: AbortSignal, bin = HEY_BIN): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { signal, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, HEY_NONINTERACTIVE: "1" } },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        try {
          resolve(parseResult(stdout, stderr, error ? (error.code as number) : 0));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

/** One line for the confirmation prompt. */
export function summarize(op: Op): string {
  switch (op.kind) {
    case "move":
      return `Move ${op.postingIds.length} email(s) to ${op.to}: ${op.postingIds.join(", ")}`;
    case "label":
      return `Add label ${op.labelId} to ${op.postingIds.length} email(s): ${op.postingIds.join(", ")}`;
    case "collection":
      return `Add ${op.threadIds.length} thread(s) to collection ${op.collectionId}: ${op.threadIds.join(", ")}`;
    case "seen":
      return `Mark ${op.postingIds.length} email(s) seen: ${op.postingIds.join(", ")}`;
    case "bubble":
      return `Bubble up ${op.postingIds.length} email(s) ${op.when === "on" ? `on ${op.on}` : op.when}: ${op.postingIds.join(", ")}`;
    case "bubble-pop":
      return `Cancel bubble-up on ${op.postingIds.length} email(s): ${op.postingIds.join(", ")}`;
    default:
      return op.kind;
  }
}
