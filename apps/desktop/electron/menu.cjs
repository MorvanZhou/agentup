/**
 * @param {{
 *   platform?: string,
 *   onEraseLocalData?: () => void | Promise<void>,
 *   onCheckForUpdates?: () => void | Promise<void>,
 * }} [options]
 */
function applicationMenuTemplate(options = {}) {
  const platform = options.platform ?? process.platform;
  const checkForUpdatesItem = {
    label: "Check for Updates…",
    click: () => {
      if (typeof options.onCheckForUpdates === "function") {
        void options.onCheckForUpdates();
      }
    },
  };
  const viewMenu = {
    label: "Developer",
    submenu: [
      { label: "Reload", role: "reload" },
      { label: "Force Reload", role: "forceReload" },
      { type: "separator" },
      { label: "Developer Tools", role: "toggleDevTools" },
      { type: "separator" },
      {
        label: "Erase All Local Data…",
        click: () => {
          if (typeof options.onEraseLocalData === "function") {
            void options.onEraseLocalData();
          }
        },
      },
    ],
  };
  if (platform === "darwin") {
    return [
      {
        label: "AgentUp",
        submenu: [
          { role: "about" },
          { type: "separator" },
          checkForUpdatesItem,
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      viewMenu,
      { role: "windowMenu" },
    ];
  }
  return [
    { role: "fileMenu" },
    { role: "editMenu" },
    viewMenu,
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [checkForUpdatesItem],
    },
  ];
}

module.exports = { applicationMenuTemplate };
