import { randomUUID } from "node:crypto";

import type { ShellHangDecision, ShellHangRequest } from "./types.js";

/**
 * 阻塞 shell 过久时的 HITL（仅内存，不落盘）。
 * 进程退出后命令已死，无需持久化孤儿请求。
 */
export class ShellHangBroker {
  private readonly pending = new Map<
    string,
    {
      request: ShellHangRequest;
      resolve: (decision: ShellHangDecision | undefined) => void;
    }
  >();
  private readonly listeners = new Set<(request: ShellHangRequest) => void>();

  request(request: Omit<ShellHangRequest, "id">): Promise<ShellHangDecision | undefined> {
    const value: ShellHangRequest = { ...request, id: randomUUID() };
    return new Promise((resolve) => {
      this.pending.set(value.id, { request: value, resolve });
      for (const listener of this.listeners) listener(value);
    });
  }

  decide(id: string, decision: ShellHangDecision): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.resolve(decision);
    return true;
  }

  /** 工具已结束：取消对应悬空询问（不杀进程）。 */
  cancelForToolCall(toolCallId: string): void {
    for (const [id, pending] of [...this.pending.entries()]) {
      if (pending.request.toolCallId !== toolCallId) continue;
      this.pending.delete(id);
      pending.resolve(undefined);
    }
  }

  listPending(userId: string): ShellHangRequest[] {
    const out: ShellHangRequest[] = [];
    for (const { request } of this.pending.values()) {
      if (request.userId === userId) out.push(request);
    }
    return out;
  }

  subscribe(listener: (request: ShellHangRequest) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
