import { afterEach, expect, it, vi } from "vitest";

import {
  acquireAgentSdkRuntime,
  agentSdkRuntimeKey,
  agentSdkRuntimePoolSizeForTests,
  disposeAgentSdkRuntime,
  disposeAgentSdkRuntimesForTemplate,
  disposeAllAgentSdkRuntimes,
  releaseAgentSdkRuntime,
  resetAgentSdkRuntimePoolForTests,
} from "../src/session/external/sdk/host/runtime-pool.js";

afterEach(() => {
  resetAgentSdkRuntimePoolForTests();
  vi.useRealTimers();
});

it("同 key 第二次 acquire 复用 create 结果", async () => {
  let creates = 0;
  const factory = {
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "fp1"),
    create: async () => {
      creates += 1;
      return { id: creates };
    },
    destroy: vi.fn(async () => undefined),
    idleMs: 60_000,
  };
  const a = await acquireAgentSdkRuntime(factory);
  const b = await acquireAgentSdkRuntime(factory);
  expect(creates).toBe(1);
  expect(a.value).toBe(b.value);
  a.release();
  b.release();
});

it("refcount 归零后 idle 到期才 destroy", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn(async () => undefined);
  const factory = {
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "fp"),
    create: async () => ({ ok: true }),
    destroy,
    idleMs: 10_000,
  };
  const lease = await acquireAgentSdkRuntime(factory);
  lease.release();
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(9_999);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(agentSdkRuntimePoolSizeForTests()).toBe(0);
});

it("idle 内再 acquire 取消回收并重置计时", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn(async () => undefined);
  const factory = {
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "fp"),
    create: async () => ({ ok: true }),
    destroy,
    idleMs: 10_000,
  };
  const first = await acquireAgentSdkRuntime(factory);
  first.release();
  await vi.advanceTimersByTimeAsync(9_000);
  const second = await acquireAgentSdkRuntime(factory);
  expect(destroy).not.toHaveBeenCalled();
  second.release();
  await vi.advanceTimersByTimeAsync(9_000);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(destroy).toHaveBeenCalledTimes(1);
});

it("fingerprint 不同是两个槽；dispose template 清掉全部", async () => {
  const destroy = vi.fn(async () => undefined);
  const a = await acquireAgentSdkRuntime({
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "cwd-a"),
    create: async () => ({ n: "a" }),
    destroy,
    idleMs: 60_000,
  });
  const b = await acquireAgentSdkRuntime({
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "cwd-b"),
    create: async () => ({ n: "b" }),
    destroy,
    idleMs: 60_000,
  });
  expect(a.value).not.toBe(b.value);
  expect(agentSdkRuntimePoolSizeForTests()).toBe(2);
  a.release();
  b.release();
  await disposeAgentSdkRuntimesForTemplate("/data", "copilot-sdk");
  expect(agentSdkRuntimePoolSizeForTests()).toBe(0);
  expect(destroy).toHaveBeenCalledTimes(2);
});

it("dispose / disposeAll 立刻 destroy", async () => {
  const destroy = vi.fn(async () => undefined);
  const key = agentSdkRuntimeKey("/data", "opencode-sdk", "x");
  await acquireAgentSdkRuntime({
    key,
    create: async () => ({ ok: true }),
    destroy,
    idleMs: 60_000,
  });
  await disposeAgentSdkRuntime(key);
  expect(destroy).toHaveBeenCalledTimes(1);
  await acquireAgentSdkRuntime({
    key: agentSdkRuntimeKey("/data", "codex-sdk", "y"),
    create: async () => ({ ok: true }),
    destroy,
    idleMs: 60_000,
  });
  await disposeAllAgentSdkRuntimes();
  expect(agentSdkRuntimePoolSizeForTests()).toBe(0);
});

it("并发 acquire 只 create 一次", async () => {
  let creates = 0;
  let resolveCreate!: (value: { id: number }) => void;
  const pending = new Promise<{ id: number }>((resolve) => {
    resolveCreate = resolve;
  });
  const factory = {
    key: agentSdkRuntimeKey("/data", "copilot-sdk", "race"),
    create: async () => {
      creates += 1;
      return pending;
    },
    destroy: async () => undefined,
    idleMs: 60_000,
  };
  const p1 = acquireAgentSdkRuntime(factory);
  const p2 = acquireAgentSdkRuntime(factory);
  resolveCreate({ id: 1 });
  const [a, b] = await Promise.all([p1, p2]);
  expect(creates).toBe(1);
  expect(a.value).toBe(b.value);
  a.release();
  b.release();
});

it("releaseAgentSdkRuntime 与 lease.release 等价", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn(async () => undefined);
  const key = agentSdkRuntimeKey("/data", "copilot-sdk", "manual");
  await acquireAgentSdkRuntime({
    key,
    create: async () => ({ ok: true }),
    destroy,
    idleMs: 1_000,
  });
  releaseAgentSdkRuntime(key);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(destroy).toHaveBeenCalledTimes(1);
});
