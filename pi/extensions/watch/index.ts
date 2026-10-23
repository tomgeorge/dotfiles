import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type KeyId, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Style } from "../run-panel/format.ts";
import { initialPopup, popupKey, popupLines, widgetLines, type PopupKey, type PopupState } from "./panel.ts";
import {
  describe, endReport, fireReport, firedNote, firstCheckNote, firstCheckReport, loopPrompt, type FirstCheck,
} from "./report.ts";
import { runCheck } from "./runner.ts";
import { anyChecking, WatchStore } from "./store.ts";
import {
  buildSpec, DELIVER, oneLine, parseArgs, Registry, UNTIL,
  type EndReason, type Kind, type RunResult, type Watch, type WatchInput,
} from "./watcher.ts";

type Message = { customType: string; content: string; display: boolean; details: unknown };

const FIRST_CHECK_WAIT_MS = 10_000;
const PANEL_KEY = "ctrl+shift+w";
const WIDGET_KEY = "watches";
// Fast while a check runs (spinner), slow otherwise (countdowns): watches can
// live for hours, so don't redraw at spinner speed the whole time.
const SPINNER_MS = 120;
const IDLE_TICK_MS = 1_000;

function makeStyle(theme: Theme): Style {
  return {
    fg: (tone, text) => theme.fg(tone, text),
    bold: (text) => theme.bold(text),
    selected: (text) => theme.bg("selectedBg", text),
    width: visibleWidth,
    truncate: (text, width, pad) => truncateToWidth(text, Math.max(0, width), "…", pad),
    wrap: (text, width) => wrapTextWithAnsi(text, Math.max(1, width)),
  };
}

// First match wins; letters mirror lazygit/vim, as in /subagents.
const POPUP_KEYS: [KeyId[], PopupKey][] = [
  [["up", "k"], "up"],
  [["down", "j"], "down"],
  [["pageUp", "ctrl+u"], "pageUp"],
  [["pageDown", "ctrl+d"], "pageDown"],
  [["home", "g"], "top"],
  [["end", "shift+g"], "bottom"],
  [["enter", "tab", "l", "right"], "enter"],
  [["escape", "h", "left"], "back"],
  [["a"], "toggle"],
  [["x"], "stop"],
  [["q", "ctrl+c", PANEL_KEY], "close"],
];

export default function (pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let shuttingDown = false;
  // Reports that must wait for the foreground run to finish.
  const heldNotices: Message[] = [];
  const dueLoops: number[] = [];
  // Watches whose `watch` tool call is still waiting for the first check. A report
  // in that window goes into the tool result instead of a separate message.
  // Keyed by object: an id can be reused as soon as its watch ends.
  const startingByTool = new Map<Watch, string | undefined>();

  const registry = new Registry(runCheck, { onFire, onDue, onEnd, onUpdate });
  // Every watch this session, ended ones included, for the widget and popup.
  const store = new WatchStore();
  let frame = 0;
  let ticker: ReturnType<typeof setTimeout> | undefined;
  let widgetTui: TUI | undefined;
  let widgetCtx: ExtensionContext | undefined;
  let popupOpen = false;

  function tick() {
    frame++;
    widgetTui?.requestRender();
    ticker = setTimeout(tick, anyChecking(store.list()) ? SPINNER_MS : IDLE_TICK_MS);
  }

  function showWidget(context: ExtensionContext) {
    widgetCtx = context;
    context.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      widgetTui = tui;
      const component: Component = {
        render: (width) => widgetLines(store.list(), Date.now(), width, makeStyle(theme), { frame, hint: PANEL_KEY }),
        invalidate() {},
      };
      return component;
    }, { placement: "belowEditor" });
    tick();
  }

  function hideWidget() {
    clearTimeout(ticker);
    ticker = undefined;
    widgetCtx?.ui.setWidget(WIDGET_KEY, undefined);
    widgetCtx = undefined;
    widgetTui = undefined;
  }

  /** Show the below-editor widget while watches are active. */
  function syncWidget() {
    if (shuttingDown || !ctx?.hasUI) return;
    const active = store.active().length > 0;
    if (active && !widgetCtx) {
      showWidget(ctx);
    } else if (!active && widgetCtx) {
      hideWidget();
    } else if (anyChecking(store.list()) && ticker) {
      // A check just started: pick up spinner speed now, not after the slow tick.
      clearTimeout(ticker);
      tick();
    }
  }

  async function openPopup(context: ExtensionContext) {
    if (!context.hasUI || popupOpen) return;
    popupOpen = true;
    try {
      await context.ui.custom<void>((tui, theme, _keybindings, done) => {
        const state: PopupState = initialPopup(store.list());
        let page = 1;
        const unsubscribe = store.subscribe(() => tui.requestRender());
        // The widget's ticker stops when nothing is active; tick here too.
        const popupTicker = setInterval(() => { frame++; tui.requestRender(); }, SPINNER_MS);
        return {
          render(width) {
            const height = Math.max(8, Math.floor(tui.terminal.rows * 0.8));
            const out = popupLines(store.list(), state, Date.now(), width, height, makeStyle(theme), frame);
            page = out.page;
            return out.lines;
          },
          handleInput(data) {
            const key = POPUP_KEYS.find(([ids]) => ids.some((id) => matchesKey(data, id)))?.[1]
              ?? (data === "G" ? "bottom" : undefined);
            if (!key) return;
            const action = popupKey(state, store.list(), key, page);
            if (action.type === "close") return done();
            // Ids are reused: stop only if the id still belongs to this watch.
            if (action.type === "stop" && registry.get(action.watch.id) === action.watch) registry.stop(action.watch.id);
            tui.requestRender();
          },
          invalidate() {},
          dispose() {
            unsubscribe();
            clearInterval(popupTicker);
          },
        };
      }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "80%" } });
    } finally {
      popupOpen = false;
    }
  }

  // Queued messages count as busy: a new turn now would jump ahead of them.
  const idle = () => !!ctx && ctx.isIdle() && !ctx.hasPendingMessages();

  function onUpdate(watch: Watch) {
    if (shuttingDown) return;
    store.sync(watch);
    syncWidget();
  }

  function onFire(watch: Watch, result: RunResult) {
    if (shuttingDown) return;
    store.sync(watch);
    store.note(watch, firedNote(watch), "success");
    deliver(watch, fireReport(watch, result, Date.now()), "fired");
  }

  function onDue(watch: Watch) {
    if (shuttingDown) return;
    store.sync(watch);
    store.note(watch, `iteration ${watch.fires} due`, "warning");
    dueLoops.push(watch.id);
    if (idle()) runDueLoop();
  }

  function onEnd(watch: Watch, reason: EndReason, detail?: string) {
    const index = dueLoops.indexOf(watch.id);
    if (index >= 0) dueLoops.splice(index, 1);
    if (shuttingDown) return;
    store.end(watch, reason, detail);
    syncWidget();
    // "met" already reported through onFire; "stopped" was asked for.
    if (reason === "met" || reason === "stopped") return;
    // A loop's prompt needs no closing turn; tell the user without waking the model.
    deliver(watch, endReport(watch, reason, detail), reason, watch.kind === "prompt" ? "notify" : undefined);
  }

  function deliver(watch: Watch, content: string, event: string, mode = watch.deliver) {
    if (startingByTool.has(watch)) {
      startingByTool.set(watch, content);
      return;
    }
    const message: Message = { customType: "watch", content, display: true, details: { id: watch.id, event } };
    alert(`Pi watch #${watch.id}`, `${event}: ${watch.description}`);
    if (mode === "notify") {
      if (idle()) pi.sendMessage(message);
      else heldNotices.push(message);
      return;
    }
    if (idle()) pi.sendMessage(message, { triggerTurn: true });
    // followUp lets the current run finish, then answers with both in context.
    else pi.sendMessage(message, { deliverAs: mode === "steer" ? "steer" : "followUp" });
  }

  function runDueLoop() {
    const id = dueLoops.shift();
    if (id === undefined) return;
    const watch = registry.get(id);
    if (!watch) return runDueLoop();
    store.note(watch, `iteration ${watch.fires} sent`);
    pi.sendMessage({
      customType: "watch-loop",
      display: true,
      details: { id, iteration: watch.fires },
      content: loopPrompt(watch),
    }, { triggerTurn: true });
    registry.rearm(id);
  }

  function alert(title: string, body: string) {
    if (ctx?.mode !== "tui" || !ctx.hasUI) return;
    ctx.ui.notify(`${title}: ${body}`, "info");
    // OSC 777 desktop notification (Ghostty, iTerm2, WezTerm). Strip separators
    // and control characters so command text can't end or inject a sequence.
    const clean = (s: string) => oneLine(s, 120).replace(/[;\x00-\x1f\x7f]/g, " ");
    let seq = `\x1b]777;notify;${clean(title)};${clean(body)}\x07`;
    if (process.env.TMUX) seq = `\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
    process.stdout.write(seq);
  }

  function start(input: WatchInput, context: ExtensionContext): Watch {
    if (shuttingDown) throw new Error("Session is shutting down");
    ctx = context;
    const watch = registry.start(buildSpec(input, context.cwd));
    store.add(watch);
    syncWidget();
    return watch;
  }

  /** Wait briefly for the first check, so a broken command shows up while the caller is watching. */
  async function firstCheck(watch: Watch): Promise<FirstCheck> {
    if (watch.kind !== "command") return "pending";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Promise<"pending">((resolve) => { timer = setTimeout(() => resolve("pending"), FIRST_CHECK_WAIT_MS); });
    try {
      return await Promise.race([registry.firstCheck(watch.id), pending]);
    } finally {
      clearTimeout(timer);
    }
  }

  function listText(): string {
    const watches = registry.list();
    return watches.length ? watches.map((watch) => describe(watch, Date.now())).join("\n") : "No active watches";
  }

  pi.on("session_start", async (_event, context) => {
    ctx = context;
  });

  // The foreground run is over: show held notices, then start at most one loop
  // iteration (each starts a run; the rest wait for the next settle).
  pi.on("agent_settled", async (_event, context) => {
    ctx = context;
    for (const message of heldNotices.splice(0)) pi.sendMessage(message);
    if (!context.hasPendingMessages()) runDueLoop();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    clearTimeout(ticker);
    registry.stopAll();
  });

  pi.registerTool({
    name: "watch",
    label: "Watch",
    description: [
      "Watch something in the background and report back later without polling turns.",
      "Command watches run a shell check (bash -c, in the session cwd) every interval at no model cost.",
      "until=success (default): the watch ends and reports when the command exits 0; any other exit keeps waiting.",
      "until=change: reports each time stdout or the exit code changes from the previous check, until the timeout.",
      "Exit codes 126/127 stop the watch. The report includes the tail of the command output.",
      "deliver=wake (default): start a turn when idle, or answer right after the current run. steer: inject into the current run.",
      "notify: show the report to the user without a model turn (held until the current run ends).",
      "Prompt watches (loops) send the prompt to you every interval, when idle; use them only when a check needs judgement or tools a shell command can't use.",
      "Returns the watch id and the first check's result (waits up to 10s for it). Ids number the active watches; an id is reused once its watch ends.",
    ].join(" "),
    promptGuidelines: [
      "When the user asks to be told when something finishes or changes (CI, deploys, rollouts, alerts), start a watch instead of sleeping or re-checking with repeated tool calls.",
      "Make the watch command print a short status and exit 0 exactly when the wait is over, e.g. `gh pr checks 123; test $? -ne 8` (gh exits 8 while checks are pending) or `kubectl rollout status deploy/api --timeout=60s`.",
      "Prefer a command watch over a prompt loop; loops cost a model turn per iteration.",
    ],
    parameters: Type.Object({
      command: Type.Optional(Type.String({ minLength: 1, description: "Shell check. Exclusive with prompt." })),
      prompt: Type.Optional(Type.String({ minLength: 1, description: "Prompt to run each interval. Exclusive with command." })),
      description: Type.String({ minLength: 1, description: "Short label shown to the user, e.g. 'CI for PR 123'" }),
      interval: Type.Optional(Type.String({ description: "e.g. 30s, 5m. Default 30s for commands (min 5s), 10m for prompts (min 1m)" })),
      timeout: Type.Optional(Type.String({ description: "Total lifetime, e.g. 45m, 2h. Default 1h for commands, 4h for prompts; max 24h" })),
      until: Type.Optional(StringEnum([...UNTIL])),
      deliver: Type.Optional(StringEnum([...DELIVER])),
    }),
    async execute(_id, params, _signal, _onUpdate, context) {
      const watch = start(params, context);
      startingByTool.set(watch, undefined);
      let first: FirstCheck;
      let report: string | undefined;
      try {
        first = await firstCheck(watch);
      } finally {
        report = startingByTool.get(watch);
        startingByTool.delete(watch);
      }
      const text = report
        ? `${report}\n\n(Reported on the first check; watch #${watch.id} has ended.)`
        : [
          `Started watch: ${describe(watch, Date.now())}`,
          firstCheckReport(watch, first, FIRST_CHECK_WAIT_MS),
          "You'll get a message when it reports. Stop it with watch_stop.",
        ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }], details: { id: watch.id } };
    },
  });

  pi.registerTool({
    name: "watch_list",
    label: "Watch list",
    description: "List active watches and loops with their ids, schedules, and last results.",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: listText() }], details: undefined };
    },
  });

  pi.registerTool({
    name: "watch_stop",
    label: "Watch stop",
    description: "Stop an active watch or loop by id.",
    parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
    async execute(_id, { id }) {
      if (!registry.stop(id)) throw new Error(`No active watch #${id}. Active:\n${listText()}`);
      return { content: [{ type: "text", text: `Stopped watch #${id}` }], details: undefined };
    },
  });

  function commandHandler(kind: Kind) {
    return async (args: string, context: ExtensionContext) => {
      try {
        const watch = start(parseArgs(args, kind), context);
        if (!context.hasUI) return;
        context.ui.notify(`Started ${describe(watch, Date.now())}`, "info");
        // Don't await: Pi blocks input while a command handler runs.
        void firstCheck(watch).then((first) => {
          // A watch that ended on its first check already sent a report.
          if (shuttingDown || first === "pending" || !first || registry.get(watch.id) !== watch) return;
          const failed = first.code !== 0 && first.stderr.trim() !== "";
          context.ui.notify(firstCheckNote(watch, first), failed ? "warning" : "info");
        });
      } catch (error) {
        if (!context.hasUI) throw error;
        context.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };
  }

  pi.registerCommand("watch", {
    description: "Run a shell check until it exits 0: /watch [30s] [--change] [--wake|--steer|--notify] [--timeout 1h] <command>",
    handler: commandHandler("command"),
  });

  pi.registerCommand("loop", {
    description: "Send a prompt every interval while idle: /loop [10m] [--timeout 4h] <prompt>",
    handler: commandHandler("prompt"),
  });

  pi.registerCommand("watches", {
    description: `Browse watches and loops: status, check log, last output; x stops one (${PANEL_KEY})`,
    async handler(_args, context) {
      if (!context.hasUI) return console.log(listText());
      ctx = context;
      await openPopup(context);
    },
  });

  pi.registerShortcut(PANEL_KEY, {
    description: "Browse watches and loops",
    handler: (context) => openPopup(context),
  });

  pi.registerCommand("unwatch", {
    description: "Stop watches: /unwatch [id] (no id stops all)",
    async handler(args, context) {
      const arg = args.trim().replace(/^#/, "");
      const say = (text: string, level: "info" | "error") => {
        if (context.hasUI) context.ui.notify(text, level);
        else if (level === "error") throw new Error(text);
      };
      if (!arg) {
        const active = registry.list().length;
        registry.stopAll();
        return say(active ? `Stopped ${active} watch${active === 1 ? "" : "es"}` : "No active watches", "info");
      }
      if (!registry.stop(Number(arg))) say(`No active watch #${arg}\n${listText()}`, "error");
    },
  });
}
