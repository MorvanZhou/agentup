import { createRequire } from "node:module";
import { expect, it } from "vitest";

const { applicationMenuTemplate } = createRequire(import.meta.url)("../../electron/menu.cjs") as {
  applicationMenuTemplate(platform?: string): Array<{
    label?: string;
    role?: string;
    submenu?: Array<{ label?: string; role?: string; type?: string }>;
  }>;
};

function viewMenu(platform: string) {
  return applicationMenuTemplate(platform).find((item) => item.label === "Developer");
}

it("把刷新与开发者工具放进开发菜单", () => {
  for (const platform of ["darwin", "win32"]) {
    expect(viewMenu(platform)?.submenu).toEqual([
      { label: "Reload", role: "reload" },
      { label: "Force Reload", role: "forceReload" },
      { type: "separator" },
      { label: "Developer Tools", role: "toggleDevTools" },
    ]);
  }
});

it("macOS 应用菜单只保留关于与退出", () => {
  const [appMenu] = applicationMenuTemplate("darwin");
  expect(appMenu.label).toBe("AgentUp");
  expect(appMenu.submenu).toEqual([{ role: "about" }, { type: "separator" }, { role: "quit" }]);
});
