import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

// A worker's conversation for the panel's Live tab: prompt, thinking, text, and tool calls with
// their results. Built either from the worker's JSON event stream (live, token by token) or
// from its pi session file (finished tasks, or crews running in another session). Bounded, so a
// long worker can't grow the planner's memory without limit; the session file keeps everything.

export type ToolState = "pending" | "running" | "ok" | "error";

export interface TextEntry { kind: "user" | "thinking" | "text" | "note"; text: string }
export interface ToolEntry { kind: "tool"; id: string; name: string; args: string; result: string; state: ToolState }
export type Entry = TextEntry | ToolEntry;
/** A thinking or text block of an assistant message. */
type BlockEntry = TextEntry & { kind: "thinking" | "text" };

/** Untyped JSON from the event stream or session file. */
type Raw = Record<string, any>;

export const LIMITS = { entries: 400, chars: 400_000, text: 12_000, user: 4_000, args: 1_000, result: 4_000 };

const size = (e: Entry) => (e.kind === "tool" ? e.name.length + e.args.length + e.result.length : e.text.length);
const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-(max - 1))}` : text);
const head = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** `value` as an object to index into; anything else reads as empty. */
const record = (value: unknown): Raw => (typeof value === "object" && value !== null ? value : {});

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const p = record(part);
    return p.type === "text" && typeof p.text === "string" ? p.text : p.type === "image" ? "[image]" : "";
  }).filter(Boolean).join("\n");
}

/** One line for a tool call: the command, path, or pattern when there is one, else compact JSON. */
export function toolArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args !== "object") return head(String(args), LIMITS.args);
  const a = args as Record<string, unknown>;
  const main = [a.command, a.path, a.pattern, a.query, a.url].find((v) => typeof v === "string") as string | undefined;
  return head(main ?? JSON.stringify(a), LIMITS.args);
}

const isBlock = (entry: Entry | undefined, kind: BlockEntry["kind"]): entry is BlockEntry => entry?.kind === kind;

const thinkingText = (block: Raw) => (block.redacted && !block.thinking ? "(redacted thinking)" : String(block.thinking ?? ""));

export class Transcript {
  readonly entries: Entry[] = [];
  /** Entries evicted to stay within LIMITS. */
  dropped = 0;
  /** Bumped on every change. */
  version = 0;
  private chars = 0;
  /** Blocks of the assistant message in progress, by contentIndex. */
  private blocks = new Map<number, Entry>();
  private readonly tools = new Map<string, ToolEntry>();
  private readonly evicted = new WeakSet<Entry>();

  private push<E extends Entry>(entry: E): E {
    this.capEntry(entry);
    this.entries.push(entry);
    this.chars += size(entry);
    if (entry.kind === "tool" && entry.id) this.tools.set(entry.id, entry);
    this.evict();
    this.version++;
    return entry;
  }

  /** Mutate an entry, keeping the char count right. Evicted entries are left alone. */
  private update<E extends Entry>(entry: E, change: (e: E) => void) {
    if (this.evicted.has(entry)) return;
    const before = size(entry);
    change(entry);
    this.capEntry(entry);
    this.chars += size(entry) - before;
    this.evict();
    this.version++;
  }

  private capEntry(e: Entry) {
    if (e.kind === "tool") { e.args = head(e.args, LIMITS.args); e.result = tail(e.result, LIMITS.result); }
    else e.text = e.kind === "user" ? head(e.text, LIMITS.user) : tail(e.text, LIMITS.text);
  }

  private evict() {
    // Keep at least the newest entry, however large; it is capped on its own.
    while (this.entries.length > 1 && (this.entries.length > LIMITS.entries || this.chars > LIMITS.chars)) {
      const gone = this.entries.shift()!;
      this.chars -= size(gone);
      this.evicted.add(gone);
      this.dropped++;
      if (gone.kind === "tool") this.tools.delete(gone.id);
      for (const [i, e] of this.blocks) if (e === gone) this.blocks.delete(i);
    }
  }

  private tool(id: string, name: string): ToolEntry {
    return this.tools.get(id) ?? this.push({ kind: "tool", id, name, args: "", result: "", state: "pending" });
  }

  private block(index: number, kind: BlockEntry["kind"]): BlockEntry {
    const found = this.blocks.get(index);
    if (isBlock(found, kind)) return found;
    const entry = this.push({ kind, text: "" });
    this.blocks.set(index, entry);
    return entry;
  }

  private assistantBlocks(content: unknown, reconcile: boolean) {
    if (!Array.isArray(content)) return;
    content.forEach((part, i) => {
      const b = record(part);
      if (b.type === "thinking" || b.type === "text") {
        const text = b.type === "thinking" ? thinkingText(b) : String(b.text ?? "");
        // A finished message's empty block adds nothing; a streamed one is replaced in place.
        if (!text && !this.blocks.has(i)) return;
        const entry = reconcile ? this.block(i, b.type) : this.push({ kind: b.type, text: "" });
        this.update(entry, (e) => { e.text = text; });
      } else if (b.type === "toolCall") {
        const entry = this.tool(String(b.id ?? ""), String(b.name ?? "tool"));
        this.update(entry, (e) => { e.args = toolArgs(b.arguments); });
      }
    });
  }

  /** One streamed delta of the assistant message in progress. */
  private applyUpdate(u: Raw) {
    const i = typeof u.contentIndex === "number" ? u.contentIndex : -1;
    switch (u.type) {
      case "thinking_start": this.block(i, "thinking"); return;
      case "text_start": this.block(i, "text"); return;
      case "thinking_delta":
      case "text_delta":
        if (typeof u.delta === "string") this.update(this.block(i, u.type === "thinking_delta" ? "thinking" : "text"), (e) => { e.text += u.delta; });
        return;
      case "thinking_end":
      case "text_end":
        if (typeof u.content === "string") this.update(this.block(i, u.type === "thinking_end" ? "thinking" : "text"), (e) => { e.text = u.content; });
        return;
      case "toolcall_start":
        this.blocks.set(i, this.tool(String(u.id ?? ""), String(u.toolName ?? "tool")));
        return;
      case "toolcall_end": {
        if (!u.toolCall) return;
        const entry = this.tool(String(u.toolCall.id ?? ""), String(u.toolCall.name ?? "tool"));
        this.update(entry, (e) => { e.args = toolArgs(u.toolCall.arguments); });
        return;
      }
    }
  }

  /** Apply one event from `pi --mode json`. */
  applyEvent(event: Raw) {
    switch (event.type) {
      case "message_start":
        if (event.message?.role === "user") this.push({ kind: "user", text: contentText(event.message.content) });
        else if (event.message?.role === "assistant") this.blocks = new Map();
        return;
      case "message_update":
        this.applyUpdate(record(event.assistantMessageEvent));
        return;
      case "message_end":
        if (event.message?.role !== "assistant") return;
        // The final message is authoritative: it replaces what the deltas built.
        this.assistantBlocks(event.message.content, true);
        if (event.message.errorMessage) this.push({ kind: "note", text: `error: ${event.message.errorMessage}` });
        this.blocks = new Map();
        return;
      case "tool_execution_start": {
        const entry = this.tool(String(event.toolCallId ?? ""), String(event.toolName ?? "tool"));
        this.update(entry, (e) => { if (!e.args) e.args = toolArgs(event.args); e.state = "running"; });
        return;
      }
      case "tool_execution_update": {
        const entry = this.tools.get(String(event.toolCallId ?? ""));
        if (entry) this.update(entry, (e) => { e.result = contentText(event.partialResult?.content); });
        return;
      }
      case "tool_execution_end": {
        const entry = this.tool(String(event.toolCallId ?? ""), String(event.toolName ?? "tool"));
        this.update(entry, (e) => { e.result = contentText(event.result?.content); e.state = event.isError ? "error" : "ok"; });
        return;
      }
      case "compaction_start":
        this.push({ kind: "note", text: "compacting context" });
        return;
    }
  }

  /** Apply one record of a pi session file. */
  applySessionEntry(entry: Raw) {
    if (entry.type === "compaction") { this.push({ kind: "note", text: "context compacted" }); return; }
    if (entry.type !== "message") return;
    const m = entry.message ?? {};
    if (m.role === "user") this.push({ kind: "user", text: contentText(m.content) });
    else if (m.role === "assistant") {
      this.blocks = new Map();
      this.assistantBlocks(m.content, false);
      if (m.errorMessage) this.push({ kind: "note", text: `error: ${m.errorMessage}` });
    } else if (m.role === "toolResult") {
      const t = this.tool(String(m.toolCallId ?? ""), String(m.toolName ?? "tool"));
      this.update(t, (e) => { e.result = contentText(m.content); e.state = m.isError ? "error" : "ok"; });
    }
  }
}

// ── Session files ────────────────────────────────────────────────────────

/** Largest single record kept while reading; a longer one is skipped, not buffered without end. */
const MAX_LINE = 8 * 1024 * 1024;
const CHUNK = 1024 * 1024;

export interface SessionFs {
  /** Size and identity of the file, or undefined when it doesn't exist. */
  stat(path: string): Promise<{ size: number; ino: number } | undefined>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
}

export const nodeSessionFs: SessionFs = {
  async stat(path) {
    try {
      const s = await stat(path);
      return { size: s.size, ino: s.ino };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async read(path, offset, length) {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  },
};

/** Follows a session file as it grows, reading only what's new. */
export class SessionTail {
  transcript = new Transcript();
  exists = false;
  private offset = 0;
  private ino = -1;
  private pending = "";
  private skipping = false;
  // Chunks are cut by byte count, which can split a UTF-8 character; the decoder carries it over.
  private decoder = new StringDecoder("utf8");

  private readonly path: string;
  private readonly fs: SessionFs;

  constructor(path: string, fs: SessionFs = nodeSessionFs) {
    this.path = path;
    this.fs = fs;
  }

  /** Read what was appended since the last poll. Returns whether anything changed. */
  async poll(): Promise<boolean> {
    const info = await this.fs.stat(this.path);
    if (!info) { this.exists = false; return false; }
    this.exists = true;
    // Replaced or truncated: start over.
    if (info.ino !== this.ino || info.size < this.offset) this.restart(info.ino);
    const before = this.transcript.version;
    while (this.offset < info.size) {
      const bytes = await this.fs.read(this.path, this.offset, Math.min(CHUNK, info.size - this.offset));
      if (!bytes.length) break;
      this.offset += bytes.length;
      this.consume(this.decoder.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)));
    }
    return this.transcript.version !== before;
  }

  private restart(ino: number) {
    this.transcript = new Transcript();
    this.offset = 0;
    this.pending = "";
    this.skipping = false;
    this.decoder = new StringDecoder("utf8");
    this.ino = ino;
  }

  private consume(text: string) {
    let data = this.pending + text;
    let nl: number;
    while ((nl = data.indexOf("\n")) !== -1) {
      const line = data.slice(0, nl);
      data = data.slice(nl + 1);
      if (this.skipping) { this.skipping = false; continue; }
      if (!line.trim()) continue;
      try {
        this.transcript.applySessionEntry(JSON.parse(line));
      } catch {
        // A malformed record must not hide the rest of the transcript.
      }
    }
    // The last record may still be being written; keep it for the next poll.
    if (data.length > MAX_LINE) { data = ""; this.skipping = true; }
    this.pending = data;
  }
}

export type TranscriptView =
  | { state: "loading" }
  | { state: "unavailable"; message: string }
  | { state: "ready"; transcript: Transcript; source: "live" | "file" };

/** Session tails for the panel, polled at most every `recheckMs` and only for what's on screen. */
export class SessionCache {
  private entries = new Map<string, { tail: SessionTail; checkedAt: number; busy: boolean; loaded: boolean; error?: string }>();

  private readonly fs: SessionFs;
  private readonly recheckMs: number;

  constructor(fs: SessionFs = nodeSessionFs, recheckMs = 2_000) {
    this.fs = fs;
    this.recheckMs = recheckMs;
  }

  get(path: string, onChange: () => void, now = Date.now()): TranscriptView {
    let entry = this.entries.get(path);
    if (!entry) {
      entry = { tail: new SessionTail(path, this.fs), checkedAt: -Infinity, busy: false, loaded: false };
      this.entries.set(path, entry);
    }
    if (!entry.busy && now - entry.checkedAt >= this.recheckMs) {
      entry.busy = true;
      entry.checkedAt = now;
      const e = entry;
      e.tail.poll()
        .then((changed) => { e.error = undefined; if (changed || !e.loaded) { e.loaded = true; onChange(); } })
        .catch((error: unknown) => { e.loaded = true; e.error = (error as Error).message; onChange(); })
        .finally(() => { e.busy = false; });
    }
    if (!entry.loaded) return { state: "loading" };
    if (entry.error) return { state: "unavailable", message: `Could not read the session file: ${entry.error}` };
    if (!entry.tail.exists) return { state: "unavailable", message: "No session file yet: the worker hasn't finished its first message." };
    return { state: "ready", transcript: entry.tail.transcript, source: "file" };
  }
}
