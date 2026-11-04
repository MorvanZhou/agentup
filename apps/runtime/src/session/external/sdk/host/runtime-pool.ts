import { AGENT_SDK_RUNTIME_IDLE_MS } from "./types.js";

/**
 * 本地 Agent App 进程保活池：只缓存 Client/CLI/serve，不缓存厂商 session。
 * 文档：docs/ARCHITECTURE/agent-sdk-runtime-pool.md
 */

export type AgentSdkRuntimeFactory<T> = {
  /** 稳定键；建议 agentSdkRuntimeKey(...) */
  key: string;
  create: () => Promise<T>;
  destroy: (value: T) => Promise<void> | void;
  /** 测试可注入；默认 AGENT_SDK_RUNTIME_IDLE_MS */
  idleMs?: number;
};

export type AgentSdkRuntimeLease<T> = {
  value: T;
  /** 回合结束调用：refcount--；归零后启动闲置回收 */
  release: () => void;
};

type Entry = {
  key: string;
  value: unknown;
  destroy: (value: unknown) => Promise<void> | void;
  refcount: number;
  idleMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  creating: Promise<unknown> | null;
};

const entries = new Map<string, Entry>();

/** userDataRoot + templateId + 可选 fingerprint（cwd / token 等）。 */
export function agentSdkRuntimeKey(
  userDataRoot: string,
  templateId: string,
  fingerprint = "",
): string {
  return `${userDataRoot}\0${templateId}\0${fingerprint}`;
}

/** 按 templateId 前缀匹配销毁（logout / 换 token 时 fingerprint 可能已变）。 */
export function agentSdkRuntimeKeyPrefix(userDataRoot: string, templateId: string): string {
  return `${userDataRoot}\0${templateId}\0`;
}

export async function acquireAgentSdkRuntime<T>(
  factory: AgentSdkRuntimeFactory<T>,
): Promise<AgentSdkRuntimeLease<T>> {
  const idleMs = factory.idleMs ?? AGENT_SDK_RUNTIME_IDLE_MS;
  let entry = entries.get(factory.key);

  if (entry?.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  if (!entry) {
    entry = {
      key: factory.key,
      value: undefined,
      destroy: factory.destroy as (value: unknown) => Promise<void> | void,
      refcount: 0,
      idleMs,
      idleTimer: null,
      creating: null,
    };
    entries.set(factory.key, entry);
  } else {
    entry.destroy = factory.destroy as (value: unknown) => Promise<void> | void;
    entry.idleMs = idleMs;
  }

  if (entry.value === undefined) {
    if (!entry.creating) {
      entry.creating = Promise.resolve()
        .then(() => factory.create())
        .then((value) => {
          entry!.value = value;
          entry!.creating = null;
          return value;
        })
        .catch((error) => {
          entry!.creating = null;
          entries.delete(factory.key);
          throw error;
        });
    }
    await entry.creating;
  }

  entry.refcount += 1;
  const key = factory.key;
  let released = false;
  return {
    value: entry.value as T,
    release: () => {
      if (released) return;
      released = true;
      releaseAgentSdkRuntime(key);
    },
  };
}

export function releaseAgentSdkRuntime(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.refcount = Math.max(0, entry.refcount - 1);
  if (entry.refcount > 0) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    void disposeAgentSdkRuntime(key);
  }, entry.idleMs);
  // 允许进程在 idle 期间被 GC 测到；unref 避免拖住 runtime 退出（Node）
  entry.idleTimer.unref?.();
}

export async function disposeAgentSdkRuntime(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  const value = entry.value;
  entry.value = undefined;
  entry.refcount = 0;
  if (value !== undefined) {
    await Promise.resolve(entry.destroy(value)).catch(() => undefined);
  }
}

/** 销毁该 template 下所有 fingerprint 的实例。 */
export async function disposeAgentSdkRuntimesForTemplate(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  const prefix = agentSdkRuntimeKeyPrefix(userDataRoot, templateId);
  const keys = [...entries.keys()].filter((key) => key.startsWith(prefix));
  await Promise.all(keys.map((key) => disposeAgentSdkRuntime(key)));
}

export async function disposeAllAgentSdkRuntimes(): Promise<void> {
  const keys = [...entries.keys()];
  await Promise.all(keys.map((key) => disposeAgentSdkRuntime(key)));
}

/** 测例用：清空池状态（不调用 destroy）。 */
export function resetAgentSdkRuntimePoolForTests(): void {
  for (const entry of entries.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
  }
  entries.clear();
}

/** 测例用：当前池内条目数。 */
export function agentSdkRuntimePoolSizeForTests(): number {
  return entries.size;
}
