import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, "../src/session/mcp/browser-theater/mcp-bridge.mjs");
const MOCK = path.resolve(HERE, "fixtures/browser-mcp-upstream-mock.mjs");

function writeMessage(proc: ChildProcessWithoutNullStreams, message: unknown) {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function readMessages(
  proc: ChildProcessWithoutNullStreams,
  count: number,
  timeoutMs = 8000,
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
      reject(new Error(`bridge exited early code=${code}`));
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

it("relaunches upstream after it exits so the next browser call still works", async () => {
  const genFile = path.join(os.tmpdir(), `agentup-mock-gen-${process.pid}.txt`);
  fs.writeFileSync(genFile, "1");

  // 包装 mock：每次启动递增 generation，第一次 tools/call 后退出
  const launcher = path.join(os.tmpdir(), `agentup-mock-launcher-${process.pid}.mjs`);
  fs.writeFileSync(
    launcher,
    `
import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
const genFile = ${JSON.stringify(genFile)};
const mock = ${JSON.stringify(MOCK)};
let gen = Number(fs.readFileSync(genFile, "utf8") || "1");
fs.writeFileSync(genFile, String(gen + 1));
const child = spawn(process.execPath, [mock], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    MOCK_GENERATION: String(gen),
    EXIT_AFTER_TOOLS_CALL: gen === 1 ? "1" : "0",
  },
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
`,
  );

  const bridge = spawn(process.execPath, [BRIDGE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      AGENTUP_BROWSER_UPSTREAM_COMMAND: process.execPath,
      AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify([launcher]),
    },
  });

  try {
    writeMessage(bridge, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });
    const initMsgs = await readMessages(bridge, 1);
    expect(initMsgs[0]?.result?.serverInfo?.name).toBe("mock-upstream");

    writeMessage(bridge, { jsonrpc: "2.0", method: "notifications/initialized" });

    writeMessage(bridge, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "browser_navigate", arguments: { url: "https://example.com" } },
    });
    const first = await readMessages(bridge, 1);
    expect(String(first[0]?.result?.content?.[0]?.text ?? "")).toContain("generation=1");

    // 等第一次上游退出；bridge 应仍存活
    await sleep(200);
    expect(bridge.exitCode).toBeNull();

    writeMessage(bridge, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "browser_navigate", arguments: { url: "https://example.com/again" } },
    });
    const second = await readMessages(bridge, 1, 12000);
    expect(String(second[0]?.result?.content?.[0]?.text ?? "")).toContain("generation=2");
    expect(bridge.exitCode).toBeNull();
  } finally {
    bridge.kill("SIGTERM");
    try {
      fs.unlinkSync(launcher);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(genFile);
    } catch {
      // ignore
    }
  }
});

it("screenshots before click so bubble replay keeps the pre-navigation page", async () => {
  const orderLog = path.join(os.tmpdir(), `agentup-shot-order-${process.pid}.txt`);
  try {
    fs.writeFileSync(orderLog, "");
  } catch {
    // ignore
  }

  const bridge = spawn(process.execPath, [BRIDGE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      AGENTUP_BROWSER_UPSTREAM_COMMAND: process.execPath,
      AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify([MOCK]),
      ORDER_LOG: orderLog,
    },
  });

  try {
    writeMessage(bridge, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    });
    await readMessages(bridge, 1);
    writeMessage(bridge, { jsonrpc: "2.0", method: "notifications/initialized" });

    writeMessage(bridge, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "browser_click", arguments: { element: "link", ref: "e1" } },
    });
    const result = await readMessages(bridge, 1);
    const content = result[0]?.result?.content ?? [];
    const images = content.filter((part: any) => part?.type === "image");
    expect(images.length).toBe(1);
    expect(Buffer.from(images[0].data, "base64").toString("utf8")).toContain("pre-action-shot");

    // 有 element/ref：先 hover 到位（剧场指针跟上）→ 再截图 → 再 click
    const order = fs.readFileSync(orderLog, "utf8").trim().split("\n");
    expect(order).toEqual(["browser_hover", "browser_take_screenshot", "browser_click"]);
  } finally {
    bridge.kill("SIGTERM");
    try {
      fs.unlinkSync(orderLog);
    } catch {
      // ignore
    }
  }
});

it(
  "speaks NDJSON with real @playwright/mcp initialize (headed args via isolated)",
  // npx 冷启动 / 拉包常 > Vitest 默认 5s；与下方 readMessages 对齐
  { timeout: 30_000 },
  async () => {
    // 生产 Win 走本地 cli.js（禁 npx.cmd）；本测用 npx 拉真包，Win 上 .cmd 无 shell 即 exit 1。
    if (process.platform === "win32") return;
    // 锁契约：bridge 与 Playwright MCP 都能用换行 JSON 握手（Content-Length 会卡死）
    const bridge = spawn(process.execPath, [BRIDGE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // 部分镜像（如 npmmirror）对 @playwright/mcp 返回 403；测例直连 npmjs
        npm_config_registry: "https://registry.npmjs.org",
        AGENTUP_BROWSER_UPSTREAM_COMMAND: "npx",
        AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify([
          "-y",
          "@playwright/mcp@0.0.46",
          "--browser",
          "chrome",
          "--isolated",
          "--headless",
        ]),
      },
    });

    try {
      writeMessage(bridge, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      });
      const initMsgs = await readMessages(bridge, 1, 25_000);
      expect(initMsgs[0]?.result?.serverInfo?.name).toBe("Playwright");
    } finally {
      bridge.kill("SIGTERM");
    }
  },
);
