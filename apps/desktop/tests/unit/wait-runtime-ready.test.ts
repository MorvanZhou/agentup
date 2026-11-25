import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const {
  runtimeReadyDeadlineMs,
  waitForOwnRuntime,
} = createRequire(import.meta.url)("../../electron/wait-runtime-ready.cjs") as {
  runtimeReadyDeadlineMs: (opts: {
    platform?: NodeJS.Platform;
    packaged?: boolean;
    env?: NodeJS.ProcessEnv;
  }) => number;
  waitForOwnRuntime: (opts: {
    runtimeUrl: string;
    runtimePort: string | number;
    isProcessExited: () => boolean;
    getExitCode: () => number | null;
    packaged: boolean;
    platform?: NodeJS.Platform;
    deadlineMs?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    expectedBackendUrl?: string;
    logError?: (msg: string) => void;
  }) => Promise<boolean>;
};

it("runtimeReadyDeadlineMs gives Windows packaged a long cold-start window", () => {
  expect(runtimeReadyDeadlineMs({ platform: "win32", packaged: true })).toBeGreaterThanOrEqual(45_000);
  expect(runtimeReadyDeadlineMs({ platform: "darwin", packaged: true })).toBeLessThan(45_000);
  expect(runtimeReadyDeadlineMs({ platform: "win32", packaged: false })).toBeLessThan(45_000);
});

it("runtimeReadyDeadlineMs respects AGENTUP_RUNTIME_READY_MS override", () => {
  expect(
    runtimeReadyDeadlineMs({
      platform: "win32",
      packaged: true,
      env: { AGENTUP_RUNTIME_READY_MS: "12345" },
    }),
  ).toBe(12345);
});

it("waitForOwnRuntime keeps polling until health ok within deadline (slow cold start)", async () => {
  // 复现 Win 日志：前 ~8s fetch failed，之后才 listening；旧 8s 门闩会误判
  let t = 0;
  let calls = 0;
  const fetchImpl = vi.fn(async () => {
    calls += 1;
    if (t < 12_000) throw new Error("fetch failed");
    return { ok: true, status: 200 } as Response;
  });
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });

  const ok = await waitForOwnRuntime({
    runtimeUrl: "http://127.0.0.1:47391",
    runtimePort: 47391,
    isProcessExited: () => false,
    getExitCode: () => null,
    packaged: true,
    platform: "win32",
    deadlineMs: 30_000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    now: () => t,
  });

  expect(ok).toBe(true);
  expect(calls).toBeGreaterThan(1);
});

it("waitForOwnRuntime fails fast when spawn already exited (EADDRINUSE path)", async () => {
  const errors: string[] = [];
  const ok = await waitForOwnRuntime({
    runtimeUrl: "http://127.0.0.1:47391",
    runtimePort: 47391,
    isProcessExited: () => true,
    getExitCode: () => 1,
    packaged: true,
    deadlineMs: 30_000,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    sleep: async () => undefined,
    now: () => 0,
    logError: (msg) => errors.push(msg),
  });
  expect(ok).toBe(false);
  expect(errors.some((line) => line.includes("spawn 已退出"))).toBe(true);
});
