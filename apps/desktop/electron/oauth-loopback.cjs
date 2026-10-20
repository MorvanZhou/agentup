"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const ICON_PATH = path.join(__dirname, "assets", "icon.png");

/** 内联 logo，避免成功后立刻 stop 导致 /icon.png 加载失败。 */
function iconDataUri() {
  try {
    return `data:image/png;base64,${fs.readFileSync(ICON_PATH).toString("base64")}`;
  } catch {
    return "";
  }
}

const ICON_DATA_URI = iconDataUri();

const COPY = {
  zh: {
    okTitle: "可以返回桌面应用",
    okLead: "登录已完成。点击下方按钮回到 AgentUp。",
    openApp: "打开 AgentUp",
    openedTitle: "已回到 AgentUp",
    openedLead: "可以关闭此标签页。",
    missingTitle: "登录未完成",
    missingLead: "缺少登录凭证，请返回 AgentUp 重试。",
    errorTitle: "出了点问题",
    errorLead: "请关闭此页，回到 AgentUp 再试一次。",
    notFound: "未找到页面",
  },
  en: {
    okTitle: "Return to the desktop app",
    okLead: "Sign-in is complete. Open AgentUp with the button below.",
    openApp: "Open AgentUp",
    openedTitle: "Back in AgentUp",
    openedLead: "You can close this tab.",
    missingTitle: "Sign-in incomplete",
    missingLead: "Missing login code. Return to AgentUp and try again.",
    errorTitle: "Something went wrong",
    errorLead: "Close this page and try again from AgentUp.",
    notFound: "Not Found",
  },
};

/**
 * 本机 OAuth loopback：浏览器回调到 127.0.0.1 临时端口，把一次性 code 交给渲染进程。
 * @param {{ onOpenApp?: () => void }} [options]
 */
function createOAuthLoopback(options = {}) {
  /** @type {import("node:http").Server | null} */
  let server = null;
  /** @type {((value: { code: string }) => void) | null} */
  let resolveWait = null;
  /** @type {((reason: Error) => void) | null} */
  let rejectWait = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {"zh" | "en"} */
  let locale = "zh";
  /**
   * 浏览器已回跳但渲染进程没接到（取消 / HMR 整页刷新）时暂存，供下次 take/wait 领取。
   * @type {string | null}
   */
  let pendingCode = null;
  const onOpenApp = typeof options.onOpenApp === "function" ? options.onOpenApp : () => {};

  function resetWaiters(error) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (error && rejectWait) rejectWait(error);
    resolveWait = null;
    rejectWait = null;
  }

  function copy() {
    return COPY[locale] || COPY.zh;
  }

  function invokeOpenApp() {
    try {
      onOpenApp();
    } catch {
      /* ignore */
    }
  }

  /** 对齐 Web 登录页：近黑底、奶油卡、品牌橙。 */
  function pageHtml(kind) {
    const text = copy();
    const title =
      kind === "ok"
        ? text.okTitle
        : kind === "opened"
          ? text.openedTitle
          : kind === "missing"
            ? text.missingTitle
            : text.errorTitle;
    const lead =
      kind === "ok"
        ? text.okLead
        : kind === "opened"
          ? text.openedLead
          : kind === "missing"
            ? text.missingLead
            : text.errorLead;
    const lang = locale === "en" ? "en" : "zh-CN";
    const logo = ICON_DATA_URI
      ? `<img src="${ICON_DATA_URI}" alt="AgentUp" width="72" height="72" style="display:block;margin:0 auto;border-radius:1.25rem;"/>`
      : "";
    // 用同端口 /open，不依赖自定义 protocol（开发态 electron 绑 agentup:// 不可靠）
    const openButton =
      kind === "ok"
        ? `<p style="margin:1.5rem 0 0;">
  <a href="/open" style="display:inline-block;min-height:2rem;line-height:2rem;padding:0 1.25rem;border-radius:0.5rem;background:#ff7a1a;color:#fff;font-size:0.875rem;font-weight:600;text-decoration:none;">
    ${text.openApp}
  </a>
</p>`
        : "";
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · AgentUp</title>
<link rel="icon" href="data:,"/>
</head>
<body style="margin:0;padding:0;min-height:100vh;background:#0c0c0c;color:#f5f0e8;font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;">
  <div style="pointer-events:none;position:fixed;inset:0;background:radial-gradient(ellipse 55% 40% at 12% 18%,rgb(255 122 26 / 22%),transparent 60%),radial-gradient(ellipse 50% 45% at 88% 88%,rgb(255 122 26 / 10%),transparent 55%);"></div>
  <main style="position:relative;box-sizing:border-box;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:40px 16px;">
    <section style="width:100%;max-width:420px;border-radius:2rem;border:1px solid #efe6da;background:#f7f2ea;padding:2rem 2.25rem 2.25rem;color:#1a1a1a;box-shadow:0 28px 70px rgb(0 0 0 / 50%);text-align:center;">
      ${logo}
      <p style="margin:1.25rem 0 0;font-size:11px;font-weight:600;letter-spacing:0.22em;color:#ff7a1a;">AgentUp</p>
      <h1 style="margin:0.75rem 0 0;font-size:1.375rem;font-weight:600;letter-spacing:-0.02em;color:#1a1a1a;">${title}</h1>
      <p style="margin:0.75rem 0 0;font-size:0.875rem;line-height:1.6;color:#6b645c;">${lead}</p>
      ${openButton}
    </section>
  </main>
</body>
</html>`;
  }

  function sendHtml(res, status, kind) {
    const body = pageHtml(kind);
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // 关掉 keep-alive，避免 stop()/server.close() 被浏览器挂着的成功页拖死
      connection: "close",
    });
    res.end(body);
  }

  /** 只结束当前 wait，不关端口：网页上的注册/验证仍可回跳到同一 loopback。 */
  function cancelWait() {
    if (rejectWait) resetWaiters(new Error("已取消登录"));
    else resetWaiters();
  }

  /**
   * @param {{ clearPending?: boolean }} [options]
   * clearPending 默认 true；start 重绑端口时传 false，保留已到达的一次性码。
   */
  async function stop(options = {}) {
    const clearPending = options.clearPending !== false;
    cancelWait();
    if (clearPending) pendingCode = null;
    if (!server) return;
    const current = server;
    server = null;
    await new Promise((resolve) => {
      current.close(() => resolve());
      // 浏览器常保持成功页连接；不强制掐断则 close() 会一直等，loginWithBrowser 的 finally 挂死
      if (typeof current.closeAllConnections === "function") {
        current.closeAllConnections();
      }
    });
  }

  async function start(nextLocale) {
    // 重开端口时保留 pending：注册回跳可能已到达，只是渲染进程没领到
    await stop({ clearPending: false });
    if (nextLocale === "en" || nextLocale === "zh") locale = nextLocale;
    server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (requestUrl.pathname === "/open") {
          invokeOpenApp();
          sendHtml(res, 200, "opened");
          return;
        }
        if (requestUrl.pathname === "/favicon.ico") {
          res.writeHead(204, { connection: "close" });
          res.end();
          return;
        }
        if (requestUrl.pathname !== "/callback") {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8", connection: "close" });
          res.end(copy().notFound);
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          sendHtml(res, 400, "missing");
          return;
        }
        sendHtml(res, 200, "ok");
        // 回调到达即尝试聚焦桌面窗口（不依赖自定义 protocol）
        invokeOpenApp();
        if (resolveWait) {
          // 交给当前等待者独占，避免 wait 与 takePending 各换一次票
          const done = resolveWait;
          pendingCode = null;
          resetWaiters();
          done({ code });
        } else {
          // 无人等待（取消 / 渲染进程刷新）：暂存供下次领取
          pendingCode = code;
        }
      } catch (error) {
        sendHtml(res, 500, "error");
        resetWaiters(error instanceof Error ? error : new Error(String(error)));
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await stop();
      throw new Error("无法绑定 OAuth loopback 端口");
    }
    return {
      loopbackUri: `http://127.0.0.1:${address.port}/callback`,
      port: address.port,
    };
  }

  /** 取出并清空暂存码（换票成功或显式取消前可调用）。 */
  function takePending() {
    if (!pendingCode) return null;
    const code = pendingCode;
    pendingCode = null;
    return { code };
  }

  /** 只读暂存码，不消费（登录页挂载时决定是否自动继续）。 */
  function peekPending() {
    return pendingCode ? { code: pendingCode } : null;
  }

  /**
   * 等浏览器回跳。默认不超时：注册/重置要等邮件，由用户在 Desktop 取消叠层结束等待。
   * 传入正数 timeoutMs 时才启用超时（测试用）。
   */
  function waitForCode(timeoutMs) {
    if (pendingCode) {
      const code = pendingCode;
      pendingCode = null;
      return Promise.resolve({ code });
    }
    if (!server) return Promise.reject(new Error("OAuth loopback 未启动"));
    return new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        timer = setTimeout(() => {
          resetWaiters(new Error("登录超时，请回到 AgentUp 重试"));
        }, timeoutMs);
      }
    });
  }

  return { start, waitForCode, takePending, peekPending, cancelWait, stop };
}

module.exports = { createOAuthLoopback };
