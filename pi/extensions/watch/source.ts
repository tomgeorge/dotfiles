import { duration, expandTabs, tildify, wallClock, type Style } from "../run-panel/format.ts";
import type { Content, Item, Source } from "../run-panel/source.ts";
import { counter, kindLabel, mark, status, summary } from "./panel.ts";
import { exitText, outputText } from "./report.ts";
import { anyChecking, type WatchRecord, type WatchStore } from "./store.ts";
import { formatDuration, tail, type Registry, type Watch } from "./watcher.ts";

// Watches and loops as a source for the shared panel (run-panel/): one item per watch this
// session, ended ones included, with Overview, Log, and Output tabs and a stop action. Layout
// and keys live in run-panel.

function overview(record: WatchRecord, now: number, s: Style): Content {
  const { watch } = record;
  const left = record.ended ? `ended ${wallClock(record.ended.at)}` : `${duration(watch.deadline - now)} left`;
  const mode = watch.kind === "prompt"
    ? "loop · runs when idle"
    : `command · until ${watch.until} · deliver ${watch.deliver}`;
  const counts = watch.kind === "prompt"
    ? counter(watch)
    : `${counter(watch)} · fired ${watch.fires}${watch.last ? ` · last ${exitText(watch.last)}` : ""}`;
  return {
    kind: "fields",
    rows: [
      ["kind", mode],
      ["cwd", tildify(watch.cwd)],
      ["every", `${formatDuration(watch.intervalMs)} ${s.fg("dim", `· timeout ${formatDuration(watch.timeoutMs)} · ${left}`)}`],
      ["count", counts],
      ["status", status(record, now)],
      [watch.kind === "prompt" ? "prompt" : "cmd", expandTabs(watch.text)],
    ],
  };
}

function log(record: WatchRecord, s: Style): Content {
  return {
    kind: "lines",
    lines: record.log.map((entry) => {
      const text = entry.tone ? s.fg(entry.tone, entry.text) : entry.text;
      return `${s.fg("dim", wallClock(entry.at))} ${text}${entry.repeat > 1 ? s.fg("muted", ` ×${entry.repeat}`) : ""}`;
    }),
  };
}

/** A watch's last check output, or a loop's prompt; the error first when it ended in one. */
function output(record: WatchRecord, s: Style): Content {
  const { watch } = record;
  const parts: Extract<Content, { kind: "sections" }>["parts"] = [];
  if (record.ended?.reason === "error" && record.ended.detail) {
    parts.push({ content: { kind: "message", text: record.ended.detail, tone: "error" } });
    parts.push({ content: { kind: "lines", lines: [""] } });
  }
  if (watch.kind === "prompt") {
    parts.push({ content: { kind: "lines", lines: expandTabs(watch.text).split("\n"), wrap: true } });
  } else if (!watch.last) {
    parts.push({ content: { kind: "message", text: "No check has finished yet" } });
  } else {
    const out = outputText(watch.last);
    parts.push({ content: { kind: "lines", lines: [s.fg("muted", `Last check ${exitText(watch.last)}`), ""] } });
    parts.push({
      content: out
        ? { kind: "lines", lines: expandTabs(tail(out, 500, 50_000)).split("\n"), wrap: true }
        : { kind: "message", text: "(no output)" },
    });
  }
  return { kind: "sections", parts };
}

/** `registry.stop(id)` stops an active watch; ids are reused, so stop checks it's still this one. */
export function watchSource(store: WatchStore, registry: Pick<Registry, "get" | "stop">, now: () => number = Date.now): Source<WatchRecord> {
  const item = (record: WatchRecord, at: number): Item<WatchRecord> => {
    const { watch } = record;
    const m = mark(record);
    const state = status(record, at);
    return {
      // watch.id is reused once a watch ends; the record key is unique for the session.
      id: String(record.key),
      value: record,
      text: [`#${watch.id}`, kindLabel(watch), watch.description, watch.text, state],
      cells: {
        id: { text: `#${watch.id}`, tone: "accent" },
        kind: { text: kindLabel(watch), tone: "muted" },
        description: watch.description,
        count: { text: counter(watch), tone: "dim" },
        last: watch.last ? { text: exitText(watch.last), tone: watch.last.code === 0 && !watch.last.killed ? "success" : "dim" } : "",
        status: { text: state, tone: watch.state === "due" && !record.ended ? "warning" : "dim" },
      },
      glyph: m ? { text: m.icon, tone: m.tone } : undefined,
      running: !record.ended,
      title: [{ text: `#${watch.id}`, tone: "accent" }, { text: ` ${watch.description} ` }, { text: `· ${state}`, tone: "dim" }],
    };
  };

  return {
    name: "Watches",
    empty: "No watches yet",
    items() {
      const at = now();
      return store.list().map((record) => item(record, at));
    },
    status(matched, total) {
      return `${matched === total ? total : `${matched}/${total}`} · ${summary(store.list())}`;
    },
    columns: [
      { id: "id" },
      { id: "kind", width: 5, drop: 3 },
      { id: "description", fill: true },
      { id: "count", align: "right", drop: 2 },
      { id: "last", drop: 1 },
      { id: "status" },
    ],
    views: [
      { id: "overview", label: "Overview", render: (record, ctx) => overview(record, ctx.now, ctx.style) },
      { id: "log", label: "Log", tail: true, render: (record, ctx) => log(record, ctx.style) },
      { id: "output", label: "Output", render: (record, ctx) => output(record, ctx.style) },
    ],
    actions: [
      {
        // No confirmation: stopping is cheap, and the popup this replaced didn't ask.
        id: "stop", label: "stop", key: "x", description: "stop the selected watch or loop",
        available: (record) => (record.ended ? `#${record.watch.id} has ended` : true),
        run: (record) => stop(record.watch),
      },
    ],
    busy: () => anyChecking(store.list()),
    subscribe: (onChange) => store.subscribe(onChange),
  };

  function stop(watch: Watch) {
    if (registry.get(watch.id) !== watch || !registry.stop(watch.id)) return { flash: `#${watch.id} has ended`, tone: "warning" as const };
    return { flash: `Stopped #${watch.id}`, tone: "warning" as const };
  }
}
