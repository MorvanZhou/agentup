const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("agentUp", {
  platform: process.platform,
  readSession: () => ipcRenderer.invoke("agentup:session-read"),
  saveSession: (session) => ipcRenderer.invoke("agentup:session-write", session),
  clearSession: () => ipcRenderer.invoke("agentup:session-clear"),
  secretEncryptionReady: () => ipcRenderer.invoke("agentup:secret-ready"),
  encryptSecret: (plaintext) => ipcRenderer.invoke("agentup:secret-encrypt", plaintext),
  decryptSecret: (cipher) => ipcRenderer.invoke("agentup:secret-decrypt", cipher),
  selectSkillPackage: (kind) => ipcRenderer.invoke("agentup:select-skill-package", kind),
  /** 取用户选择/拖拽文件的本地绝对路径（粘贴的内存文件拿不到，返回 null）。 */
  filePathForStaging: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
        return null;
    }
  },
  /** 粘贴的内存文件：主进程写临时文件并返回路径（之后走 from-path 复制）。 */
  stageInMemoryFile: (name, bytes) => ipcRenderer.invoke("agentup:stage-in-memory-file", name, bytes),
  /** staging 完成后删除粘贴临时文件。 */
  discardStagedTempFile: (filePath) => ipcRenderer.invoke("agentup:discard-staged-temp-file", filePath),
  selectDirectory: () => ipcRenderer.invoke("agentup:select-directory"),
  selectSavePath: (defaultName) => ipcRenderer.invoke("agentup:select-save-path", defaultName),
  openVisitDirectory: (directory) => ipcRenderer.invoke("agentup:open-visit-directory", directory),
  revealInFolder: (target) => ipcRenderer.invoke("agentup:reveal-in-folder", target),
  openPath: (target) => ipcRenderer.invoke("agentup:open-path", target),
  openExternal: (url) => ipcRenderer.invoke("agentup:open-external", url),
  oauthLoopbackStart: (locale) => ipcRenderer.invoke("agentup:oauth-loopback-start", locale),
  oauthLoopbackWait: (timeoutMs) => ipcRenderer.invoke("agentup:oauth-loopback-wait", timeoutMs),
  oauthLoopbackTakePending: () => ipcRenderer.invoke("agentup:oauth-loopback-take-pending"),
  oauthLoopbackCancelWait: () => ipcRenderer.invoke("agentup:oauth-loopback-cancel-wait"),
  oauthLoopbackStop: () => ipcRenderer.invoke("agentup:oauth-loopback-stop"),
  webUrl: () => ipcRenderer.invoke("agentup:web-url"),
  setThemeSource: (mode) => ipcRenderer.invoke("agentup:set-theme-source", mode),
  setAppBadge: (count) => ipcRenderer.invoke("agentup:set-app-badge", count),
  setMenuBarUnread: (count) => ipcRenderer.invoke("agentup:set-menu-bar-unread", count),
  setMenuBarVisible: (visible) => ipcRenderer.invoke("agentup:set-menu-bar-visible", visible),
  /** 菜单 / 设置触发的手动检查更新 */
  checkForUpdates: () => ipcRenderer.invoke("agentup:check-for-updates"),
  /** 打开已校验域名的安装包下载链接（系统浏览器） */
  openUpdateDownload: (url) => ipcRenderer.invoke("agentup:open-update-download", url),
  /** 主进程推送的检查结果：checking / available / up-to-date / error */
  onUpdateCheckResult: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("agentup:update-check-result", handler);
    return () => ipcRenderer.removeListener("agentup:update-check-result", handler);
  },
  /** themeSource 覆盖后 matchMedia 可能不准；同步读真实系统外观 */
  systemPrefersDark: () => Boolean(ipcRenderer.sendSync("agentup:system-prefers-dark")),
  onSystemThemeChanged: (listener) => {
    const handler = (_event, prefersDark) => listener(Boolean(prefersDark));
    ipcRenderer.on("agentup:system-theme-changed", handler);
    return () => ipcRenderer.removeListener("agentup:system-theme-changed", handler);
  },
});
