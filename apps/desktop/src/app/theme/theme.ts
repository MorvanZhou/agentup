export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const MIRROR_KEY = "agentup.theme";

export interface ThemeMirror {
  userId: string;
  themeMode: ThemeMode;
}

let currentMode: ThemeMode = "system";
let media: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(mode: ThemeMode, prefersDark = systemPrefersDark()): ResolvedTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.systemPrefersDark === "function") return bridge.systemPrefersDark();
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readThemeMirror(userId?: string | null): ThemeMode | null {
  const raw = localStorage.getItem(MIRROR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ThemeMirror;
    if (!parsed || typeof parsed.userId !== "string" || !isThemeMode(parsed.themeMode)) return null;
    if (userId && parsed.userId !== userId) return null;
    return parsed.themeMode;
  } catch {
    return null;
  }
}

export function writeThemeMirror(userId: string, themeMode: ThemeMode): void {
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ userId, themeMode } satisfies ThemeMirror));
}

export function clearThemeMirror(): void {
  localStorage.removeItem(MIRROR_KEY);
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/** 应用主题到 document，并在 system 模式下监听系统偏好。 */
export function applyTheme(mode: ThemeMode): void {
  currentMode = mode;
  paint(resolveTheme(mode));
  bindSystemListener(mode === "system");
  syncNativeTheme(mode);
}

/** 让 Electron chrome / DevTools 与应用主题一致。 */
function syncNativeTheme(mode: ThemeMode): void {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.setThemeSource !== "function") return;
  void bridge.setThemeSource(mode).catch(() => {
    /* 主进程不可用时忽略 */
  });
}

/** 启动时：有镜像用镜像，否则跟随系统。 */
export function bootstrapTheme(userId?: string | null): ThemeMode {
  const mirrored = userId ? readThemeMirror(userId) : null;
  const mode = mirrored ?? "system";
  applyTheme(mode);
  return mode;
}

function paint(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

let electronThemeUnsub: (() => void) | null = null;

function bindSystemListener(enabled: boolean): void {
  if (electronThemeUnsub) {
    electronThemeUnsub();
    electronThemeUnsub = null;
  }
  if (mediaHandler && media) {
    media.removeEventListener("change", mediaHandler);
    mediaHandler = null;
  }
  if (!enabled || typeof window === "undefined") return;

  const bridge = window.agentUp;
  if (typeof bridge?.onSystemThemeChanged === "function") {
    electronThemeUnsub = bridge.onSystemThemeChanged(() => {
      if (currentMode === "system") paint(resolveTheme("system"));
    });
    return;
  }

  if (typeof window.matchMedia !== "function") return;
  if (!media) media = window.matchMedia("(prefers-color-scheme: dark)");
  mediaHandler = () => {
    if (currentMode === "system") paint(resolveTheme("system"));
  };
  media.addEventListener("change", mediaHandler);
}
