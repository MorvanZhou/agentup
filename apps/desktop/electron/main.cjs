const { createOAuthLoopback } = require("./oauth-loopback.cjs");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell, systemPreferences, Tray } =
  require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { applyAppBadge } = require("./app-badge.cjs");
const { createMenuBarController } = require("./menu-bar.cjs");
const { ensureRuntimeModules } = require("./ensure-runtime-modules.cjs");
const {
  collectErasePaths,
  eraseLocalDataPaths,
  resolveAgentDataRoot,
  writeDataRootMarker,
} = require("./erase-local-data.cjs");
const { resolveUserWorkspacePath } = require("./user-workspace-path.cjs");
const { applicationMenuTemplate } = require("./menu.cjs");
const {
  CHECK_INTERVAL_MS,
  checkForAppUpdate,
} = require("./app-update.cjs");
const { initLogger, logError, logInfo, logPath } = require("./logger.cjs");
const {
  env: releaseEnv,
  backendUrl: releaseBackendUrl,
  webUrl: releaseWebUrl,
  downloadsUrl: releaseDownloadsUrl,
} = require("./release-config.cjs");
const { createSecretCrypto } = require("./secret-crypto.cjs");
const { createSessionVault } = require("./session-vault.cjs");
const { mergeShellEnv, resolveUserShellEnv } = require("./shell-env.cjs");
const { childAlive, stopChildProcess } = require("./stop-child.cjs");

const { randomBytes } = require("node:crypto");

/** 粘贴内存文件的临时目录与上限：与 from-path staging 的 512MB 磁盘上限一致。 */
const STAGED_IN_MEMORY_PREFIX = "agentup-paste-";
const STAGED_IN_MEMORY_MAX_BYTES = 512 * 1024 * 1024;
const STAGED_IN_MEMORY_TTL_MS = 60 * 60 * 1000;

function stagedInMemoryTempDir() {
  return path.join(os.tmpdir(), "agentup-paste");
}

/** 贴入文件名净化：basename + 去控制字符/空白，防路径注入。 */
function sanitizeStagedInMemoryName(raw) {
  const base = String(raw || "file")
    .split(/[\\/]/)
    .pop() // basename
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
  return base || "file";
}

/** 顺手清理超过 TTL 的历史粘贴临时文件；失败不阻塞本次上传。 */
async function cleanupStaleStagedInMemoryFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    try {
      const full = path.join(dir, entry.name);
      const st = await fsp.stat(full);
      if (now - st.mtimeMs > STAGED_IN_MEMORY_TTL_MS) await fsp.rm(full, { force: true });
    } catch {
      /* 已消失则忽略 */
    }
  }
}

const runtimeHost = "127.0.0.1";
const runtimePort = process.env.AGENTUP_RUNTIME_PORT || "47391";
const runtimeUrl = `http://${runtimeHost}:${runtimePort}`;
const desktopUrl = process.env.AGENTUP_DESKTOP_URL || "http://127.0.0.1:5173";
const appIconPath = path.join(
  __dirname,
  "assets",
  process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png",
);

/** 开发态 `electron .` 时 app.getName/getVersion 仍是 Electron 自身，About 需显式覆盖。 */
const desktopPkg = require("../package.json");
const appProductName =
  typeof desktopPkg.productName === "string" && desktopPkg.productName.trim()
    ? desktopPkg.productName.trim()
    : "AgentUp";
const appProductVersion =
  typeof desktopPkg.version === "string" && desktopPkg.version.trim() ? desktopPkg.version.trim() : "0.0.0";
app.setName(appProductName);

/* nativeTheme 跟随应用主题（system/light/dark），DevTools / 菜单与内容一致。 */

initLogger();
logInfo(
  `start packaged=${app.isPackaged} env=${releaseEnv} backend=${releaseBackendUrl} web=${releaseWebUrl} downloads=${releaseDownloadsUrl} platform=${process.platform} version=${appProductVersion} electron=${app.getVersion()}`,
);

/** 应用更新检查进行中时忽略重复点击 / 轮询。 */
let appUpdateCheckInFlight = false;
/** @type {ReturnType<typeof setInterval> | null} */
let appUpdateTimer = null;

function sendToAllRenderers(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * @param {{ interactive: boolean }} opts
 * interactive=true：菜单手动检查，始终回报结果；false：静默轮询，仅有新版本时通知。
 */
async function runAppUpdateCheck(opts) {
  if (appUpdateCheckInFlight) return;
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  if (!releaseDownloadsUrl) return;
  appUpdateCheckInFlight = true;
  if (opts.interactive) {
    sendToAllRenderers("agentup:update-check-result", { status: "checking" });
  }
  try {
    const result = await checkForAppUpdate({
      downloadsBase: releaseDownloadsUrl,
      platform: process.platform,
      currentVersion: appProductVersion,
    });
    if (result.updateAvailable) {
      sendToAllRenderers("agentup:update-check-result", {
        status: "available",
        latestVersion: result.latestVersion,
        currentVersion: result.currentVersion,
        downloadUrl: result.downloadUrl,
        sha512: result.sha512,
        fileName: result.fileName,
      });
    } else if (opts.interactive) {
      sendToAllRenderers("agentup:update-check-result", {
        status: "up-to-date",
        latestVersion: result.latestVersion,
        currentVersion: result.currentVersion,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`检查更新失败：${message}`);
    if (opts.interactive) {
      sendToAllRenderers("agentup:update-check-result", {
        status: "error",
        message,
      });
    }
  } finally {
    appUpdateCheckInFlight = false;
  }
}

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

const menuBar = createMenuBarController({
  platform: process.platform,
  Tray,
  Menu,
  nativeImage,
  iconPath: path.join(__dirname, "assets", "icon.png"),
  productName: appProductName,
  onOpen: focusAppWindows,
});

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

  // 打包态 runtime 依赖是 node_modules.tgz（见 pack-runtime-modules.cjs）；此处展开后再 spawn
  let packagedRuntimeRoot = null;
  if (app.isPackaged) {
    try {
      packagedRuntimeRoot = ensureRuntimeModules({
        runtimeRoot: path.join(process.resourcesPath, "runtime"),
        userDataRoot: app.getPath("userData"),
        appVersion: app.getVersion(),
        logInfo,
        logError,
      });
    } catch (error) {
      logError(`展开 runtime 依赖失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  runtime = spawnRuntime(packagedRuntimeRoot);
  runtime.on("exit", (code, signal) => {
    logError(`runtime 退出：code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
  }
  menuBar.attach();
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
  ipcMain.handle("agentup:oauth-loopback-cancel-wait", () => oauthLoopback.cancelWait());
  ipcMain.handle("agentup:oauth-loopback-stop", () => oauthLoopback.stop());
  ipcMain.handle("agentup:web-url", () => {
    const fromEnv = process.env.AGENTUP_WEB_URL?.trim();
    return (fromEnv || releaseWebUrl || "http://127.0.0.1:3000").replace(/\/$/, "");
  });
  // 粘贴的内存文件（截图等）拿不到磁盘路径：主进程写临时文件返回路径，
  // 渲染层继续走 from-path 复制 staging，字节不经 base64 / JSON。
  ipcMain.handle("agentup:stage-in-memory-file", async (_event, name, bytes) => {
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null;
    const size = bytes.byteLength;
    if (size === 0 || size > STAGED_IN_MEMORY_MAX_BYTES) return null;
    const dir = stagedInMemoryTempDir();
    await fsp.mkdir(dir, { recursive: true });
    await cleanupStaleStagedInMemoryFiles(dir).catch(() => {});
    const fileName = `${STAGED_IN_MEMORY_PREFIX}${randomBytes(4).toString("hex")}-${sanitizeStagedInMemoryName(name)}`;
    const filePath = path.join(dir, fileName);
    await fsp.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });
  ipcMain.handle("agentup:discard-staged-temp-file", async (_event, filePath) => {
    if (typeof filePath !== "string") return;
    const resolved = path.resolve(filePath);
    const dir = stagedInMemoryTempDir();
    // 只删自己管理的粘贴临时目录内文件，拒绝任意路径
    if (!resolved.startsWith(`${path.resolve(dir)}${path.sep}`)) return;
    await fsp.rm(resolved, { force: true }).catch(() => {});
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
  ipcMain.handle("agentup:select-directory", async () => {
    const window = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(window, {
      title: "选择项目目录",
      properties: ["openDirectory"],
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
    const target = await resolveUserWorkspacePath(targetPath, dataRoot(), "只能显示本机工作文件");
    shell.showItemInFolder(target);
  });
  ipcMain.handle("agentup:open-path", async (_event, targetPath) => {
    const target = await resolveUserWorkspacePath(targetPath, dataRoot(), "只能打开本机工作文件");
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
  ipcMain.handle("agentup:set-menu-bar-unread", (_event, count) => menuBar.setUnread(count));
  ipcMain.handle("agentup:check-for-updates", async () => {
    await runAppUpdateCheck({ interactive: true });
  });
  ipcMain.handle("agentup:open-update-download", async (_event, rawUrl) => {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("链接无效");
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("链接无效");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("更新下载只允许 https");
    }
    const allowedHost = (() => {
      try {
        return new URL(releaseDownloadsUrl).host;
      } catch {
        return "";
      }
    })();
    if (!allowedHost || parsed.host !== allowedHost) {
      throw new Error("更新下载域名不匹配");
    }
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("agentup:set-menu-bar-visible", (_event, visible) => {
    menuBar.setVisible(visible);
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
  // macOS「关于 AgentUp」：显式写入产品名与 package.json 版本（避免开发态显示 Electron）
  app.setAboutPanelOptions({
    applicationName: appProductName,
    applicationVersion: appProductVersion,
    version: appProductVersion,
  });
  try {
    await writeDataRootMarker({
      userDataPath: app.getPath("userData"),
      agentDataRoot: dataRoot(),
    });
  } catch (error) {
    logError(`写入 data-root 标记失败：${error instanceof Error ? error.message : String(error)}`);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      applicationMenuTemplate({
        onEraseLocalData: () => {
          void confirmAndEraseLocalData();
        },
        onCheckForUpdates: () => {
          void runAppUpdateCheck({ interactive: true });
        },
      }),
    ),
  );
  const healthy = await waitForOwnRuntime();
  if (!healthy) {
    logError(
      `runtime 未就绪：${runtimeUrl}。若日志含 EADDRINUSE，请先退出占用 ${runtimeHost}:${runtimePort} 的旧 AgentUp/runtime 再启动。`,
    );
  } else {
    logInfo(`runtime 就绪：${runtimeUrl}`);
  }
  createWindow();
  // 启动后稍晚静默查一次，再每 4 小时；有新版本才推提示条
  setTimeout(() => {
    void runAppUpdateCheck({ interactive: false });
  }, 15_000);
  if (appUpdateTimer) clearInterval(appUpdateTimer);
  appUpdateTimer = setInterval(() => {
    void runAppUpdateCheck({ interactive: false });
  }, CHECK_INTERVAL_MS);
  if (typeof appUpdateTimer.unref === "function") appUpdateTimer.unref();
});

/** 退出时先 SIGTERM，超时再 SIGKILL，避免关窗/Cmd+Q 后 runtime 孤儿占端口。 */
let stoppingRuntime = false;
/** 全清数据后直接 exit，避免 before-quit 再写已删目录。 */
let erasingLocalData = false;

async function stopRuntime() {
  const child = runtime;
  runtime = null;
  await stopChildProcess(child, { logInfo, logError });
}

async function confirmAndEraseLocalData() {
  if (erasingLocalData) return;
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const result = await dialog.showMessageBox(parent, {
    type: "warning",
    buttons: ["Cancel", "Erase Everything"],
    defaultId: 0,
    cancelId: 0,
    title: "Erase All Local Data?",
    message: "Erase all AgentUp data on this computer?",
    detail:
      "This permanently deletes chat history, local agents, every agent's work files and outputs, saved API keys, sign-in state, and logs. This cannot be undone.",
  });
  if (result.response !== 1) return;

  erasingLocalData = true;
  stoppingRuntime = true;
  try {
    await stopRuntime();
    const paths = collectErasePaths({
      agentDataRoot: dataRoot(),
      userDataPath: app.getPath("userData"),
      logsPath: path.dirname(logPath()),
    });
    await eraseLocalDataPaths({ paths, logInfo, logError });
  } catch (error) {
    erasingLocalData = false;
    stoppingRuntime = false;
    logError(`全清本机数据失败：${error instanceof Error ? error.message : String(error)}`);
    await dialog.showMessageBox(parent, {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: "Erase Failed",
      message: "Could not erase all local data.",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  app.exit(0);
}

app.on("before-quit", (event) => {
  if (erasingLocalData) return;
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

/**
 * @param {string | null} packagedRuntimeRoot 打包态经 ensureRuntimeModules 解析后的 runtime 根
 */
function spawnRuntime(packagedRuntimeRoot) {
  const env = { ...process.env };
  if (!env.AGENTUP_BACKEND_URL?.trim()) {
    env.AGENTUP_BACKEND_URL = releaseBackendUrl;
  }
  const cli = runtimeCliPath(packagedRuntimeRoot);
  logInfo(`spawn runtime cli=${cli} backend=${env.AGENTUP_BACKEND_URL}`);
  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    const logDir = path.dirname(logPath());
    const stdout = fs.openSync(path.join(logDir, "runtime.log"), "a");
    const stderr = fs.openSync(path.join(logDir, "runtime.log"), "a");
    return spawn(process.execPath, [cli], {
      stdio: ["ignore", stdout, stderr],
      env,
      cwd: packagedRuntimeRoot || path.join(process.resourcesPath, "runtime"),
    });
  }
  return spawn(process.env.AGENTUP_NODE || "node", [cli], {
    stdio: "inherit",
    env,
  });
}

/**
 * @param {string | null} packagedRuntimeRoot
 */
function runtimeCliPath(packagedRuntimeRoot) {
  if (app.isPackaged) {
    const root = packagedRuntimeRoot || path.join(process.resourcesPath, "runtime");
    return path.join(root, "dist", "local", "cli.js");
  }
  return path.join(__dirname, "../../runtime/dist/local/cli.js");
}

function dataRoot() {
  return resolveAgentDataRoot({ env: process.env, homedir: os.homedir() });
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
        // 开发态核对 backend：仅用于发现「端口被正式版占用」；本机不连服务器时跳过，勿挡本地使用
        if (!app.isPackaged) {
          const expectedBackend = (process.env.AGENTUP_BACKEND_URL || releaseBackendUrl || "").replace(/\/$/, "");
          if (expectedBackend) {
            let backendPayload;
            try {
              const backendRes = await fetch(`${expectedBackend}/v1/auth/turnstile`);
              if (!backendRes.ok) throw new Error(`backend turnstile status=${backendRes.status}`);
              backendPayload = await backendRes.json();
            } catch {
              return true;
            }
            try {
              const viaRuntime = await fetch(`${runtimeUrl}/auth/turnstile`).then((r) => r.json());
              if (JSON.stringify(viaRuntime) !== JSON.stringify(backendPayload)) {
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
