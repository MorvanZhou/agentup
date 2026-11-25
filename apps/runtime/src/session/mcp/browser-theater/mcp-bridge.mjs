#!/usr/bin/env node
/**
 * AgentUp Browser Use MCP bridge：
 * - 转发 @playwright/mcp stdio（NDJSON 行协议，与 Pi / Playwright MCP 一致）
 * - click/type 等：在动作前先 browser_take_screenshot（避免跳转后才拍到新页），图片并入工具结果供气泡回放
 * - 用户关掉真窗导致上游退出时：bridge 不跟着死；下次请求自动重拉上游并重握手
 *
 * env:
 *   AGENTUP_BROWSER_UPSTREAM_COMMAND  上游命令（Desktop 注入 node / npx-cli；勿用 npx.cmd）
 *   AGENTUP_BROWSER_UPSTREAM_ARGS_JSON  JSON 字符串数组，上游 args
 */
import { spawn } from "node:child_process";
import process from "node:process";

const ACTION_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_fill_form",
  "browser_select_option",
  "browser_hover",
  "browser_drag",
]);

const upstreamCommand =
  process.env.AGENTUP_BROWSER_UPSTREAM_COMMAND ||
  (process.platform === "win32" ? process.execPath : "npx");
let upstreamArgs = [];
try {
  upstreamArgs = JSON.parse(process.env.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON || "[]");
} catch {
  upstreamArgs = [];
}
if (!Array.isArray(upstreamArgs) || upstreamArgs.length === 0) {
  console.error("AGENTUP_BROWSER_UPSTREAM_ARGS_JSON missing");
  process.exit(1);
}

/** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
let child = null;
let childGeneration = 0;
/** 是否已成功完成过 initialize（之后上游退出只软重启，不杀 bridge）。 */
let everReady = false;
let shuttingDown = false;
/** @type {Promise<void> | null} */
let starting = null;

/** @type {{ initializeRequest: any, initializedNotification: any | null } | null} */
let handshake = null;

/** @type {Buffer} */
let incoming = Buffer.alloc(0);
/** @type {Buffer} */
let fromChild = Buffer.alloc(0);

/** @type {Map<number|string, { kind: 'pass' } | { kind: 'action', originalId: number|string, name: string, preShot: any | null } | { kind: 'screenshot' } | { kind: 'rehandshake', resolve: (v:any)=>void, reject:(e:Error)=>void }>} */
const pending = new Map();
let nextBridgeId = 1e9;
/** @type {Map<number|string, { resolve: (v:any)=>void, reject:(e:Error)=>void }>} */
const waitingScreenshot = new Map();

/** 串行处理客户端消息，避免重拉上游时交错。 */
let clientChain = Promise.resolve();

/** Pi / Playwright MCP：一行一条 JSON-RPC。 */
function writeMessage(stream, message) {
  if (!stream || stream.destroyed) return;
  stream.write(`${JSON.stringify(message)}\n`);
}

function parseMessages(buffer) {
  const messages = [];
  let rest = buffer;
  while (true) {
    const newline = rest.indexOf(0x0a);
    if (newline < 0) break;
    const line = rest.subarray(0, newline).toString("utf8").replace(/\r$/, "");
    rest = rest.subarray(newline + 1);
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // skip bad line
    }
  }
  return { messages, rest };
}

function isToolError(result) {
  if (!result || typeof result !== "object") return true;
  if (result.isError === true) return true;
  const content = result.content;
  if (!Array.isArray(content)) return false;
  const text = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return /^### Result\s*\nError:/m.test(text) || /^Error:\s*/m.test(text);
}

function extractImages(result) {
  if (!result || typeof result !== "object") return [];
  const content = result.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part) =>
      part &&
      part.type === "image" &&
      typeof part.data === "string" &&
      part.data &&
      typeof part.mimeType === "string",
  );
}

function mergeScreenshot(actionResult, shotResult) {
  const images = extractImages(shotResult);
  if (images.length === 0) return actionResult;
  const base =
    actionResult && typeof actionResult === "object"
      ? { ...actionResult }
      : { content: [{ type: "text", text: String(actionResult ?? "") }] };
  const content = Array.isArray(base.content) ? [...base.content] : [];
  // 去掉旧图，避免重复；保留动作文本
  const withoutImages = content.filter((part) => !part || part.type !== "image");
  base.content = [...withoutImages, ...images];
  return base;
}

function failPending(reason) {
  for (const [id, waiter] of waitingScreenshot) {
    waitingScreenshot.delete(id);
    waiter.resolve(null);
  }
  for (const [id, meta] of pending) {
    pending.delete(id);
    if (meta.kind === "rehandshake") {
      meta.reject(new Error(reason));
      continue;
    }
    if (meta.kind === "screenshot") continue;
    const clientId = meta.kind === "action" ? meta.originalId : id;
    writeMessage(process.stdout, {
      jsonrpc: "2.0",
      id: clientId,
      error: { code: -32000, message: reason },
    });
  }
}

function attachChild(next) {
  const generation = ++childGeneration;
  child = next;
  fromChild = Buffer.alloc(0);

  next.on("error", (error) => {
    if (generation !== childGeneration) return;
    console.error("browser mcp upstream failed", error);
    if (!everReady) {
      process.exit(1);
    }
    child = null;
    failPending(`Browser MCP upstream error: ${error instanceof Error ? error.message : String(error)}`);
  });

  next.on("exit", (code, signal) => {
    if (generation !== childGeneration) return;
    child = null;
    fromChild = Buffer.alloc(0);
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }
    if (!everReady) {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 1);
      return;
    }
    // 真窗关掉等导致上游退出：保持 bridge，下次请求再拉起
    console.error(
      `browser mcp upstream exited (code=${code ?? "null"} signal=${signal ?? "null"}); will relaunch on next request`,
    );
    failPending("Browser window closed; AgentUp will relaunch Browser Use on the next tool call.");
  });

  next.stdout.on("data", onChildData);
}

function spawnUpstream() {
  // 禁止 shell:true：Windows 会经 cmd.exe 弹黑框；上游应为 node + npx-cli.js
  const next = spawn(upstreamCommand, upstreamArgs, {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
    windowsHide: process.platform === "win32" && process.env.AGENTUP_HIDDEN_CONSOLE !== "1",
  });
  attachChild(next);
  return next;
}

function rehandshakeWithUpstream() {
  if (!handshake?.initializeRequest || !child) {
    return Promise.resolve();
  }
  const request = handshake.initializeRequest;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request.id);
      reject(new Error("Browser MCP rehandshake timed out"));
    }, 30000);
    pending.set(request.id, {
      kind: "rehandshake",
      resolve: (message) => {
        clearTimeout(timer);
        if (message?.error) {
          reject(new Error(message.error.message || "rehandshake failed"));
          return;
        }
        if (handshake?.initializedNotification) {
          writeMessage(child.stdin, handshake.initializedNotification);
        }
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    writeMessage(child.stdin, request);
  });
}

async function ensureUpstream() {
  if (child && !child.killed) return;
  if (starting) {
    await starting;
    return;
  }
  starting = (async () => {
    spawnUpstream();
    if (everReady && handshake?.initializeRequest) {
      await rehandshakeWithUpstream();
    }
  })().finally(() => {
    starting = null;
  });
  await starting;
}

function requestScreenshot() {
  const id = nextBridgeId++;
  return new Promise((resolve) => {
    if (!child?.stdin) {
      resolve(null);
      return;
    }
    waitingScreenshot.set(id, {
      resolve,
      reject: () => resolve(null),
    });
    pending.set(id, { kind: "screenshot" });
    writeMessage(child.stdin, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "browser_take_screenshot",
        arguments: {},
      },
    });
    setTimeout(() => {
      if (!waitingScreenshot.has(id)) return;
      waitingScreenshot.delete(id);
      pending.delete(id);
      resolve(null);
    }, 12000);
  });
}

async function handleChildMessage(message) {
  if (message && Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
    const meta = pending.get(message.id);
    pending.delete(message.id);

    if (meta.kind === "rehandshake") {
      meta.resolve(message);
      return;
    }

    if (meta.kind === "pass") {
      if (handshake && message.id === handshake.initializeRequest?.id && message.result) {
        everReady = true;
      }
      writeMessage(process.stdout, message);
      return;
    }

    if (meta.kind === "screenshot") {
      const waiter = waitingScreenshot.get(message.id);
      waitingScreenshot.delete(message.id);
      if (waiter) waiter.resolve(message.result ?? null);
      return;
    }

    // 动作工具：并入动作前截图（跳转前页面），勿在动作后再拍
    const result = message.result;
    if (!isToolError(result) && meta.preShot) {
      writeMessage(process.stdout, {
        ...message,
        id: meta.originalId,
        result: mergeScreenshot(result, meta.preShot),
      });
      return;
    }
    writeMessage(process.stdout, { ...message, id: meta.originalId });
    return;
  }

  writeMessage(process.stdout, message);
}

async function handleClientMessage(message) {
  try {
    await ensureUpstream();
  } catch (error) {
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      writeMessage(process.stdout, {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return;
  }

  if (message?.method === "initialize") {
    handshake = {
      initializeRequest: message,
      initializedNotification: handshake?.initializedNotification ?? null,
    };
  } else if (message?.method === "notifications/initialized") {
    if (!handshake) {
      handshake = { initializeRequest: null, initializedNotification: message };
    } else {
      handshake.initializedNotification = message;
    }
  }

  if (
    message &&
    message.method === "tools/call" &&
    message.params &&
    typeof message.params.name === "string" &&
    ACTION_TOOLS.has(message.params.name)
  ) {
    // 先截当前页再点：click 常触发导航，事后截会落到跳转后页面
    let preShot = null;
    try {
      preShot = await requestScreenshot();
    } catch {
      preShot = null;
    }
    pending.set(message.id, {
      kind: "action",
      originalId: message.id,
      name: message.params.name,
      preShot,
    });
  } else if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
    pending.set(message.id, { kind: "pass" });
  }

  if (!child?.stdin) {
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      writeMessage(process.stdout, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: "Browser MCP upstream unavailable" },
      });
    }
    return;
  }
  writeMessage(child.stdin, message);
}

function onClientData(chunk) {
  incoming = Buffer.concat([incoming, chunk]);
  const parsed = parseMessages(incoming);
  incoming = parsed.rest;
  for (const message of parsed.messages) {
    clientChain = clientChain.then(() => handleClientMessage(message)).catch((error) => {
      console.error("browser mcp bridge client handler failed", error);
    });
  }
}

function onChildData(chunk) {
  fromChild = Buffer.concat([fromChild, chunk]);
  const parsed = parseMessages(fromChild);
  fromChild = parsed.rest;
  for (const message of parsed.messages) {
    void handleChildMessage(message);
  }
}

process.stdin.on("data", onClientData);
process.stdin.on("end", () => {
  shuttingDown = true;
  try {
    child?.stdin?.end();
  } catch {
    // ignore
  }
  try {
    child?.kill("SIGTERM");
  } catch {
    // ignore
  }
});

// 先拉起上游；首连失败则退出，让 Pi 标 failed
spawnUpstream();
