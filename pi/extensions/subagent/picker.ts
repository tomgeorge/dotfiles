// The confirm-a-model flow, with the UI injected so it's testable without Pi.

export interface PickerUI {
  select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
}
export interface Model { provider: string; id: string }
export interface Picked { provider: string; model: string }

/** The task on one line, cut to fit a few wrapped lines under the picker title. */
export function taskPreview(task: string, max = 240): string {
  const flat = task.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function split(id: string): Picked {
  const slash = id.indexOf("/");
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

/** `/subagent` arguments: an exact model and its task, or a task (maybe empty) to pick a model for. */
export type CommandArgs =
  | { type: "model"; picked: Picked; task: string }
  | { type: "pick"; task: string };

export function parseCommandArgs(args: string, available: Model[]): CommandArgs {
  const [, first = "", rest = ""] = args.trim().match(/^(\S+)\s*([\s\S]*)$/) ?? [];
  const slash = first.indexOf("/");
  if (slash > 0 && available.some((m) => `${m.provider}/${m.id}` === first)) {
    if (!rest.trim()) throw new Error("Usage: /subagent [provider/model] task");
    return { type: "model", picked: split(first), task: rest };
  }
  // Looks like a model for a known provider: a typo, not the start of a task.
  if (slash > 0 && available.some((m) => m.provider === first.slice(0, slash))) {
    throw new Error(`Unavailable model: ${first}. Use /subagent without a model to pick one.`);
  }
  return { type: "pick", task: args.trim() };
}

/** Have the user pick a model for `task` from all available models. `undefined` if they cancel. */
export async function pickModel(
  task: string,
  ui: PickerUI,
  available: Model[],
  options: { signal?: AbortSignal } = {},
): Promise<Picked | undefined> {
  const all = available.map((m) => `${m.provider}/${m.id}`).sort();
  if (!all.length) throw new Error("No available models. Configure Pi authentication first.");
  const id = await ui.select(`Subagent model\nTask: ${taskPreview(task)}`, all, { signal: options.signal });
  return id ? split(id) : undefined;
}
