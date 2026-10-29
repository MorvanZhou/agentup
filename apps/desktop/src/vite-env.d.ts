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
    /** 取用户选择/拖拽文件的本地绝对路径；粘贴的内存文件拿不到，返回 null。 */
    filePathForStaging?(file: File): string | null;
    /** 粘贴的内存文件：主进程写临时文件并返回路径（之后走 from-path 复制）。 */
    stageInMemoryFile?(name: string, bytes: ArrayBuffer): Promise<string | null>;
    /** staging 完成后删除粘贴临时文件。 */
    discardStagedTempFile?(filePath: string): Promise<void>;
    /** 选择本机目录；返回绝对路径，取消为 null。 */
    selectDirectory?(): Promise<string | null>;
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
    oauthLoopbackCancelWait?(): Promise<void>;
    oauthLoopbackStop?(): Promise<void>;
    /** 对外 Web 登录门面根地址（无尾斜杠）。 */
    webUrl?(): Promise<string>;
    /** 同步 Electron nativeTheme（DevTools / 菜单等）与应用主题。 */
    setThemeSource?(mode: "system" | "light" | "dark"): Promise<void>;
    /** 同步 Dock / 任务栏待处理角标（0 清除）。 */
    setAppBadge?(count: number): Promise<void>;
    /** 同步 macOS 菜单栏图标右侧数字（待审批 + 未读，0 清除）。非 darwin 主进程忽略。 */
    setMenuBarUnread?(count: number): Promise<void>;
    /** 显示或隐藏 macOS 菜单栏图标（含未读提示）。非 darwin 主进程忽略。 */
    setMenuBarVisible?(visible: boolean): Promise<void>;
    /** 触发一次应用更新检查（与系统菜单同一路径）。 */
    checkForUpdates?(): Promise<void>;
    /** 打开已校验域名的安装包下载链接。 */
    openUpdateDownload?(url: string): Promise<void>;
    /** 主进程推送检查结果：checking / available / up-to-date / error */
    onUpdateCheckResult?(
      listener: (payload: {
        status: string;
        latestVersion?: string;
        currentVersion?: string;
        downloadUrl?: string;
        sha512?: string;
        fileName?: string;
        message?: string;
      }) => void,
    ): () => void;
    /** 真实系统是否深色（不受应用 themeSource 覆盖影响） */
    systemPrefersDark?: () => boolean;
    onSystemThemeChanged?: (listener: (prefersDark: boolean) => void) => () => void;
  };
  openedVisit?: string;
}
