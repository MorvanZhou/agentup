const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentUp", {
  platform: process.platform,
  readSession: () => ipcRenderer.invoke("agentup:session-read"),
  saveSession: (session) => ipcRenderer.invoke("agentup:session-write", session),
  clearSession: () => ipcRenderer.invoke("agentup:session-clear"),
  secretEncryptionReady: () => ipcRenderer.invoke("agentup:secret-ready"),
  encryptSecret: (plaintext) => ipcRenderer.invoke("agentup:secret-encrypt", plaintext),
  decryptSecret: (cipher) => ipcRenderer.invoke("agentup:secret-decrypt", cipher),
  selectSkillPackage: (kind) => ipcRenderer.invoke("agentup:select-skill-package", kind),
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
  /** themeSource 覆盖后 matchMedia 可能不准；同步读真实系统外观 */
  systemPrefersDark: () => Boolean(ipcRenderer.sendSync("agentup:system-prefers-dark")),
  onSystemThemeChanged: (listener) => {
    const handler = (_event, prefersDark) => listener(Boolean(prefersDark));
    ipcRenderer.on("agentup:system-theme-changed", handler);
    return () => ipcRenderer.removeListener("agentup:system-theme-changed", handler);
  },
});
