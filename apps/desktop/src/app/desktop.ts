import { inject, provide, type InjectionKey } from "vue";

import { useDesktopApp } from "./useDesktopApp";

type DesktopApp = ReturnType<typeof useDesktopApp>;

export const desktopKey: InjectionKey<DesktopApp> = Symbol("desktop");

export function provideDesktop(): void {
  provide(desktopKey, useDesktopApp());
}

export function useDesktop(): DesktopApp {
  const desktop = inject(desktopKey);
  if (!desktop) throw new Error("桌面状态尚未就绪");
  return desktop;
}
