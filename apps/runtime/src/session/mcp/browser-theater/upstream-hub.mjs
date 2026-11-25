/**
 * 独占一份 @playwright/mcp 上游：握手、关窗重连、动作前 hover+截图、跨客户端串行。
 */
import { spawn } from "node:child_process";
import process from "node:process";

import {
  isToolError,
  mergeScreenshot,
  parseMessages,
  sleep,
  writeMessage,
} from "./ndjson.mjs";

const ACTION_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_fill_form",
  "browser_select_option",
  "browser_hover",
  "browser_drag",
]);

/** 截图前先 hover，让剧场指针出现在目标上（hover 本身不再套一层）。 */
const HOVER_BEFORE_SHOT = new Set([
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_select_option",
  "browser_drag",
]);

/**
 * @typedef {{
 *   kind: 'pass' | 'action' | 'screenshot' | 'rehandshake' | 'internal',
 *   reply?: (msg: any) => void,
 *   originalId?: number|string,
 *   name?: string,
 *   preShot?: any,
 *   resolve?: (v: any) => void,
 *   reject?: (e: Error) => void,
 * }} PendingMeta
 */

/**
 * @param {{
 *   upstreamCommand: string,
 *   upstreamArgs: string[],
 *   mode: 'standalone' | 'host',
 * }} opts
 */
export function createUpstreamHub(opts) {
  const { upstreamCommand, upstreamArgs, mode } = opts;

  /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
  let child = null;
  let childGeneration = 0;
  let everReady = false;
  let upstreamInitialized = false;
  let shuttingDown = false;
  /** @type {Promise<void> | null} */
  let starting = null;
  /** @type {Promise<any> | null} */
  let initializing = null;
  /** @type {{ initializeRequest: any, initializedNotification: any | null, result: any | null } | null} */
  let handshake = null;
  /** @type {Buffer} */
  let fromChild = Buffer.alloc(0);
  /** @type {Map<number|string, PendingMeta>} */
  const pending = new Map();
  let nextBridgeId = 1e9;
  /** @type {Map<number|string, { resolve: (v:any)=>void, reject:(e:Error)=>void }>} */
  const waitingScreenshot = new Map();
  let upstreamChain = Promise.resolve();

  function failPending(reason) {
    for (const [id, waiter] of waitingScreenshot) {
      waitingScreenshot.delete(id);
      waiter.resolve(null);
    }
    for (const [id, meta] of pending) {
      pending.delete(id);
      if (meta.kind === "rehandshake") {
        meta.reject?.(new Error(reason));
        continue;
      }
      if (meta.kind === "screenshot") continue;
      if (meta.kind === "internal") {
        meta.reject?.(new Error(reason));
        continue;
      }
      const clientId = meta.kind === "action" ? meta.originalId : id;
      meta.reply?.({
        jsonrpc: "2.0",
        id: clientId,
        error: { code: -32000, message: reason },
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

  function attachChild(next) {
    const generation = ++childGeneration;
    child = next;
    fromChild = Buffer.alloc(0);

    next.on("error", (error) => {
      if (generation !== childGeneration) return;
      console.error("browser mcp upstream failed", error);
      if (!everReady && mode === "standalone") {
        process.exit(1);
      }
      child = null;
      failPending(
        `Browser MCP upstream error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    next.on("exit", (code, signal) => {
      if (generation !== childGeneration) return;
      child = null;
      fromChild = Buffer.alloc(0);
      if (shuttingDown) {
        if (mode === "host" || mode === "standalone") process.exit(code ?? 0);
        return;
      }
      if (!everReady && mode === "standalone") {
        if (signal) process.kill(process.pid, signal);
        process.exit(code ?? 1);
        return;
      }
      console.error(
        `browser mcp upstream exited (code=${code ?? "null"} signal=${signal ?? "null"}); will relaunch on next request`,
      );
      if (handshake) handshake.result = null;
      everReady = false;
      upstreamInitialized = false;
      failPending("Browser window closed; AgentUp will relaunch Browser Use on the next tool call.");
    });

    next.stdout.on("data", onChildData);
  }

  function spawnUpstream() {
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
          handshake.result = message.result ?? null;
          everReady = true;
          if (handshake?.initializedNotification) {
            writeMessage(child.stdin, handshake.initializedNotification);
            upstreamInitialized = true;
          } else {
            upstreamInitialized = false;
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
      if (handshake?.initializeRequest) {
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

  function requestHoverForShot(args) {
    const id = nextBridgeId++;
    return new Promise((resolve) => {
      if (!child?.stdin || !args || typeof args !== "object") {
        resolve(null);
        return;
      }
      const element = typeof args.element === "string" ? args.element : undefined;
      const ref = typeof args.ref === "string" ? args.ref : undefined;
      if (!ref && !element) {
        resolve(null);
        return;
      }
      const hoverArgs = {};
      if (element) hoverArgs.element = element;
      if (ref) hoverArgs.ref = ref;
      pending.set(id, {
        kind: "internal",
        resolve: () => resolve(true),
        reject: () => resolve(null),
      });
      writeMessage(child.stdin, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "browser_hover",
          arguments: hoverArgs,
        },
      });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve(null);
      }, 8000);
    });
  }

  async function handleChildMessage(message) {
    if (message && Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
      const meta = pending.get(message.id);
      pending.delete(message.id);

      if (meta.kind === "rehandshake") {
        meta.resolve?.(message);
        return;
      }

      if (meta.kind === "pass") {
        if (handshake && message.id === handshake.initializeRequest?.id && message.result) {
          everReady = true;
          handshake.result = message.result;
        }
        meta.reply?.(message);
        return;
      }

      if (meta.kind === "screenshot") {
        const waiter = waitingScreenshot.get(message.id);
        waitingScreenshot.delete(message.id);
        if (waiter) waiter.resolve(message.result ?? null);
        return;
      }

      if (meta.kind === "internal") {
        if (message?.error) meta.reject?.(new Error(message.error.message || "internal call failed"));
        else meta.resolve?.(message?.result ?? null);
        return;
      }

      const result = message.result;
      if (!isToolError(result) && meta.preShot) {
        meta.reply?.({
          ...message,
          id: meta.originalId,
          result: mergeScreenshot(result, meta.preShot),
        });
        return;
      }
      meta.reply?.({ ...message, id: meta.originalId });
    }
  }

  /**
   * @param {any} message
   * @param {(msg: any) => void} reply
   */
  async function handleClientMessage(message, reply) {
    const run = async () => {
      try {
        await ensureUpstream();
      } catch (error) {
        if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
          reply({
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
        if (everReady && handshake?.result) {
          reply({
            jsonrpc: "2.0",
            id: message.id,
            result: handshake.result,
          });
          return;
        }
        if (initializing) {
          try {
            const result = await initializing;
            reply({
              jsonrpc: "2.0",
              id: message.id,
              result,
            });
          } catch (error) {
            reply({
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

        const upstreamId = nextBridgeId++;
        const initForUpstream = { ...message, id: upstreamId };
        handshake = {
          initializeRequest: initForUpstream,
          initializedNotification: handshake?.initializedNotification ?? null,
          result: null,
        };

        initializing = new Promise((resolve, reject) => {
          pending.set(upstreamId, {
            kind: "pass",
            reply: (msg) => {
              if (msg?.error) {
                reject(new Error(msg.error.message || "initialize failed"));
                return;
              }
              if (msg?.result) {
                everReady = true;
                handshake.result = msg.result;
                resolve(msg.result);
              } else {
                reject(new Error("initialize returned empty result"));
              }
            },
          });
          if (!child?.stdin) {
            reject(new Error("Browser MCP upstream unavailable"));
            return;
          }
          writeMessage(child.stdin, initForUpstream);
        }).finally(() => {
          initializing = null;
        });

        try {
          const result = await initializing;
          reply({
            jsonrpc: "2.0",
            id: message.id,
            result,
          });
        } catch (error) {
          reply({
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

      if (message?.method === "notifications/initialized") {
        if (!handshake) {
          handshake = { initializeRequest: null, initializedNotification: message, result: null };
        } else {
          handshake.initializedNotification = message;
        }
        if (child?.stdin && !upstreamInitialized) {
          writeMessage(child.stdin, message);
          upstreamInitialized = true;
        }
        return;
      }

      const clientId =
        message && Object.prototype.hasOwnProperty.call(message, "id") ? message.id : null;
      const upstreamId = clientId != null ? nextBridgeId++ : null;
      const toUpstream =
        upstreamId != null && message && typeof message === "object"
          ? { ...message, id: upstreamId }
          : message;

      if (
        toUpstream &&
        toUpstream.method === "tools/call" &&
        toUpstream.params &&
        typeof toUpstream.params.name === "string" &&
        ACTION_TOOLS.has(toUpstream.params.name)
      ) {
        let preShot = null;
        try {
          if (HOVER_BEFORE_SHOT.has(toUpstream.params.name)) {
            // hover 瞬移坐标；页内剧场指针会对大位移做 ~320ms glide，这里等滑完再截图
            await requestHoverForShot(toUpstream.params.arguments);
            await sleep(340);
          }
          preShot = await requestScreenshot();
        } catch {
          preShot = null;
        }
        pending.set(upstreamId, {
          kind: "action",
          originalId: clientId,
          name: toUpstream.params.name,
          preShot,
          reply,
        });
      } else if (upstreamId != null) {
        pending.set(upstreamId, {
          kind: "pass",
          reply: (msg) => reply({ ...msg, id: clientId }),
        });
      }

      if (!child?.stdin) {
        if (clientId != null) {
          reply({
            jsonrpc: "2.0",
            id: clientId,
            error: { code: -32000, message: "Browser MCP upstream unavailable" },
          });
        }
        return;
      }
      writeMessage(child.stdin, toUpstream);
    };

    const done = upstreamChain.then(run, run);
    upstreamChain = done.catch(() => undefined);
    await done;
  }

  function markShuttingDown() {
    shuttingDown = true;
  }

  function killUpstream(signal = "SIGTERM") {
    try {
      child?.stdin?.end();
    } catch {
      // ignore
    }
    try {
      child?.kill(signal);
    } catch {
      // ignore
    }
  }

  return {
    handleClientMessage,
    spawnUpstream,
    markShuttingDown,
    killUpstream,
    get child() {
      return child;
    },
  };
}
