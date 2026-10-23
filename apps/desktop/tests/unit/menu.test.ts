import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { applicationMenuTemplate } = createRequire(import.meta.url)("../../electron/menu.cjs") as {
  applicationMenuTemplate(options?: {
    platform?: string;
    onEraseLocalData?: () => void | Promise<void>;
  }): Array<{
    label?: string;
    role?: string;
    submenu?: Array<{ label?: string; role?: string; type?: string; click?: () => void }>;
  }>;
};

function viewMenu(platform: string) {
  return applicationMenuTemplate({ platform }).find((item) => item.label === "Developer");
}

it("把刷新、开发者工具与全清本机数据放进开发菜单", () => {
  for (const platform of ["darwin", "win32"]) {
    const submenu = viewMenu(platform)?.submenu ?? [];
    expect(submenu.map((item) => ({ label: item.label, role: item.role, type: item.type }))).toEqual([
      { label: "Reload", role: "reload", type: undefined },
      { label: "Force Reload", role: "forceReload", type: undefined },
      { label: undefined, role: undefined, type: "separator" },
      { label: "Developer Tools", role: "toggleDevTools", type: undefined },
      { label: undefined, role: undefined, type: "separator" },
      { label: "Erase All Local Data…", role: undefined, type: undefined },
    ]);
  }
});

it("点击全清菜单项会调用回调", () => {
  const onEraseLocalData = vi.fn();
  const developer = applicationMenuTemplate({ platform: "darwin", onEraseLocalData }).find(
    (item) => item.label === "Developer",
  );
  const erase = developer?.submenu?.find((item) => item.label === "Erase All Local Data…");
  erase?.click?.();
  expect(onEraseLocalData).toHaveBeenCalledOnce();
});

it("macOS 应用菜单只保留关于与退出", () => {
  const [appMenu] = applicationMenuTemplate({ platform: "darwin" });
  expect(appMenu.label).toBe("AgentUp");
  expect(appMenu.submenu).toEqual([{ role: "about" }, { type: "separator" }, { role: "quit" }]);
});
