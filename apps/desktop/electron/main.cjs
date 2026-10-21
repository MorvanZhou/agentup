const { createOAuthLoopback } = require("./oauth-loopback.cjs");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell, systemPreferences } =
  require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { applyAppBadge } = require("./app-badge.cjs");
const { applicationMenuTemplate } = require("./menu.cjs");
const { initLogger, logError, logInfo, logPath } = require("./logger.cjs");
const {
  env: releaseEnv,
  backendUrl: releaseBackendUrl,
  webUrl: releaseWebUrl,
} = require("./release-config.cjs");
const { createSecretCrypto } = require("./secret-crypto.cjs");
const { createSessionVault } = require("./session-vault.cjs");
const { mergeShellEnv, resolveUserShellEnv } = require("./shell-env.cjs");
const { childAlive, stopChildProcess } = require("./stop-child.cjs");

const runtimeHost = "127.0.0.1";
const runtimePort = process.env.AGENTUP_RUNTIME_PORT || "47391";
const runtimeUrl = `http://${runtimeHost}:${runtimePort}`;
const desktopUrl = process.env.AGENTUP_DESKTOP_URL || "http://127.0.0.1:5173";
const appIconPath = path.join(
  __dirname,
  "assets",
  process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png",
);

/* nativeTheme 跟随应用主题（system/light/dark），DevTools / 菜单与内容一致。 */

initLogger();
logInfo(
  `start packaged=${app.isPackaged} env=${releaseEnv} backend=${releaseBackendUrl} web=${releaseWebUrl} platform=${process.platform} version=${app.getVersion()}`,
);

/** 登录回调页「打开 AgentUp」按钮：agentup://open */
const DEEP_LINK_SCHEME = "agentup";

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/** @type {import("node:child_process").ChildProcess | null} */
let runtime = null;
if (gotSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    focusAppWindows();
    const url = argv.find((arg) => typeof arg === "string" && arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (url) logInfo(`deep-link second-instance ${url}`);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    logInfo(`deep-link open-url ${url}`);
    focusAppWindows();
  });
}

function focusAppWindows() {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    if (app.isReady()) createWindow();
    return;
  }
  for (const win of windows) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  if (process.platform === "darwin" && app.dock) app.dock.show();
}

function createWindow() {
  const darwin = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // 与界面 730px 桌面断点对齐，避免缩到移动端布局（尚未做移动端适配）
    minWidth: 730,
    minHeight: 620,
    backgroundColor: "#191919",
    title: "AgentUp",
    icon: appIconPath,
    autoHideMenuBar: true,
    titleBarStyle: darwin ? "hiddenInset" : "default",
    // 72px 轨：灯组约 52×12，左右各 ~10px；y 与渲染层 --app-titlebar-inset 对齐
    trafficLightPosition: darwin ? { x: 10, y: 18 } : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    logError(`did-fail-load code=${code} desc=${description} url=${url}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logError(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const tag = ["verbose", "info", "warning", "error"][level] ?? String(level);
    if (tag === "error" || tag === "warning") logError(`renderer[${tag}] ${message} (${sourceId}:${line})`);
    else logInfo(`renderer[${tag}] ${message}`);
  });

  if (app.isPackaged) {
    const page = path.join(__dirname, "../dist/renderer/index.html");
    logInfo(`loadFile ${page}`);
    void window.loadFile(page).catch((error) => {
      logError(`loadFile 失败：${error instanceof Error ? error.message : String(error)}`);
    });
  } else {
    logInfo(`loadURL ${desktopUrl}`);
    void window.loadURL(desktopUrl);
  }
  if (!app.isPackaged && process.env.AGENTUP_OPEN_DEVTOOLS === "1") {
    window.webContents.openDevTools({ mode: "right" });
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  initLogger(app.getPath("logs"));
  logInfo(`userData=${app.getPath("userData")} logs=${logPath()}`);

  // 采用户 login shell 环境后再起 runtime，使打包 App 内 bash 能找到 nvm/Homebrew 等本机工具
  const shellEnv = await resolveUserShellEnv({ logInfo, logError });
  Object.assign(process.env, mergeShellEnv(process.env, shellEnv));

  runtime = spawnRuntime();
  runtime.on("exit", (code, signal) => {
    logError(`runtime 退出：code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
  }
  const sessionVault = createSessionVault({
    safeStorage,
    userDataPath: app.getPath("userData"),
    fs: fsp,
    path,
  });
  const secretCrypto = createSecretCrypto({ safeStorage });
  const oauthLoopback = createOAuthLoopback({ onOpenApp: focusAppWindows });
  ipcMain.handle("agentup:session-read", () => sessionVault.read());
  ipcMain.handle("agentup:session-write", (_event, session) => sessionVault.write(session));
  ipcMain.handle("agentup:session-clear", () => sessionVault.clear());
  ipcMain.handle("agentup:secret-ready", () => secretCrypto.encryptionReady());
  ipcMain.handle("agentup:secret-encrypt", (_event, plaintext) => secretCrypto.encrypt(plaintext));
  ipcMain.handle("agentup:secret-decrypt", (_event, cipher) => secretCrypto.decrypt(cipher));
  ipcMain.handle("agentup:open-external", async (_event, rawUrl) => {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("链接无效");
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("链接无效");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("只允许打开 http(s) 链接");
    }
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("agentup:oauth-loopback-start", (_event, locale) =>
    oauthLoopback.start(locale === "en" || locale === "zh" ? locale : undefined),
  );
  ipcMain.handle("agentup:oauth-loopback-wait", (_event, timeoutMs) =>
    oauthLoopback.waitForCode(typeof timeoutMs === "number" ? timeoutMs : undefined),
  );
  ipcMain.handle("agentup:oauth-loopback-take-pending", () => oauthLoopback.takePending());
  ipcMain.handle("agentup:oauth-loopback-peek-pending", () => oauthLoopback.peekPending());
  ipcMain.handle("agentup:oauth-loopback-cancel-wait", () => oauthLoopback.cancelWait());
  ipcMain.handle("agentup:oauth-loopback-stop", () => oauthLoopback.stop());
  ipcMain.handle("agentup:web-url", () => {
    const fromEnv = process.env.AGENTUP_WEB_URL?.trim();
    return (fromEnv || releaseWebUrl || "http://127.0.0.1:3000").replace(/\/$/, "");
  });
  ipcMain.handle("agentup:select-skill-package", async (_event, kind) => {
    const window = BrowserWindow.getFocusedWindow();
    if (kind !== "directory" && kind !== "zip") throw new Error("选择类型无效");
    const result =
      kind === "directory"
        ? await dialog.showOpenDialog(window, {
            title: "选择 Skill 文件夹",
            properties: ["openDirectory"],
          })
        : await dialog.showOpenDialog(window, {
            title: "选择 Skill ZIP",
            properties: ["openFile"],
            filters: [{ name: "ZIP", extensions: ["zip"] }],
          });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("agentup:select-save-path", async (_event, defaultName) => {
    const window = BrowserWindow.getFocusedWindow();
    const suggested =
      typeof defaultName === "string" && defaultName.trim() ? defaultName.trim() : "skill.zip";
    const result = await dialog.showSaveDialog(window, {
      title: "导出 Skill",
      defaultPath: suggested,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });
  ipcMain.handle("agentup:open-visit-directory", async (_event, directory) => {
    if (typeof directory !== "string") throw new Error("目录无效");
    const root = await fsp.realpath(dataRoot());
    const target = await fsp.realpath(directory);
    const relative = path.relative(root, target);
    const parts = relative.split(path.sep);
    if (relative.startsWith("..") || path.isAbsolute(relative) || parts.length !== 4 || parts[0] !== "users" || parts[2] !== "agents") {
      throw new Error("只能打开已招募 Agent 的本机目录");
    }
    const failure = await shell.openPath(target);
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("agentup:reveal-in-folder", async (_event, targetPath) => {
    const target = await resolveUserCwdPath(targetPath, "只能显示本机工作文件");
    shell.showItemInFolder(target);
  });
  ipcMain.handle("agentup:open-path", async (_event, targetPath) => {
    const target = await resolveUserCwdPath(targetPath, "只能打开本机工作文件");
    const failure = await shell.openPath(target);
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("agentup:set-theme-source", (_event, mode) => {
    if (mode !== "system" && mode !== "light" && mode !== "dark") {
      throw new Error("主题无效");
    }
    nativeTheme.themeSource = mode;
  });
  ipcMain.handle("agentup:set-app-badge", (_event, count) => {
    applyAppBadge(count, {
      platform: process.platform,
      dock: app.dock,
      setBadgeCount: (value) => app.setBadgeCount(value),
    });
  });
  // themeSource 非 system 时 matchMedia 不再反映真实系统外观，故走本机 API
  ipcMain.on("agentup:system-prefers-dark", (event) => {
    event.returnValue = systemPrefersDark();
  });
  if (process.platform === "darwin") {
    systemPreferences.subscribeNotification("AppleInterfaceThemeChangedNotification", () => {
      const prefersDark = systemPrefersDark();
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("agentup:system-theme-changed", prefersDark);
      }
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
  const healthy = await waitForOwnRuntime();
  if (!healthy) {
    logError(
      `runtime 未就绪：${runtimeUrl}。若日志含 EADDRINUSE，请先退出占用 ${runtimeHost}:${runtimePort} 的旧 AgentUp/runtime 再启动。`,
    );
  } else {
    logInfo(`runtime 就绪：${runtimeUrl}`);
  }
  createWindow();
});

/** 退出时先 SIGTERM，超时再 SIGKILL，避免关窗/Cmd+Q 后 runtime 孤儿占端口。 */
let stoppingRuntime = false;

async function stopRuntime() {
  const child = runtime;
  runtime = null;
  await stopChildProcess(child, { logInfo, logError });
}

app.on("before-quit", (event) => {
  if (!runtime || !childAlive(runtime) || stoppingRuntime) return;
  event.preventDefault();
  stoppingRuntime = true;
  void stopRuntime().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

function spawnRuntime() {
  const env = { ...process.env };
  if (!env.AGENTUP_BACKEND_URL?.trim()) {
    env.AGENTUP_BACKEND_URL = releaseBackendUrl;
  }
  const cli = runtimeCliPath();
  logInfo(`spawn runtime cli=${cli} backend=${env.AGENTUP_BACKEND_URL}`);
  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    const logDir = path.dirname(logPath());
    const stdout = fs.openSync(path.join(logDir, "runtime.log"), "a");
    const stderr = fs.openSync(path.join(logDir, "runtime.log"), "a");
    return spawn(process.execPath, [cli], {
      stdio: ["ignore", stdout, stderr],
      env,
      cwd: path.join(process.resourcesPath, "runtime"),
    });
  }
  return spawn(process.env.AGENTUP_NODE || "node", [cli], {
    stdio: "inherit",
    env,
  });
}

function runtimeCliPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "runtime", "dist", "local", "cli.js");
  }
  return path.join(__dirname, "../../runtime/dist/local/cli.js");
}

function dataRoot() {
  const configured = process.env.AGENTUP_USER_DATA_ROOT;
  if (configured?.trim()) return path.resolve(configured.trim());
  return path.join(os.homedir(), ".agentup");
}

/** 仅允许打开/显示 users 下各账号 cwd 内的本机工作文件。 */
async function resolveUserCwdPath(targetPath, deniedMessage) {
  if (typeof targetPath !== "string" || !targetPath.trim()) throw new Error("路径无效");
  const root = await fsp.realpath(dataRoot());
  const target = await fsp.realpath(targetPath);
  const relative = path.relative(root, target);
  const parts = relative.split(path.sep);
  if (relative.startsWith("..") || path.isAbsolute(relative) || parts[0] !== "users") {
    throw new Error(deniedMessage);
  }
  const underAgent = parts[2] === "agents" && parts.length >= 5 && parts[4] === "cwd";
  const underPersonal =
    parts[2] === "personal-assistant" && parts.length >= 4 && parts[3] === "cwd";
  if (!underAgent && !underPersonal) throw new Error(deniedMessage);
  return target;
}

/**
 * 真实系统是否深色（不受应用 themeSource 覆盖影响）。
 * darwin 上 themeSource≠system 时 shouldUseDarkColors / prefers-color-scheme 会跟着应用走，
 * 故读用户默认值 AppleInterfaceStyle。
 */
function systemPrefersDark() {
  if (process.platform === "darwin") {
    return systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark";
  }
  return nativeTheme.shouldUseDarkColorsForSystemUi ?? nativeTheme.shouldUseDarkColors;
}

function runtimeProcessExited() {
  if (!runtime) return true;
  return runtime.exitCode !== null || runtime.signalCode !== null;
}

/** 确认是本进程拉起的 runtime，避免端口被旧 AgentUp 占用时误判 /health 成功。 */
async function waitForOwnRuntime() {
  const deadline = Date.now() + 8000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (runtimeProcessExited()) {
      lastError = `spawn 已退出 code=${runtime.exitCode ?? "null"}（若为 EADDRINUSE，请先退出占用 ${runtimeHost}:${runtimePort} 的正式版 AgentUp）`;
      break;
    }
    try {
      const response = await fetch(`${runtimeUrl}/health`);
      if (response.ok) {
        // EADDRINUSE 时旧进程仍会响应 health；多等一会确认子进程没有随后退出。
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (runtimeProcessExited()) {
          lastError = `spawn 已退出 code=${runtime.exitCode ?? "null"}（端口 ${runtimePort} 被其他 AgentUp/runtime 占用）`;
          break;
        }
        // 开发态再核对 backend：正式版 runtime 连的是生产 API，换票码会「无效或已过期」
        if (!app.isPackaged) {
          const expectedBackend = (process.env.AGENTUP_BACKEND_URL || releaseBackendUrl || "").replace(/\/$/, "");
          if (expectedBackend) {
            try {
              const [viaRuntime, viaBackend] = await Promise.all([
                fetch(`${runtimeUrl}/auth/turnstile`).then((r) => r.json()),
                fetch(`${expectedBackend}/v1/auth/turnstile`).then((r) => r.json()),
              ]);
              if (JSON.stringify(viaRuntime) !== JSON.stringify(viaBackend)) {
                lastError = `runtime 连的不是 ${expectedBackend}（可能仍是占用端口的正式版 AgentUp）`;
                break;
              }
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              break;
            }
          }
        }
        return true;
      }
      lastError = `status=${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (lastError) logError(`runtime health 最后错误：${lastError}`);
  return false;
}
