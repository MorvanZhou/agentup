/**
 * Codex AskUser 走临时 MCP：HTTP tools/call 没有厂商 toolCallId，
 * 而 stream 的 mcp_tool_call.id 才是 Host completeTool 要用的 id。
 * 两边用本桥对齐（谁先到谁等）。
 */
export class CodexAskUserIdBridge {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(id: string) => void> = [];

  /** stream 见到 ask_user 启流时发布真实 id */
  publish(id: string): void {
    const trimmed = id.trim();
    if (!trimmed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(trimmed);
      return;
    }
    this.queue.push(trimmed);
  }

  /** MCP handler 取 id；若 stream 尚未到则挂起 */
  take(signal?: AbortSignal): Promise<string> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      const waiter = (id: string) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(id);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }
}
