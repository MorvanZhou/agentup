import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { childAlive, stopChildProcess } = createRequire(import.meta.url)(
  "../../electron/stop-child.cjs",
) as {
  childAlive: (child: { exitCode: number | null; signalCode: NodeJS.Signals | null }) => boolean;
  stopChildProcess: (
    child: EventEmitter & {
      pid?: number;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: (signal?: string) => boolean;
    } | null,
    options?: {
      forceMs?: number;
      hardMs?: number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
      logInfo?: (msg: string) => void;
      logError?: (msg: string) => void;
    },
  ) => Promise<void>;
};

function fakeChild(pid = 42) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: string) => boolean;
  };
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal?: string) => {
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      child.exitCode = signal === "SIGKILL" ? null : 0;
      child.signalCode = signal as NodeJS.Signals;
      queueMicrotask(() => child.emit("exit", child.exitCode, child.signalCode));
    }
    return true;
  });
  return child;
}

it("childAlive is false after exit codes are set", () => {
  expect(childAlive({ exitCode: null, signalCode: null })).toBe(true);
  expect(childAlive({ exitCode: 0, signalCode: null })).toBe(false);
  expect(childAlive({ exitCode: null, signalCode: "SIGTERM" })).toBe(false);
});

it("stopChildProcess no-ops for null or already-dead child", async () => {
  await stopChildProcess(null);
  const dead = fakeChild();
  dead.exitCode = 0;
  await stopChildProcess(dead);
  expect(dead.kill).not.toHaveBeenCalled();
});

it("stopChildProcess sends SIGTERM and resolves on exit", async () => {
  const child = fakeChild(99);
  const logs: string[] = [];
  await stopChildProcess(child, {
    forceMs: 10_000,
    hardMs: 10_000,
    logInfo: (msg) => logs.push(msg),
  });
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
  expect(logs.some((line) => line.includes("SIGTERM"))).toBe(true);
});

it("stopChildProcess escalates to SIGKILL after forceMs", async () => {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: string) => boolean;
  };
  child.pid = 7;
  child.exitCode = null;
  child.signalCode = null;
  const signals: string[] = [];
  child.kill = vi.fn((signal?: string) => {
    signals.push(signal ?? "");
    if (signal === "SIGKILL") {
      child.signalCode = "SIGKILL";
      queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
    }
    return true;
  });

  const timers: Array<{ ms: number; fn: () => void }> = [];
  const setTimeoutFn = ((fn: () => void, ms: number) => {
    timers.push({ ms, fn });
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;

  const done = stopChildProcess(child, {
    forceMs: 100,
    hardMs: 200,
    setTimeoutFn,
    clearTimeoutFn,
  });

  expect(signals).toEqual(["SIGTERM"]);
  const force = timers.find((t) => t.ms === 100);
  expect(force).toBeTruthy();
  force!.fn();
  await done;
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});
