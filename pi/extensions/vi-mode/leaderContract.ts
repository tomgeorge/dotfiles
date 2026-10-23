// The leader-key contract other extensions import as ../vi-mode/leaderContract.ts.
// It imports nothing, so depending on it doesn't pull in the rest of vi-mode.
//
// An extension contributes slash-command bindings over Pi's shared event bus.
// vi-mode's registry validates each contribution; these types only describe
// the shape a well-behaved contributor sends.

export type LeaderTone = "default" | "exit";

// One step of a path. key is one character from a-z or 0-9.
export interface LeaderSegment {
  key: string;
  label: string;
  detail?: string;
  tone?: LeaderTone;
}

// Runs as "/name args". name has no leading "/".
export interface LeaderCommand {
  name: string;
  args?: string;
}

export interface LeaderBinding {
  id: string;
  path: [LeaderSegment, ...LeaderSegment[]];
  command: LeaderCommand;
}

// A new contribution from the same source replaces the earlier one; an empty
// bindings list unregisters the source.
export interface LeaderContribution {
  source: string;
  bindings: LeaderBinding[];
}

export const LEADER_CONTRIBUTE = "leader:contribute";
// vi-mode emits this when it loads, so extensions that loaded first announce again.
export const LEADER_DISCOVER = "leader:discover";

// Structural, so this file needn't import Pi's EventBus type.
export interface LeaderEvents {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface LeaderHandle {
  update(bindings: LeaderBinding[]): void;
  dispose(): void;
}

export function contributeLeader(events: LeaderEvents, source: string, bindings: LeaderBinding[]): LeaderHandle {
  let current = bindings;
  let disposed = false;
  const announce = (): void => {
    const contribution: LeaderContribution = { source, bindings: current };
    events.emit(LEADER_CONTRIBUTE, contribution);
  };
  const off = events.on(LEADER_DISCOVER, announce);
  announce();
  return {
    update(next) {
      if (disposed) return;
      current = next;
      announce();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = [];
      announce();
      off();
    },
  };
}
