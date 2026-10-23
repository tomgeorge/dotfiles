import assert from "node:assert/strict";
import { test } from "node:test";
import { contributeLeader, LEADER_CONTRIBUTE, LEADER_DISCOVER, type LeaderBinding, type LeaderEvents } from "./leaderContract.ts";

function bus(): LeaderEvents & { sent: { channel: string; data: unknown }[]; handlers: Map<string, Set<(data: unknown) => void>> } {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: { channel: string; data: unknown }[] = [];
  return {
    sent,
    handlers,
    emit(channel, data) {
      sent.push({ channel, data });
      for (const h of handlers.get(channel) ?? []) h(data);
    },
    on(channel, handler) {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => {
        set.delete(handler);
      };
    },
  };
}

const LIST: LeaderBinding = { id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } };
const STOP: LeaderBinding = { id: "stop", path: [{ key: "c", label: "crew" }, { key: "x", label: "stop", tone: "exit" }], command: { name: "crew-stop" } };

const contributions = (b: ReturnType<typeof bus>) => b.sent.filter((e) => e.channel === LEADER_CONTRIBUTE).map((e) => e.data);

test("announces on create and again on every discover", () => {
  const b = bus();
  contributeLeader(b, "crew", [LIST]);
  assert.deepEqual(contributions(b), [{ source: "crew", bindings: [LIST] }]);
  b.emit(LEADER_DISCOVER, undefined);
  b.emit(LEADER_DISCOVER, undefined);
  assert.deepEqual(contributions(b), [
    { source: "crew", bindings: [LIST] },
    { source: "crew", bindings: [LIST] },
    { source: "crew", bindings: [LIST] },
  ]);
});

test("update announces the new bindings, and discover answers with the latest", () => {
  const b = bus();
  const handle = contributeLeader(b, "crew", [LIST]);
  handle.update([LIST, STOP]);
  b.emit(LEADER_DISCOVER, undefined);
  assert.deepEqual(contributions(b).slice(1), [
    { source: "crew", bindings: [LIST, STOP] },
    { source: "crew", bindings: [LIST, STOP] },
  ]);
});

test("dispose unregisters with an empty list and stops answering discover", () => {
  const b = bus();
  const handle = contributeLeader(b, "crew", [LIST]);
  handle.dispose();
  assert.deepEqual(contributions(b).at(-1), { source: "crew", bindings: [] });
  assert.equal(b.handlers.get(LEADER_DISCOVER)?.size, 0);
  const count = contributions(b).length;
  b.emit(LEADER_DISCOVER, undefined);
  handle.update([LIST]);
  handle.dispose();
  assert.equal(contributions(b).length, count);
});
