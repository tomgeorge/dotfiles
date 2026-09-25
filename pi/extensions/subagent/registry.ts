export const DEFAULT_MAX_CONCURRENT = 10;
export const LABEL_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
const LABEL_RE = new RegExp(LABEL_PATTERN);

export interface Entry {
  id: number;
  label: string;
  model: string;
  startedAt: number;
  controller: AbortController;
}

export function validateLabel(label: string): void {
  if (!LABEL_RE.test(label)) {
    throw new Error("label must be 1-64 lowercase letters, digits, or hyphens, starting with a letter or digit");
  }
  // /subagent-cancel accepts a label, a job number, or "all".
  if (label === "all" || /^\d+$/.test(label)) throw new Error(`label must not be "all" or only digits: ${label}`);
}

export function parseMaxConcurrent(value: string | undefined): { max: number; warning?: string } {
  if (value === undefined || value === "") return { max: DEFAULT_MAX_CONCURRENT };
  if (/^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value))) return { max: Number(value) };
  return {
    max: DEFAULT_MAX_CONCURRENT,
    warning: `Invalid PI_SUBAGENT_MAX_CONCURRENT=${JSON.stringify(value)}; using ${DEFAULT_MAX_CONCURRENT}`,
  };
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** Running jobs for one parent session. Fails when full; never queues. */
export class JobRegistry {
  readonly max: number;
  private readonly entries = new Map<number, Entry>();
  private nextId = 1;

  constructor(max: number) {
    this.max = max;
  }

  get size(): number {
    return this.entries.size;
  }

  // Synchronous on purpose: Pi runs sibling tool calls concurrently, so an
  // await between the checks and the insert could let two jobs take the last
  // slot or the same label.
  add(label: string | undefined, model: string, controller: AbortController, now = Date.now()): Entry {
    if (label !== undefined) validateLabel(label);
    if (this.entries.size >= this.max) {
      throw new Error(`${this.max} subagents are already running (PI_SUBAGENT_MAX_CONCURRENT). Wait or use /subagent-cancel.`);
    }
    if (label !== undefined) {
      const taken = this.findByLabel(label);
      if (taken) throw new Error(`label "${label}" is already used by running job #${taken.id}; choose another`);
    }
    const id = this.nextId++;
    const entry: Entry = { id, label: label ?? `job-${id}`, model, startedAt: now, controller };
    this.entries.set(id, entry);
    return entry;
  }

  remove(id: number): void {
    this.entries.delete(id);
  }

  find(ref: string): Entry | undefined {
    const trimmed = ref.trim().replace(/^#/, "");
    if (/^\d+$/.test(trimmed)) return this.entries.get(Number(trimmed));
    return this.findByLabel(trimmed);
  }

  cancel(ref: string): Entry | undefined {
    const entry = this.find(ref);
    entry?.controller.abort();
    return entry;
  }

  cancelAll(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
  }

  list(): Entry[] {
    return [...this.entries.values()];
  }

  private findByLabel(label: string): Entry | undefined {
    for (const entry of this.entries.values()) if (entry.label === label) return entry;
    return undefined;
  }
}
