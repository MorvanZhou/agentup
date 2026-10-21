/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}

interface AgentUpSession {
  kind?: "guest" | "account";
  userId: string;
  email: string;
  nickname: string;
  token: string;
}

interface Window {
  agentUp?: {
    /** Electron `process.platform`，如 darwin / win32 / linux */
    platform?: string;
    readSession(): Promise<AgentUpSession | null>;
    saveSession(session: AgentUpSession): Promise<void>;
    clearSession(): Promise<void>;
    secretEncryptionReady?(): Promise<boolean>;
    encryptSecret?(plaintext: string): Promise<string>;
    decryptSecret?(cipher: string): Promise<string>;
    selectSkillPackage(kind: "directory" | "zip"): Promise<string | null>;
    /** 另存为对话框；返回绝对路径，取消为 null。 */
    selectSavePath?(defaultName?: string): Promise<string | null>;
    openVisitDirectory(directory: string): Promise<void>;
    revealInFolder(target: string): Promise<void>;
    /** 用系统默认应用打开本机工作文件（cwd 内）。 */
    openPath(target: string): Promise<void>;
    /** 用系统浏览器打开 http(s) 链接（OAuth 等）。 */
    openExternal?(url: string): Promise<void>;
    oauthLoopbackStart?(locale?: "zh" | "en"): Promise<{ loopbackUri: string; port: number }>;
    oauthLoopbackWait?(timeoutMs?: number): Promise<{ code: string }>;
    oauthLoopbackTakePending?(): Promise<{ code: string } | null>;
    oauthLoopbackPeekPending?(): Promise<{ code: string } | null>;
    oauthLoopbackCancelWait?(): Promise<void>;
    oauthLoopbackStop?(): Promise<void>;
    /** 对外 Web 登录门面根地址（无尾斜杠）。 */
    webUrl?(): Promise<string>;
    /** 同步 Electron nativeTheme（DevTools / 菜单等）与应用主题。 */
    setThemeSource?(mode: "system" | "light" | "dark"): Promise<void>;
    /** 同步 Dock / 任务栏未读角标（0 清除）。 */
    setAppBadge?(count: number): Promise<void>;
    /** 真实系统是否深色（不受应用 themeSource 覆盖影响） */
    systemPrefersDark?: () => boolean;
    onSystemThemeChanged?: (listener: (prefersDark: boolean) => void) => () => void;
  };
  openedVisit?: string;
}
