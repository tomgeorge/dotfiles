// A stand-in for Pi's ExtensionAPI, so an extension's event wiring can be unit-tested.
// No index.ts here, so Pi doesn't load this directory as an extension.
import { registerHooks } from "node:module";

// typebox and pi-ai only resolve inside Pi. Tool schemas don't matter to these tests.
const STUB = `data:text/javascript,${encodeURIComponent(`
  const any = new Proxy(function () {}, { get: () => any, apply: () => ({}) });
  export const Type = any;
  export const StringEnum = () => ({});
`)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "typebox" || specifier === "@earendil-works/pi-ai") return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

type Handler = (event: any, ctx: any) => unknown;

export interface Sent { message: { customType: string; content: string }; options?: { triggerTurn?: boolean; deliverAs?: string } }

export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const sent: Sent[] = [];
  const entries: { type: "custom"; customType: string; data: unknown }[] = [];
  const notes: string[] = [];
  let active: string[] = [];
  const pi = {
    registerTool(tool: any) { tools.set(tool.name, tool); active.push(tool.name); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(event: string, handler: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    sendMessage(message: Sent["message"], options?: Sent["options"]) { sent.push({ message, options }); },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
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
  return {
    pi: pi as any, tools, commands, sent, entries, notes, ctx,
    active: () => [...active],
    async emit(event: string, payload: unknown, context: unknown) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, context);
    },
    command: (name: string, args: string, context: unknown) => commands.get(name).handler(args, context),
    tool: (name: string, params: unknown, context?: unknown) => tools.get(name).execute("call-1", params, undefined, undefined, context),
  };
}
