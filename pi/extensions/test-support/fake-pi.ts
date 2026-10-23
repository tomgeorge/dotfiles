// A stand-in for Pi's ExtensionAPI, so an extension's event wiring can be unit-tested.
// No index.ts here, so Pi doesn't load this directory as an extension.
import { registerHooks } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi's packages only resolve inside Pi, so each is replaced by a module of plain stand-ins for
// the runtime values extensions import. Tool schemas and rendering don't matter to these tests.
const STUBS: Record<string, string> = {
  "typebox": `
    const any = new Proxy(function () {}, { get: () => any, apply: () => ({}) });
    export const Type = any;
  `,
  "@earendil-works/pi-ai": `
    export const StringEnum = () => ({});
    export const uuidv7 = () => crypto.randomUUID();
  `,
  // Plain text: one column per code point, keys matched by their raw text.
  "@earendil-works/pi-tui": `
    export const visibleWidth = (s) => [...s].length;
    export const truncateToWidth = (s, w, e = "…", pad = false) => {
      const c = [...s];
      const cut = c.length > w ? c.slice(0, Math.max(0, w - 1)).join("") + (w > 0 ? e : "") : s;
      return pad ? cut + " ".repeat(Math.max(0, w - [...cut].length)) : cut;
    };
    export const wrapTextWithAnsi = (s, w) => s.split("\\n").flatMap((line) => {
      const out = [];
      for (let i = 0; i < Math.max(1, line.length); i += w) out.push(line.slice(i, i + w));
      return out;
    });
    export const matchesKey = (data, id) => data === id;
    export const decodeKittyPrintable = () => undefined;
    export class Markdown {
      constructor(text) { this.text = text; }
      render(width) { return wrapTextWithAnsi(this.text, width); }
    }
  `,
  "@earendil-works/pi-coding-agent": `
    export const DEFAULT_MAX_LINES = 2000;
    export const DEFAULT_MAX_BYTES = 50 * 1024;
    // Keeps whole leading lines within both limits; enough for callers that read content/truncated.
    export const truncateHead = (content, { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } = {}) => {
      const lines = content.split("\\n");
      const bytes = (s) => Buffer.byteLength(s, "utf8");
      const kept = [];
      let size = 0;
      for (const line of lines.slice(0, maxLines)) {
        const add = bytes(line) + (kept.length ? 1 : 0);
        if (size + add > maxBytes) break;
        kept.push(line);
        size += add;
      }
      const output = kept.join("\\n");
      const truncated = kept.length < lines.length;
      return {
        content: output, truncated,
        truncatedBy: !truncated ? null : kept.length === maxLines ? "lines" : "bytes",
        totalLines: lines.length, totalBytes: bytes(content), outputLines: kept.length, outputBytes: bytes(output),
        lastLinePartial: false, firstLineExceedsLimit: lines.length > 0 && bytes(lines[0]) > maxBytes,
        maxLines, maxBytes,
      };
    };
    export const getMarkdownTheme = () => new Proxy({}, { get: () => (s) => s });
    export const convertToLlm = (messages) => messages;
    export const serializeConversation = (messages) => JSON.stringify(messages);
    // Throws so callers take their no-clipboard path, as they did before this stub existed.
    export const copyToClipboard = async () => { throw new Error("no clipboard in tests"); };
    // Just enough of Pi's Editor for vi-mode: the private fields its bridge reads, public
    // getText/setText, and handleInput that types printable keys, submits on "enter", moves
    // left on the left arrow, and collapses a bracketed paste into a marker as Pi does.
    // Pi sets onSubmit, onEscape, and actionHandlers after construction; tests do the same.
    export class CustomEditor {
      constructor(tui) {
        this.tui = tui;
        this.borderColor = (s) => s;
        this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
        this.undoStack = { stack: [] };
        this.lastAction = null;
        this.pastes = new Map();
        this.pasteCounter = 0;
        this.actionHandlers = new Map();
      }
      setCursorCol(col) { this.state.cursorCol = col; }
      pushUndoSnapshot() {
        this.undoStack.stack.push({ lines: [...this.state.lines], cursorLine: this.state.cursorLine, cursorCol: this.state.cursorCol });
      }
      undo() {
        const s = this.undoStack.stack.pop();
        if (s) this.state = { lines: s.lines, cursorLine: s.cursorLine, cursorCol: s.cursorCol };
      }
      exitHistoryBrowsing() {}
      isShowingAutocomplete() { return false; }
      getText() { return this.state.lines.join("\\n"); }
      getCursor() { return { line: this.state.cursorLine, col: this.state.cursorCol }; }
      getExpandedText() {
        return this.getText().replace(/\\[paste #(\\d+) [^\\]]*\\]/g, (m, id) => this.pastes.get(Number(id)) ?? m);
      }
      // As Pi's: an undo step if the text changes, pastes cleared, cursor at the end.
      setText(text) {
        if (this.getText() !== text) this.pushUndoSnapshot();
        this.pastes.clear();
        this.pasteCounter = 0;
        const lines = text.split("\\n");
        this.state = { lines, cursorLine: lines.length - 1, cursorCol: lines[lines.length - 1].length };
        this.onChange?.(this.getText());
      }
      handleInput(data) {
        if (data === "escape") return this.onEscape?.();
        if (data === "enter") {
          const text = this.getText();
          this.undoStack.stack.length = 0;
          this.setText("");
          this.undoStack.stack.length = 0;
          return this.onSubmit?.(text);
        }
        if (data === "\\x1b[D") {
          const { lines, cursorLine, cursorCol } = this.state;
          if (cursorCol > 0) this.state.cursorCol = cursorCol - 1;
          else if (cursorLine > 0) this.state = { lines, cursorLine: cursorLine - 1, cursorCol: lines[cursorLine - 1].length };
          return;
        }
        const paste = /^\\x1b\\[200~([\\s\\S]*)\\x1b\\[201~$/.exec(data);
        if (paste) {
          const id = ++this.pasteCounter;
          this.pastes.set(id, paste[1]);
          return this.insert("[paste #" + id + " +" + paste[1].split("\\n").length + " lines]");
        }
        if ([...data].length !== 1) return;
        this.insert(data);
      }
      insert(data) {
        this.pushUndoSnapshot();
        const { lines, cursorLine, cursorCol } = this.state;
        const line = lines[cursorLine];
        lines[cursorLine] = line.slice(0, cursorCol) + data + line.slice(cursorCol);
        this.state.cursorCol = cursorCol + data.length;
      }
      renderBottomBorder(width) { return "─".repeat(width); }
    }
    export class BorderedLoader {
      #abort = new AbortController();
      get signal() { return this.#abort.signal; }
      onAbort = undefined;
      render() { return []; }
      invalidate() {}
      handleInput() {}
      dispose() {}
    }
  `,
};
const stubUrls = new Map(Object.entries(STUBS).map(([name, source]) => [name, `data:text/javascript,${encodeURIComponent(source)}`]));
registerHooks({
  resolve(specifier, context, next) {
    const url = stubUrls.get(specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});

type Handler = (event: unknown, ctx: unknown) => unknown;
// Narrower than Pi's AgentToolResult (no image content): these extensions' tools return text.
export interface ToolResult { content: { type: string; text: string }[]; details?: unknown }
export interface Tool { name: string; execute(id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown): Promise<ToolResult> }
export interface Command { handler(args: string, ctx: unknown): Promise<void> }
export interface Shortcut { handler(ctx: unknown): unknown }
type Flag = boolean | string;

export interface Sent { message: { customType: string; content: string }; options?: { triggerTurn?: boolean; deliverAs?: string } }

// Same shape as Pi's EventBus. Handlers run synchronously, unlike Pi's, so tests see effects at once.
export interface EventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    // Iterates a copy, so a handler that unsubscribes (or subscribes) mid-emit doesn't skew the loop.
    emit(channel, data) { for (const handler of [...(listeners.get(channel) ?? [])]) handler(data); },
    on(channel, handler) {
      // A fresh wrapper per subscription, so the same function subscribed twice unsubscribes independently.
      const wrapped = (data: unknown) => handler(data);
      const set = listeners.get(channel) ?? new Set();
      set.add(wrapped);
      listeners.set(channel, set);
      return () => { set.delete(wrapped); };
    },
  };
}

/** Pass one `events` bus to two fakes to simulate two extensions talking over `pi.events`. */
export function fakePi({ events = createEventBus() }: { events?: EventBus } = {}) {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const shortcuts = new Map<string, Shortcut>();
  // Tests set CLI flag values here; registerFlag only fills in defaults.
  const flags = new Map<string, Flag>();
  const sent: Sent[] = [];
  const entries: { type: "custom"; customType: string; data: unknown }[] = [];
  const notes: string[] = [];
  let active: string[] = [];
  const pi = {
    registerTool(tool: Tool) { tools.set(tool.name, tool); active.push(tool.name); },
    registerCommand(name: string, command: Command) { commands.set(name, command); },
    getCommands: () => [...commands.keys()].map((name) => ({ name })),
    events,
    registerShortcut(key: string, shortcut: Shortcut) { shortcuts.set(key, shortcut); },
    registerFlag(name: string, options: { default?: Flag }) {
      if (options.default !== undefined && !flags.has(name)) flags.set(name, options.default);
    },
    getFlag: (name: string) => flags.get(name),
    on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    sendMessage(message: Sent["message"], options?: Sent["options"]) { sent.push({ message, options }); },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
    getAllTools: () => [...tools.values()],
    getActiveTools: () => [...active],
    setActiveTools(names: string[]) { active = [...names]; },
  };
  const ctx = (cwd: string, extra: Record<string, unknown> = {}) => ({
    cwd, hasUI: true, signal: undefined,
    sessionManager: { getBranch: () => entries },
    modelRegistry: { getAvailable: () => [] },
    ui: {
      notify: (text: string) => { notes.push(text); },
      setStatus() {}, setWidget() {},
      input: async () => undefined, editor: async () => undefined, select: async () => undefined, confirm: async () => false,
    },
    ...extra,
  });
  function registered<T>(map: Map<string, T>, kind: string, name: string): T {
    const found = map.get(name);
    if (!found) throw new Error(`fakePi: no ${kind} "${name}" registered`);
    return found;
  }
  return {
    // Only part of ExtensionAPI; extensions calling anything else fail loudly with a TypeError.
    pi: pi as unknown as ExtensionAPI, events, tools, commands, shortcuts, flags, sent, entries, notes, ctx,
    active: () => [...active],
    /** Runs the event's handlers in order, as Pi does, and returns what each one returned. */
    async emit(event: string, payload: unknown, context: unknown): Promise<unknown[]> {
      const results: unknown[] = [];
      for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, context));
      return results;
    },
    command: (name: string, args: string, context: unknown) => registered(commands, "command", name).handler(args, context),
    tool: (name: string, params: unknown, context?: unknown) =>
      registered(tools, "tool", name).execute("call-1", params, undefined, undefined, context),
  };
}
