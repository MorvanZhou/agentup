import type { ChildProcess } from "node:child_process";

import { spawnOpencode } from "./load.js";

export interface OpencodeServer {
  url: string;
  close(): Promise<void>;
}

/** 每次使用独立 serve；端口 0 由 OS 分配，绝不默默回退到 4096。 */
export async function startOpencodeServer(input: {
  userDataRoot: string;
  templateId: string;
  cwd?: string;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<OpencodeServer> {
  const child = spawnOpencode(
    input.userDataRoot,
    input.templateId,
    ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: input.cwd,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const url = await waitForServerUrl(child, input.timeoutMs ?? 15_000, input.signal);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    stopChild(child);
  };
  input.signal?.addEventListener("abort", () => void close(), { once: true });
  return { url, close };
}

function waitForServerUrl(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        stopChild(child);
        reject(error);
      } else {
        resolve(url!);
      }
    };
    const ingest = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-16_384);
      const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
      const match = plain.match(
        /opencode server listening on\s+(https?:\/\/127\.0\.0\.1:\d+)/i,
      );
      if (match?.[1]) finish(undefined, match[1]);
    };
    child.stdout?.on("data", ingest);
    child.stderr?.on("data", ingest);
    child.on("error", () => finish(new Error("无法启动 OpenCode 服务")));
    child.on("exit", (code) => {
      finish(new Error(`OpenCode 服务启动失败（退出码 ${code ?? "未知"}）`));
    });
    const onAbort = () =>
      finish(Object.assign(new Error("aborted"), { name: "AbortError" }));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => finish(new Error("等待 OpenCode 服务启动超时")),
      timeoutMs,
    );
  });
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* 已退出。 */
  }
}
