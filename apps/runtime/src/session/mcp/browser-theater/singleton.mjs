/**
 * Browser Use 本机单例：一份宿主 + 多会话 TCP 客户端。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import { parseMessages, sleep, writeMessage } from "./ndjson.mjs";

export function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runtimePaths(root) {
  const dir = path.join(root, "runtime");
  return {
    dir,
    lock: path.join(dir, "browser-use.host.lock"),
    port: path.join(dir, "browser-use.port"),
    log: path.join(dir, "browser-use.host.log"),
  };
}

function readPortFile(portPath) {
  try {
    const raw = fs.readFileSync(portPath, "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function readLockPid(lockPath) {
  try {
    return Number(fs.readFileSync(lockPath, "utf8").trim());
  } catch {
    return NaN;
  }
}

function connectPort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function connectWithRetry(portPath, timeoutMs) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    const port = readPortFile(portPath);
    if (port) {
      try {
        return await connectPort(port);
      } catch (error) {
        lastErr = error;
      }
    }
    await sleep(40);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Browser Use host not ready (connect timeout)");
}

export function clearHostFiles(paths) {
  for (const p of [paths.port, paths.lock]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

/** 锁文件在、进程却连不上 → 视为僵死宿主，清掉后重来。 */
export function reapStaleHost(paths) {
  const pid = readLockPid(paths.lock);
  if (Number.isFinite(pid) && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  clearHostFiles(paths);
}

/**
 * @param {{
 *   root: string,
 *   selfPath: string,
 *   upstreamCommand: string,
 *   upstreamArgs: string[],
 * }} opts
 */
export function spawnDetachedHost(opts) {
  const { root, selfPath, upstreamCommand, upstreamArgs } = opts;
  const paths = runtimePaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });
  let logFd = "ignore";
  try {
    logFd = fs.openSync(paths.log, "a");
  } catch {
    logFd = "ignore";
  }
  const childProc = spawn(process.execPath, [selfPath], {
    detached: true,
    stdio: ["ignore", "ignore", logFd],
    env: {
      ...process.env,
      AGENTUP_BROWSER_HOST: "1",
      AGENTUP_BROWSER_USER_DATA_ROOT: root,
      AGENTUP_BROWSER_UPSTREAM_COMMAND: upstreamCommand,
      AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify(upstreamArgs),
    },
    windowsHide: true,
  });
  childProc.on("error", (error) => {
    console.error("browser mcp host spawn failed", error);
  });
  // 立刻写入宿主 pid（勿留 starter 客户端 pid），否则测例/回收会杀错进程
  if (typeof childProc.pid === "number" && childProc.pid > 0) {
    try {
      fs.writeFileSync(paths.lock, String(childProc.pid));
    } catch {
      // ignore
    }
  }
  childProc.unref();
  return childProc;
}

/**
 * 客户端：确保单例宿主在听，然后把本进程 stdio 接到宿主。
 * @param {{
 *   root: string,
 *   selfPath: string,
 *   upstreamCommand: string,
 *   upstreamArgs: string[],
 * }} opts
 */
export async function runClient(opts) {
  const { root, selfPath, upstreamCommand, upstreamArgs } = opts;
  const paths = runtimePaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });

  /** @type {import("node:net").Socket | null} */
  let socket = null;
  /** 连上宿主前 Pi 可能已写入 initialize；先入队，避免 stdin 在 paused 时丢字节 */
  /** @type {Buffer[]} */
  const pendingChunks = [];
  /** @type {Buffer} */
  let incoming = Buffer.alloc(0);

  const flushToSocket = (chunk) => {
    if (!socket) {
      pendingChunks.push(chunk);
      return;
    }
    incoming = Buffer.concat([incoming, chunk]);
    const parsed = parseMessages(incoming);
    incoming = parsed.rest;
    for (const message of parsed.messages) {
      writeMessage(socket, message);
    }
  };

  process.stdin.on("data", flushToSocket);
  process.stdin.on("end", () => {
    try {
      socket?.end();
    } catch {
      // ignore
    }
  });

  const tryExisting = async () => {
    const existingPid = readLockPid(paths.lock);
    const existingPort = readPortFile(paths.port);
    if (!existingPort) return null;
    if (!isPidAlive(existingPid)) {
      clearHostFiles(paths);
      return null;
    }
    try {
      return await connectPort(existingPort);
    } catch {
      reapStaleHost(paths);
      return null;
    }
  };

  socket = await tryExisting();

  if (!socket) {
    let starter = false;
    try {
      // 仅占坑；真正 pid 由 spawnDetachedHost 写入，避免回收时误杀 starter 客户端
      const fd = fs.openSync(paths.lock, "wx");
      fs.closeSync(fd);
      starter = true;
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
    }
    if (starter) {
      try {
        spawnDetachedHost({ root, selfPath, upstreamCommand, upstreamArgs });
        socket = await connectWithRetry(paths.port, 20000);
      } catch (error) {
        reapStaleHost(paths);
        throw error;
      }
    } else {
      try {
        socket = await connectWithRetry(paths.port, 20000);
      } catch {
        reapStaleHost(paths);
        try {
          const fd = fs.openSync(paths.lock, "wx");
          fs.closeSync(fd);
          spawnDetachedHost({ root, selfPath, upstreamCommand, upstreamArgs });
          socket = await connectWithRetry(paths.port, 20000);
        } catch (lockErr) {
          if (lockErr && lockErr.code === "EEXIST") {
            socket = await connectWithRetry(paths.port, 10000);
          } else {
            throw lockErr;
          }
        }
      }
    }
  }

  if (!socket) {
    throw new Error("Browser Use host connection failed");
  }

  /** @type {Buffer} */
  let fromHost = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    fromHost = Buffer.concat([fromHost, chunk]);
    const parsed = parseMessages(fromHost);
    fromHost = parsed.rest;
    for (const message of parsed.messages) {
      writeMessage(process.stdout, message);
    }
  });
  socket.on("close", () => {
    process.exit(0);
  });
  socket.on("error", () => {
    process.exit(1);
  });

  // 补放连宿主前积压的 stdin
  for (const chunk of pendingChunks.splice(0)) {
    flushToSocket(chunk);
  }
}

/**
 * 宿主：独占上游，接受多个 TCP 客户端；最后一客户端断开后短暂空闲再退出。
 * @param {{
 *   root: string,
 *   hub: ReturnType<import("./upstream-hub.mjs").createUpstreamHub>,
 * }} opts
 */
export function runHost(opts) {
  const { root, hub } = opts;
  const paths = runtimePaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });

  try {
    fs.writeFileSync(paths.lock, String(process.pid));
  } catch {
    // ignore
  }

  /** @type {Set<import("node:net").Socket>} */
  const sockets = new Set();
  let idleTimer = null;
  // 默认 10 分钟：MCP 客户端断开后仍保活有窗 Chrome，避免下一次 navigate 冷启动卡几十秒。
  // 测例可设 AGENTUP_BROWSER_HOST_IDLE_MS=300 加速收尸。
  const idleMs = (() => {
    const raw = Number(process.env.AGENTUP_BROWSER_HOST_IDLE_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 600_000;
  })();

  const scheduleIdleExit = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (sockets.size > 0) return;
    idleTimer = setTimeout(() => {
      if (sockets.size > 0) return;
      hub.markShuttingDown();
      hub.killUpstream("SIGTERM");
      clearHostFiles(paths);
      // 稍等上游收尸，减少测例/会话间孤儿进程
      setTimeout(() => process.exit(0), 50);
    }, idleMs);
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    /** @type {Buffer} */
    let buf = Buffer.alloc(0);
    let connChain = Promise.resolve();

    const reply = (message) => writeMessage(socket, message);

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const parsed = parseMessages(buf);
      buf = parsed.rest;
      for (const message of parsed.messages) {
        connChain = connChain
          .then(() => hub.handleClientMessage(message, reply))
          .catch((error) => {
            console.error("browser mcp host client handler failed", error);
          });
      }
    });

    const onGone = () => {
      sockets.delete(socket);
      scheduleIdleExit();
    };
    socket.on("close", onGone);
    socket.on("error", onGone);
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;
    if (!port) {
      console.error("browser mcp host failed to bind");
      process.exit(1);
    }
    const tmp = `${paths.port}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${port}\n`, "utf8");
    fs.renameSync(tmp, paths.port);
    fs.writeFileSync(paths.lock, String(process.pid));
    hub.spawnUpstream();
  });

  const shutdown = () => {
    hub.markShuttingDown();
    try {
      server.close();
    } catch {
      // ignore
    }
    hub.killUpstream("SIGTERM");
    clearHostFiles(paths);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/**
 * 无 USER_DATA_ROOT：单进程独占上游（单测 / 兼容）。
 * @param {{ hub: ReturnType<import("./upstream-hub.mjs").createUpstreamHub> }} opts
 */
export function runStandalone(opts) {
  const { hub } = opts;
  /** @type {Buffer} */
  let incoming = Buffer.alloc(0);
  let clientChain = Promise.resolve();

  const reply = (message) => writeMessage(process.stdout, message);

  process.stdin.on("data", (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);
    const parsed = parseMessages(incoming);
    incoming = parsed.rest;
    for (const message of parsed.messages) {
      clientChain = clientChain
        .then(() => hub.handleClientMessage(message, reply))
        .catch((error) => {
          console.error("browser mcp bridge client handler failed", error);
        });
    }
  });
  process.stdin.on("end", () => {
    hub.markShuttingDown();
    hub.killUpstream("SIGTERM");
  });

  hub.spawnUpstream();
}
