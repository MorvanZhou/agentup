/**
 * Browser Use 单例宿主：多会话 stdio 客户端共享一份上游，避免同 profile「already in use」。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, "../src/session/mcp/browser-theater/mcp-bridge.mjs");
const MOCK = path.resolve(HERE, "fixtures/browser-mcp-upstream-mock.mjs");

function writeMessage(proc: ChildProcessWithoutNullStreams, message: unknown) {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function readMessages(
  proc: ChildProcessWithoutNullStreams,
  count: number,
  timeoutMs = 12000,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const out: any[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${count} messages, got ${out.length}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const newline = buf.indexOf(0x0a);
        if (newline < 0) break;
        const line = buf.subarray(0, newline).toString("utf8").replace(/\r$/, "");
        buf = buf.subarray(newline + 1);
        if (!line.trim()) continue;
        out.push(JSON.parse(line));
        if (out.length >= count) {
          cleanup();
          resolve(out);
          return;
        }
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`client exited early code=${code}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.off("exit", onExit);
    };

    proc.stdout.on("data", onData);
    proc.on("exit", onExit);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnClient(userDataRoot: string, envExtra: Record<string, string> = {}) {
  return spawn(process.execPath, [BRIDGE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      AGENTUP_BROWSER_USER_DATA_ROOT: userDataRoot,
      AGENTUP_BROWSER_UPSTREAM_COMMAND: process.execPath,
      AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify([MOCK]),
      // 测例收尸要快；生产默认 10 分钟保活有窗 Chrome
      AGENTUP_BROWSER_HOST_IDLE_MS: "300",
      ...envExtra,
    },
  });
}

async function handshake(client: ChildProcessWithoutNullStreams, id: number) {
  // 先挂监听再写：宿主已就绪时 initialize 回包极快，后挂会丢
  const initPromise = readMessages(client, 1);
  writeMessage(client, {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    },
  });
  const init = await initPromise;
  expect(init[0]?.result?.serverInfo?.name).toBe("mock-upstream");
  writeMessage(client, { jsonrpc: "2.0", method: "notifications/initialized" });
}

function killHost(root: string) {
  const lock = path.join(root, "runtime", "browser-use.host.lock");
  try {
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

async function waitHostPort(root: string, timeoutMs = 10000) {
  const portFile = path.join(root, "runtime", "browser-use.port");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const n = Number(fs.readFileSync(portFile, "utf8").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      // not ready
    }
    await sleep(30);
  }
  throw new Error("host port file not ready");
}

async function cleanupRoot(root: string, clients: ChildProcessWithoutNullStreams[]) {
  for (const c of clients) {
    try {
      c.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  killHost(root);
  await sleep(200);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

afterEach(async () => {
  await sleep(150);
});

it(
  "two clients share one upstream — second does not hit already-in-use",
  { timeout: 20_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-singleton-"));
    const profileLock = path.join(root, "mock-profile.lock");
    const spawnLog = path.join(root, "mock-spawns.log");
    const clients: ChildProcessWithoutNullStreams[] = [];

    try {
      const a = spawnClient(root, {
        MOCK_PROFILE_LOCK: profileLock,
        MOCK_SPAWN_LOG: spawnLog,
      });
      clients.push(a);
      await waitHostPort(root);
      const b = spawnClient(root, {
        MOCK_PROFILE_LOCK: profileLock,
        MOCK_SPAWN_LOG: spawnLog,
      });
      clients.push(b);

      await handshake(a, 1);
      await handshake(b, 10);

      const raP = readMessages(a, 1);
      const rbP = readMessages(b, 1);
      writeMessage(a, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "browser_navigate", arguments: { url: "https://a.example" } },
      });
      writeMessage(b, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "browser_navigate", arguments: { url: "https://b.example" } },
      });

      const [ra] = await raP;
      const [rb] = await rbP;
      const ta = String(ra?.result?.content?.[0]?.text ?? ra?.error?.message ?? "");
      const tb = String(rb?.result?.content?.[0]?.text ?? rb?.error?.message ?? "");
      expect(ta.toLowerCase()).not.toContain("already in use");
      expect(tb.toLowerCase()).not.toContain("already in use");
      expect(ta).toContain("mock-ok");
      expect(tb).toContain("mock-ok");

      const spawns = fs.existsSync(spawnLog)
        ? fs.readFileSync(spawnLog, "utf8").trim().split("\n").filter(Boolean)
        : [];
      expect(spawns).toHaveLength(1);
    } finally {
      await cleanupRoot(root, clients);
    }
  },
);

it(
  "serializes tools/call across clients so screenshot-before-click stays ordered",
  { timeout: 20_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-serial-"));
    const orderLog = path.join(root, "order.log");
    fs.writeFileSync(orderLog, "");
    const clients: ChildProcessWithoutNullStreams[] = [];

    try {
      const a = spawnClient(root, {
        ORDER_LOG: orderLog,
        MOCK_PROFILE_LOCK: path.join(root, "lock"),
      });
      clients.push(a);
      await waitHostPort(root);
      const b = spawnClient(root, {
        ORDER_LOG: orderLog,
        MOCK_PROFILE_LOCK: path.join(root, "lock"),
      });
      clients.push(b);

      await handshake(a, 1);
      await handshake(b, 10);

      const raP = readMessages(a, 1);
      const rbP = readMessages(b, 1);
      writeMessage(a, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "browser_click", arguments: { element: "x", ref: "e1" } },
      });
      writeMessage(b, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "browser_click", arguments: { element: "y", ref: "e2" } },
      });

      await raP;
      await rbP;

      const order = fs.readFileSync(orderLog, "utf8").trim().split("\n");
      expect(order).toEqual([
        "browser_hover",
        "browser_take_screenshot",
        "browser_click",
        "browser_hover",
        "browser_take_screenshot",
        "browser_click",
      ]);
    } finally {
      await cleanupRoot(root, clients);
    }
  },
);
