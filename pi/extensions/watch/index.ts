import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runCheck } from "./runner.ts";
import {
  buildSpec, DELIVER, formatDuration, oneLine, parseArgs, Registry, tail, UNTIL,
  type EndReason, type RunResult, type Watch, type WatchInput,
} from "./watcher.ts";

type Message = { customType: string; content: string; display: boolean; details: unknown };

const FIRST_CHECK_WAIT_MS = 10_000;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export default function (pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let shuttingDown = false;
  // Reports that must wait for the foreground run to finish.
  let heldNotices: Message[] = [];
  const dueLoops: number[] = [];
  // Watches whose `watch` tool call is still waiting for the first check. A report
  // in that window goes into the tool result instead of a separate message.
  // Keyed by object: an id can be reused as soon as its watch ends.
  const startingByTool = new Map<Watch, string | undefined>();

  const registry = new Registry(runCheck, { onFire, onEnd, onUpdate });
  const exit = (result: RunResult) => result.killed ? "killed" : `exit ${result.code}`;

  // Queued messages count as busy: a new turn now would jump ahead of them.
  const idle = () => !!ctx && ctx.isIdle() && !ctx.hasPendingMessages();

  function onUpdate(watch: Watch) {
    if (shuttingDown || !ctx?.hasUI) return;
    const parts = [`${watch.kind === "prompt" ? "loop" : "watch"} #${watch.id} ${oneLine(watch.description, 40)}`];
    if (watch.kind === "command") {
      parts.push(count(watch.checks, "check"));
      if (watch.last) parts.push(`last ${exit(watch.last)}`);
    } else parts.push(count(watch.fires, "run"));
    if (watch.state === "running") parts.push("checking");
    else if (watch.state === "due") parts.push("due when idle");
    else if (watch.nextAt) parts.push(`next ${new Date(watch.nextAt).toLocaleTimeString()}`);
    ctx.ui.setStatus(`watch-${watch.id}`, parts.join(" · "));
  }

  function onFire(watch: Watch, result: RunResult | undefined) {
    if (shuttingDown) return;
    if (watch.kind === "prompt") {
      dueLoops.push(watch.id);
      if (idle()) runDueLoop();
      return;
    }
    const verb = watch.until === "success" ? "condition met" : `output changed (change ${watch.fires})`;
    const lines = [
      `Watch #${watch.id} ${verb}: ${watch.description}`,
      `Command: ${watch.text}`,
      `Exit ${result!.code}${watch.until === "change" && watch.previous ? ` (was ${exit(watch.previous)})` : ""} on check ${watch.checks}, ${formatDuration(Date.now() - watch.startedAt)} after starting.`,
    ];
    if (watch.until === "change") lines.push(`Still watching; stop it with watch_stop id ${watch.id}.`);
    lines.push("", output(result!));
    deliver(watch, lines.join("\n"), "fired");
  }

  function onEnd(watch: Watch, reason: EndReason, detail?: string) {
    const index = dueLoops.indexOf(watch.id);
    if (index >= 0) dueLoops.splice(index, 1);
    if (shuttingDown) return;
    if (ctx?.hasUI) ctx.ui.setStatus(`watch-${watch.id}`, undefined);
    // "met" already reported through onFire; "stopped" was asked for.
    if (reason === "met" || reason === "stopped") return;
    const name = watch.kind === "prompt" ? "Loop" : "Watch";
    const lines = reason === "timeout"
      ? [`${name} #${watch.id} timed out after ${formatDuration(watch.timeoutMs)}${watch.kind === "command" && watch.until === "success" ? " without its condition being met" : ""}: ${watch.description}`]
      : [`${name} #${watch.id} stopped on an error: ${watch.description}`, detail ?? ""];
    if (watch.kind === "command") {
      lines.push(`Command: ${watch.text}`);
      if (watch.last) {
        const last = watch.last.killed ? "Last check was still running and was killed" : `Last exit ${watch.last.code}`;
        lines.push(`${last} after ${count(watch.checks, "check")}.`, "", output(watch.last));
      }
    }
    // A loop's prompt needs no closing turn; tell the user without waking the model.
    deliver(watch, lines.join("\n"), reason, watch.kind === "prompt" ? "notify" : undefined);
  }

  function output(result: RunResult): string {
    const text = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
    // Command output is data from outside the session, not instructions.
    return text ? `Command output (untrusted):\n${tail(text)}` : "(no output)";
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
    pi.sendMessage({
      customType: "watch-loop",
      display: true,
      details: { id, iteration: watch.fires },
      content: `${watch.text}\n\n[Loop #${id}, iteration ${watch.fires}, every ${formatDuration(watch.intervalMs)}. When this no longer needs checking, call watch_stop with id ${id}.]`,
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
    return registry.start(buildSpec(input, context.cwd));
  }

  /** One line, so it also works as a select row. */
  function describe(watch: Watch): string {
    const parts = [`#${watch.id} ${watch.description}`];
    if (watch.kind === "prompt") parts.push("loop");
    else parts.push(`until ${watch.until}`, watch.deliver);
    parts.push(`every ${formatDuration(watch.intervalMs)}`, `${formatDuration(Math.max(0, watch.deadline - Date.now()))} left`);
    if (watch.kind === "prompt") parts.push(count(watch.fires, "run"));
    else {
      parts.push(count(watch.checks, "check"));
      if (watch.last) parts.push(`last ${exit(watch.last)}`);
      if (watch.description !== oneLine(watch.text, 60)) parts.push(`$ ${oneLine(watch.text, 80)}`);
    }
    return parts.join(" · ");
  }

  /** For the tool result (`full`: with output) or a one-line notification. */
  function firstCheckText(watch: Watch, first: RunResult | undefined | "pending", full: boolean): string {
    if (watch.kind !== "command" || first === undefined) return "";
    if (first === "pending") return `First check still running after ${formatDuration(FIRST_CHECK_WAIT_MS)}; fine for a command that blocks until done.`;
    const meaning = watch.until === "change"
      ? "this is the baseline; it reports when the output or exit code changes"
      : "not met yet; still watching";
    if (!full) {
      const err = first.code !== 0 ? oneLine(first.stderr, 120) : "";
      return `Watch #${watch.id} first check: ${exit(first)}${err ? `: ${err}` : ""} · ${meaning}`;
    }
    return [
      `First check: ${exit(first)}; ${meaning}.`,
      output(first),
      "If this output shows the check itself is broken (auth, typo, wrong path), stop it with watch_stop and start a corrected one.",
    ].join("\n");
  }

  /** Wait briefly for the first check, so a broken command shows up while the caller is watching. */
  async function firstCheck(watch: Watch): Promise<RunResult | undefined | "pending"> {
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
    return watches.length ? watches.map(describe).join("\n") : "No active watches";
  }

  pi.on("session_start", async (_event, context) => {
    ctx = context;
  });

  // The foreground run is over: show held notices, then start at most one loop
  // iteration (each starts a run; the rest wait for the next settle).
  pi.on("agent_settled", async (_event, context) => {
    ctx = context;
    const notices = heldNotices;
    heldNotices = [];
    for (const message of notices) pi.sendMessage(message);
    if (!context.hasPendingMessages()) runDueLoop();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
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
      let first: Awaited<ReturnType<typeof firstCheck>>;
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
          `Started watch: ${describe(watch)}`,
          firstCheckText(watch, first, true),
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

  function commandHandler(kind: "command" | "prompt") {
    return async (args: string, context: ExtensionContext) => {
      try {
        const watch = start(parseArgs(args, kind), context);
        if (!context.hasUI) return;
        context.ui.notify(`Started ${describe(watch)}`, "info");
        // Don't await: Pi blocks input while a command handler runs.
        void firstCheck(watch).then((first) => {
          // A watch that ended on its first check already sent a report.
          if (shuttingDown || first === "pending" || !first || registry.get(watch.id) !== watch) return;
          const failed = first.code !== 0 && first.stderr.trim() !== "";
          context.ui.notify(firstCheckText(watch, first, false), failed ? "warning" : "info");
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
    description: "List active watches and loops; pick one to stop it",
    async handler(_args, context) {
      if (!context.hasUI) return console.log(listText());
      const watches = registry.list();
      if (!watches.length) return context.ui.notify("No active watches", "info");
      // A dialog, not a notification: Pi overwrites consecutive info lines in
      // place, so a listing could look identical to the line before it.
      const labels = watches.map(describe);
      const picked = await context.ui.select("Active watches (pick one to stop, Esc to close)", labels);
      if (picked === undefined) return;
      const watch = watches[labels.indexOf(picked)];
      if (registry.get(watch.id) !== watch) return context.ui.notify(`Watch #${watch.id} already ended`, "info");
      if (!(await context.ui.confirm(`Stop watch #${watch.id}?`, `${watch.description}\n${watch.text}`))) return;
      registry.stop(watch.id);
      context.ui.notify(`Stopped watch #${watch.id}`, "info");
    },
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
