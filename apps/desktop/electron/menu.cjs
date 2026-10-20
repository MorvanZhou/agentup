function applicationMenuTemplate(platform = process.platform) {
  const viewMenu = {
    label: "Developer",
    submenu: [
      { label: "Reload", role: "reload" },
      { label: "Force Reload", role: "forceReload" },
      { type: "separator" },
      { label: "Developer Tools", role: "toggleDevTools" },
    ],
  };
  if (platform === "darwin") {
    return [
      {
        label: "AgentUp",
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
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
  ];
}

module.exports = { applicationMenuTemplate };
