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
      platform?: NodeJS.Platform;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
      logInfo?: (msg: string) => void;
      logError?: (msg: string) => void;
      execFileFn?: (
        file: string,
        args: readonly string[],
        options: { windowsHide?: boolean; timeout?: number },
        callback: (error: Error | null) => void,
      ) => void;
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
    platform: "darwin",
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
    platform: "linux",
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

it("stopChildProcess on win32 uses taskkill /T then /T /F for the process tree", async () => {
  // 打包态 runtime 也是 AgentUp.exe；只 kill 本 pid 会留下树内孤儿，NSIS 仍报无法关闭
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: string) => boolean;
  };
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn();

  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const setTimeoutFn = ((fn: () => void, ms: number) => {
    timers.push({ ms, fn });
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;

  const execFileFn = (
    file: string,
    args: readonly string[],
    _options: { windowsHide?: boolean; timeout?: number },
    callback: (error: Error | null) => void,
  ) => {
    calls.push({ file, args });
    callback(null);
    if (args.includes("/F")) {
      child.exitCode = 1;
      queueMicrotask(() => child.emit("exit", 1, null));
    }
  };

  const done = stopChildProcess(child, {
    forceMs: 100,
    hardMs: 200,
    platform: "win32",
    setTimeoutFn,
    clearTimeoutFn,
    execFileFn,
  });

  expect(child.kill).not.toHaveBeenCalled();
  expect(calls).toEqual([{ file: "taskkill", args: ["/T", "/PID", "4242"] }]);

  const force = timers.find((t) => t.ms === 100);
  expect(force).toBeTruthy();
  force!.fn();
  await done;

  expect(calls).toEqual([
    { file: "taskkill", args: ["/T", "/PID", "4242"] },
    { file: "taskkill", args: ["/F", "/T", "/PID", "4242"] },
  ]);
});
