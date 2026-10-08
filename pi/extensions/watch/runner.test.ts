import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runCheck } from "./runner.ts";

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function childPid(file: string): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.trim()) return Number(text);
    await sleep(20);
  }
  throw new Error("child never wrote its pid");
}

test("reports exit code and output", async () => {
  const result = await runCheck("echo out; echo err >&2; exit 3", tmpdir(), new AbortController().signal, 5_000);
  assert.deepEqual(result, { code: 3, stdout: "out\n", stderr: "err\n", killed: false });
});

test("abort kills the whole process group, not just bash", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "watch-runner-")), "pid");
  const controller = new AbortController();
  const done = runCheck(`sleep 30 & echo $! > ${file}; wait`, tmpdir(), controller.signal, 60_000);
  const pid = await childPid(file);
  assert.ok(alive(pid));
  controller.abort();
  const result = await done;
  assert.equal(result.killed, true);
  assert.notEqual(result.code, 0, "a killed check must not look like success");
  await sleep(50);
  assert.equal(alive(pid), false);
});

test("timeout kills the group", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "watch-runner-")), "pid");
  const result = await Promise.all([
    runCheck(`sleep 30 & echo $! > ${file}; wait`, tmpdir(), new AbortController().signal, 300),
    childPid(file),
  ]);
  assert.equal(result[0].killed, true);
  await sleep(50);
  assert.equal(alive(result[1]), false);
});

test("background processes left by a finished check are cleaned up", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "watch-runner-")), "pid");
  const result = await runCheck(`sleep 30 & echo $! > ${file}; echo done`, tmpdir(), new AbortController().signal, 5_000);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "done\n");
  const pid = await childPid(file);
  await sleep(50);
  assert.equal(alive(pid), false);
});
