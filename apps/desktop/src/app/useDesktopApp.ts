import { computed, onMounted, onScopeDispose, ref, watch } from "vue";

import {
  menuBarAttentionCount,
  totalAttentionBadge,
  totalBlocked,
  totalUnread,
} from "../pages/conversation/model/sidebar/conversation-row";
import {
  groupAttentionBlockedCount,
  groupAttentionFromSnapshot,
} from "../pages/conversation/model/sidebar/group-sidebar";
import { DesktopApi, DesktopApiError } from "../shared/api/runtime";
import type { AttentionSnapshot, BackgroundJobDto, DelegationTaskDto } from "../shared/api/runtime/chat";
import type { GroupRoom } from "../shared/api/runtime/groups";
import { agentDisplayName } from "../shared/components/agent/agent-profile";
import { PERSONAL_ASSISTANT_DEFAULT_AVATAR } from "../shared/model/avatar/personal-assistant-default";
import {
  PERSONAL_ASSISTANT_ID,
  type AgentCard,
  type ChatFontSize,
  type PersonalAssistantProfile,
  type Session,
  type ThemeMode,
} from "../shared/model/runtime/runtime";
import {
  GUEST_SESSION,
  GUEST_USER_ID,
  isAccountSession,
  isGuestSession,
} from "../shared/model/session/session";
import {
  applyUiLocale,
  readDeviceLocale,
  readUiLocale,
  t,
  uiLocale,
  writeDeviceLocale,
  type UiLocale,
} from "../shared/model/ui/ui-locale";
import { showToast } from "../shared/model/ui/toast";
import { bindAuthGate, runWithAccount } from "./auth/auth-gate";
import { loadAgentsLocalFirst } from "./desktop-refresh";
import {
  desktopPulseIntervalMs,
  desktopPulseIsActive,
} from "./desktop-pulse-interval";
import { syncAppBadge, syncMenuBarUnread } from "./native/app-badge";
import {
  freshHitlBanners,
  hitlBannerCopy,
  readBannerSurface,
  replyBannerCopy,
  suppressBecauseViewing,
  type BannerSurface,
} from "./native/system-banner";
import {
  isMenuBarPrefAvailable,
  readMenuBarVisible,
  syncMenuBarVisible,
  writeMenuBarVisible,
} from "./native/menu-bar-pref";
import { clearSession, readSession, saveSession } from "./session/session-store";
import {
  applyChatFontSize,
  clearChatFontMirror,
  readChatFontMirror,
  writeChatFontMirror,
} from "./theme/chat-font";
import { applyTheme, clearThemeMirror, readThemeMirror, writeThemeMirror } from "./theme/theme";

const emptyAttention = (): AttentionSnapshot => ({
  busyAgentIds: [],
  busyTurns: [],
  approvals: [],
  askUsers: [],
  shellHangs: [],
});

const emptyPulseFleets = () => ({
  runningDelegations: [] as DelegationTaskDto[],
  unseenDelegations: [] as DelegationTaskDto[],
  runningJobs: [] as BackgroundJobDto[],
  unseenJobs: [] as BackgroundJobDto[],
});


export function useDesktopApp(api = new DesktopApi()) {
  const session = ref<Session | null>(readSession());
  const agents = ref<AgentCard[]>([]);
  const personalAssistant = ref<PersonalAssistantProfile | null>(null);
  const selectedId = ref("");
  const synced = ref<Record<string, string>>({});
  const unread = ref<Record<string, number>>({});
  const previews = ref<Record<string, string>>({});
  const lastActiveAt = ref<Record<string, number>>({});
  const themeMode = ref<ThemeMode>("system");
  const chatFontSize = ref<ChatFontSize>("md");
  const skipEditResendConfirm = ref(false);
  const menuBarVisible = ref(readMenuBarVisible());
  const menuBarAvailable = computed(() => isMenuBarPrefAvailable());
  const busy = ref(false);
  /** 正在等系统浏览器里的 Web 登录回跳。能力叠层自带取消，菜单 / 账号设置用等待叠层。 */
  const browserLoginActive = ref(false);
  const busyAgent = ref("");
  /** runtime 汇总：busy + 可闭合 HITL（侧栏 / Dock 真相源之一）。 */
  const attention = ref<AttentionSnapshot>(emptyAttention());
  /** pulse 附带：running / unseen 委托与后台作业（会话页 Fleet / toast 共用）。 */
  const pulseFleets = ref(emptyPulseFleets());
  /** pulse 附带：本机群列表（无云 backfill；显式 load 仍走 GET /groups）。 */
  const pulseGroups = ref<GroupRoom[]>([]);
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeBanner: (() => void) | undefined;
  let pulseInFlight = false;
  let pulseActive = false;
  /** null：下一帧 attention 只播种，不弹横幅（冷启动 / 换账号）。 */
  let hitlKnown: Set<string> | null = null;
  let hitlEpoch = 0;
  /** 会话页前台正在看的单聊或群；离开该页则为 null。 */
  const bannerSurface = ref<BannerSurface | null>(null);
  /** 点击系统横幅后要打开的会话；会话页消费后清空。 */
  const pendingNotice = ref<BannerSurface | null>(null);
  /** 递增以丢弃过期的多阶段 refresh 提交（登出 / 连续 refresh）。 */
  let refreshEpoch = 0;

  /** 侧栏会话：私人助理 + 本机私有 + 已招募；不依赖控制面是否在线。 */
  const conversations = computed(() => [
    personalAssistantCard(personalAssistant.value),
    ...agents.value.filter(
      (agent) => agent.kind === "local" || agent.kind === "personal" || agent.recruited,
    ),
  ]);
  const discoveries = computed(() =>
    agents.value.filter((agent) => agent.kind !== "local" && agent.kind !== "personal" && !agent.recruited),
  );
  const selected = computed(() =>
    conversations.value.find((agent) => agent.agentId === selectedId.value),
  );
  const blockedAgentIds = computed(() => {
    const ids = new Set<string>();
    for (const item of attention.value.approvals) {
      if (item.groupId) continue;
      ids.add(item.agentId);
      // 异步委托：HITL 挂在子会话，父会话也算「待处理」以便 Dock / 导航角标。
      if (item.parentAgentId && item.parentAgentId !== item.agentId) {
        ids.add(item.parentAgentId);
      }
    }
    for (const item of attention.value.askUsers) {
      if (item.groupId) continue;
      ids.add(item.agentId);
      if (item.parentAgentId && item.parentAgentId !== item.agentId) {
        ids.add(item.parentAgentId);
      }
    }
    for (const item of attention.value.shellHangs) {
      if (item.groupId) continue;
      ids.add(item.agentId);
      if (item.parentAgentId && item.parentAgentId !== item.agentId) {
        ids.add(item.parentAgentId);
      }
    }
    return ids;
  });
  const blockedCount = computed(() => {
    const visitApprovals = attention.value.approvals.filter((item) => !item.groupId);
    const visitAskUsers = attention.value.askUsers.filter((item) => !item.groupId);
    const parents: string[] = [];
    for (const item of visitApprovals) {
      if (item.parentAgentId && item.parentAgentId !== item.agentId) {
        parents.push(item.parentAgentId);
      }
    }
    for (const item of visitAskUsers) {
      if (item.parentAgentId && item.parentAgentId !== item.agentId) {
        parents.push(item.parentAgentId);
      }
    }
    return (
      totalBlocked(
        visitApprovals.map((item) => item.agentId),
        visitAskUsers.map((item) => item.agentId),
        parents,
      ) + groupAttentionBlockedCount(groupAttentionFromSnapshot(attention.value))
    );
  });
  /** 与侧栏会话行角标之和一致（单聊未读/HITL + 群 HITL），供主导航「消息」角标使用。 */
  const conversationAttentionCount = computed(() => {
    const visit =
      totalAttentionBadge(
        unread.value,
        attention.value.approvals.filter((item) => !item.groupId).map((item) => item.agentId),
        attention.value.askUsers.filter((item) => !item.groupId).map((item) => item.agentId),
      ) + groupAttentionBlockedCount(groupAttentionFromSnapshot(attention.value));
    return visit;
  });

  onMounted(() => {
    if (session.value) void refresh();
    else applyTheme("system");
    const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
    if (typeof bridge?.onSystemBannerOpen === "function") {
      unsubscribeBanner = bridge.onSystemBannerOpen((payload) => {
        const target = readBannerSurface(payload);
        if (target) pendingNotice.value = target;
      });
    }
    // 点击时窗口还在加载，事件会丢；启动后补取一次。
    if (typeof bridge?.takePendingSystemBanner === "function") {
      void bridge.takePendingSystemBanner().then((payload) => {
        const target = readBannerSurface(payload);
        if (target) pendingNotice.value = target;
      }).catch(() => {
        /* 主进程不可用时忽略 */
      });
    }
  });

  watch(
    blockedCount,
    (value) => {
      syncAppBadge(value);
    },
    { immediate: true },
  );

  watch(
    () => menuBarAttentionCount(blockedCount.value, totalUnread(unread.value)),
    (value) => {
      syncMenuBarUnread(value);
    },
    { immediate: true },
  );

  watch(
    menuBarVisible,
    (value) => {
      syncMenuBarVisible(value);
    },
    { immediate: true },
  );

  function setMenuBarVisible(visible: boolean): void {
    menuBarVisible.value = visible;
    writeMenuBarVisible(visible);
  }

  watch(
    () => (session.value ? `${session.value.userId}:${session.value.token}` : ""),
    (key) => {
      stopPulsePoll();
      // 换账号或登出后第一帧只播种，避免把已有待处理事项再弹一遍。
      hitlEpoch += 1;
      hitlKnown = null;
      if (!key) {
        attention.value = emptyAttention();
        pulseFleets.value = emptyPulseFleets();
        pulseGroups.value = [];
        pulseActive = false;
        return;
      }
      void pullPulse();
      schedulePulse();
    },
    { immediate: true },
  );

  function onVisibilityChange(): void {
    if (typeof document === "undefined") return;
    if (!document.hidden && session.value) {
      void pullPulse();
      schedulePulse();
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  onScopeDispose(() => {
    stopPulsePoll();
    unsubscribeBanner?.();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  });

  async function establishAccount(next: Session): Promise<void> {
    const previous = session.value;
    if (isGuestSession(previous)) {
      try {
        await api.migrateGuestUser(next.token, GUEST_USER_ID, next.userId);
      } catch (caught) {
        showToast(messageOf(caught), "error");
      }
    }
    session.value = next;
    await saveSession(next);
    await refresh();
  }

  /** @returns 注册成功时返回 pending 邮箱；登录成功返回 null */
  async function authenticate(
    mode: "login" | "register",
    email: string,
    password: string,
    turnstileToken = "",
  ): Promise<string | null> {
    busy.value = true;
    try {
      if (mode === "register") {
        const pending = await api.register(email, password, turnstileToken);
        return pending.email;
      }
      const next = await api.login(email, password);
      await establishAccount(next);
      return null;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function completeSession(next: Session): Promise<void> {
    busy.value = true;
    try {
      await establishAccount(next);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function resendVerification(
    email: string,
    password: string,
    turnstileToken = "",
  ): Promise<boolean> {
    busy.value = true;
    try {
      await api.resendVerification(email, password, turnstileToken);
      showToast("验证邮件已发送", "success");
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function verifyEmailCode(email: string, code: string): Promise<boolean> {
    busy.value = true;
    try {
      const next = await api.verifyEmail(email, code);
      await establishAccount(next);
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function requestPasswordReset(email: string, turnstileToken = ""): Promise<boolean> {
    busy.value = true;
    try {
      await api.forgotPassword(email, turnstileToken);
      showToast("若账号存在，重置邮件已发送", "success");
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function confirmPasswordReset(email: string, code: string, password: string): Promise<boolean> {
    busy.value = true;
    try {
      const next = await api.resetPassword(email, code, password);
      await establishAccount(next);
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** 进行中的浏览器登录地址；关掉网页后用同一 loopback 再打开。 */
  let browserLoginUrl = "";
  /** 取消 / 重新发起时递增，避免旧 wait 的 finally 清掉新一轮 busy。 */
  let browserLoginFlight = 0;

  /** 再次打开当前这次登录页，不重新换 loopback。 */
  async function reopenBrowserLogin(): Promise<void> {
    const url = browserLoginUrl;
    const open = window.agentUp?.openExternal;
    if (!url || !open) {
      showToast(t("loginFailed"), "error");
      return;
    }
    try {
      await open(url);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    }
  }

  /** 结束本次等待（不关 loopback 端口，网页注册仍可回跳）。 */
  async function cancelBrowserLogin(): Promise<void> {
    browserLoginFlight += 1;
    busy.value = false;
    browserLoginActive.value = false;
    try {
      // 优先只取消 wait；旧桥没有 cancel 时再 stop
      if (window.agentUp?.oauthLoopbackCancelWait) {
        await window.agentUp.oauthLoopbackCancelWait();
      } else {
        browserLoginUrl = "";
        await window.agentUp?.oauthLoopbackStop?.();
      }
    } catch {
      /* ignore */
    }
  }

  async function exchangeBrowserCode(code: string): Promise<boolean> {
    // 换票前清掉同码暂存，防止 wait 与自动续登各消费一次
    void window.agentUp?.oauthLoopbackTakePending?.().catch(() => undefined);
    const next = await api.oauthExchange(code);
    await establishAccount(next);
    return true;
  }

  /** Web 鉴权页相对路径（不含语言前缀；统一挂在 /auth）。 */
  type BrowserAuthPath = "auth/login" | "auth/forgot-password" | "auth/change-password";

  /** 打开系统浏览器中的 Web 鉴权页，经 loopback 换票（邮箱 / OAuth / Turnstile 均在 Web）。 */
  async function loginWithBrowser(options: {
    path?: BrowserAuthPath;
    /** 已登录改密：一次性 bridge，供 Web 换临时会话；勿信 URL 邮箱。 */
    bridgeCode?: string;
  } = {}): Promise<boolean> {
    const bridge = window.agentUp;
    if (!bridge?.oauthLoopbackStart || !bridge.openExternal || !bridge.oauthLoopbackWait) {
      showToast(t("loginDesktopOnly"), "error");
      return false;
    }
    const path = options.path ?? "auth/login";
    const flight = ++browserLoginFlight;
    busy.value = true;
    try {
      // 登录/找回可复用暂存回跳；改密必须带新 bridge，勿吞掉旧码
      if (path !== "auth/change-password") {
        const pending = (await bridge.oauthLoopbackTakePending?.()) ?? null;
        if (pending?.code) {
          if (flight !== browserLoginFlight) return false;
          return await exchangeBrowserCode(pending.code);
        }
      }

      const uiLocale = readUiLocale();
      const { loopbackUri } = await bridge.oauthLoopbackStart(uiLocale);
      if (flight !== browserLoginFlight) return false;
      const webRoot = (await bridge.webUrl?.()) || "http://127.0.0.1:3000";
      /** Web：/ = en，/zh/ = zh；鉴权页同前缀 */
      const prefixed = uiLocale === "zh" ? `/zh/${path}` : `/${path}`;
      const url = new URL(`${webRoot.replace(/\/$/, "")}${prefixed}`);
      url.searchParams.set("client", "desktop");
      url.searchParams.set("loopback_uri", loopbackUri);
      if (options.bridgeCode) {
        url.searchParams.set("bridge", options.bridgeCode);
      }
      browserLoginUrl = url.toString();
      browserLoginActive.value = true;
      await bridge.openExternal(browserLoginUrl);
      const { code } = await bridge.oauthLoopbackWait();
      if (flight !== browserLoginFlight) return false;
      return await exchangeBrowserCode(code);
    } catch (caught) {
      if (flight !== browserLoginFlight) return false;
      const raw = caught instanceof Error ? caught.message : "";
      if (raw === "已取消登录") return false;
      const message = caught instanceof Error && caught.message ? caught.message : messageOf(caught);
      if (message) showToast(message, "error");
      return false;
    } finally {
      if (flight === browserLoginFlight) {
        browserLoginUrl = "";
        browserLoginActive.value = false;
        busy.value = false;
        // 延迟关 loopback：成功页「打开 AgentUp」走同端口 /open；立刻 stop 会 Connection refused
        window.setTimeout(() => {
          if (flight !== browserLoginFlight) return;
          void window.agentUp?.oauthLoopbackStop?.().catch(() => undefined);
        }, 120_000);
      }
    }
  }

  async function loginWithOAuth(provider: "github" | "google"): Promise<boolean> {
    void provider;
    return loginWithBrowser();
  }

  /** 菜单 / 账号设置：直接打开 Web 登录。进行中则只重新打开同一页。 */
  function beginBrowserLogin(): void {
    if (browserLoginActive.value) {
      void reopenBrowserLogin();
      return;
    }
    if (busy.value) return;
    void loginWithBrowser({ path: "auth/login" });
  }

  /** 游客账号设置：打开 Web 忘记密码页。 */
  function beginForgotPassword(): void {
    if (browserLoginActive.value) {
      void reopenBrowserLogin();
      return;
    }
    if (busy.value) return;
    void loginWithBrowser({ path: "auth/forgot-password" });
  }

  /** 已登录账号设置：签发 bridge 后打开 Web 改密页（邮箱以会话为准）。 */
  function beginChangePassword(): void {
    if (browserLoginActive.value) {
      void reopenBrowserLogin();
      return;
    }
    if (busy.value) return;
    const current = session.value;
    if (!current || !isAccountSession(current)) return;
    void (async () => {
      try {
        const bridgeCode = await api.desktopHandoff(current.token);
        await loginWithBrowser({ path: "auth/change-password", bridgeCode });
      } catch (caught) {
        showToast(messageOf(caught), "error");
      }
    })();
  }

  async function refresh(): Promise<void> {
    if (!session.value) return;
    const epoch = ++refreshEpoch;
    const guest = isGuestSession(session.value);
    const { token, userId } = session.value;
    const accountForAvatar = !guest && isAccountSession(session.value) ? session.value : null;
    const stale = () => epoch !== refreshEpoch || !session.value;

    // 本机优先：先提交本机+磁盘投影到侧栏；账号头像续签与远端对齐并行、不挡首屏
    await loadAgentsLocalFirst({
      hydrateAccountAvatar: accountForAvatar
        ? () => hydrateAccountAvatar(accountForAvatar)
        : undefined,
      loadPersonalAssistant: () => api.personalAssistantProfile(token, userId, readUiLocale()),
      loadLocalAgents: () => api.localAgents(token, userId),
      loadProjectedAgents: () => api.agents(token, { userId, projected: true }),
      // 游客也会请求：控制面失败时 runtime 回落磁盘已投影
      loadRemoteAgents: () => api.agents(token, { userId }),
      isStale: stale,
      readPreviousAgents: () => agents.value,
      commitPersonalAssistant: (profile) => {
        if (!stale()) personalAssistant.value = profile;
      },
      commitAgents: (next) => {
        if (stale()) return;
        agents.value = next;
        synced.value = Object.fromEntries(
          next
            .filter((agent) => agent.localVersion > 0)
            .map((agent) => [agent.agentId, String(agent.localVersion)]),
        );
        synced.value[PERSONAL_ASSISTANT_ID] = "1";
      },
    });
    if (stale() || !session.value) return;

    try {
      const state = await api.state(token, userId);
      if (stale()) return;
      unread.value = state.unread;
      previews.value = state.previews;
      lastActiveAt.value = state.lastActiveAt;
    } catch {
      if (stale()) return;
      unread.value = {};
      previews.value = {};
      lastActiveAt.value = {};
    }
    await pullAttention();
    if (stale() || !session.value) return;
    await syncPreferences(token, userId, guest);
    if (stale()) return;
    if (!conversations.value.some((agent) => agent.agentId === selectedId.value)) {
      selectedId.value = conversations.value[0]?.agentId ?? "";
    }
    if (selectedId.value) void clearUnread(selectedId.value);
  }

  async function syncPreferences(token: string, userId: string, guest: boolean): Promise<void> {
    if (guest) {
      await applyUiLocale(readDeviceLocale());
      const mirrored = readThemeMirror(userId);
      if (mirrored) {
        themeMode.value = mirrored;
        applyTheme(mirrored);
      }
      const fontMirrored = readChatFontMirror(userId);
      if (fontMirrored) {
        chatFontSize.value = fontMirrored;
        applyChatFontSize(fontMirrored);
      }
      return;
    }
    try {
      const prefs = await api.preferences(token);
      themeMode.value = prefs.themeMode;
      chatFontSize.value = prefs.chatFontSize;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(userId, prefs.themeMode);
      applyChatFontSize(prefs.chatFontSize);
      writeChatFontMirror(userId, prefs.chatFontSize);
      await applyUiLocale(prefs.uiLocale);
    } catch {
      /* 保持当前偏好；下次 refresh 再对齐 */
    }
  }

  /** 游客写入本机；正式账号写入偏好，并同时套用账号主题。 */
  async function setUiLocale(next: UiLocale): Promise<boolean> {
    const guest = !session.value || isGuestSession(session.value);
    if (uiLocale.value === next) {
      if (guest) writeDeviceLocale(next);
      return true;
    }
    const previous = uiLocale.value;
    await applyUiLocale(next);
    if (guest) {
      writeDeviceLocale(next);
      void refresh();
      return true;
    }
    const current = session.value;
    if (!current) return false;
    try {
      const prefs = await api.savePreferences(current.token, { uiLocale: next });
      themeMode.value = prefs.themeMode;
      chatFontSize.value = prefs.chatFontSize;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(current.userId, prefs.themeMode);
      applyChatFontSize(prefs.chatFontSize);
      writeChatFontMirror(current.userId, prefs.chatFontSize);
      await applyUiLocale(prefs.uiLocale);
      void refresh();
      return true;
    } catch (caught) {
      await applyUiLocale(previous);
      showToast(messageOf(caught), "error");
      return false;
    }
  }

  /** 账号级：编辑重发会回滚文件时是否不再弹出确认。 */
  async function setSkipEditResendConfirm(skip: boolean): Promise<void> {
    if (!session.value || isGuestSession(session.value)) return;
    const previous = skipEditResendConfirm.value;
    skipEditResendConfirm.value = skip;
    try {
      const prefs = await api.savePreferences(session.value.token, {
        skipEditResendConfirm: skip,
      });
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      themeMode.value = prefs.themeMode;
      chatFontSize.value = prefs.chatFontSize;
      applyChatFontSize(prefs.chatFontSize);
      writeChatFontMirror(session.value.userId, prefs.chatFontSize);
      await applyUiLocale(prefs.uiLocale);
    } catch (caught) {
      skipEditResendConfirm.value = previous;
      showToast(messageOf(caught), "error");
      throw caught;
    }
  }

  /** 游客写本机镜像；正式账号写偏好。 */
  async function setChatFontSize(next: ChatFontSize): Promise<boolean> {
    if (!session.value || chatFontSize.value === next) return true;
    const previous = chatFontSize.value;
    chatFontSize.value = next;
    applyChatFontSize(next);
    writeChatFontMirror(session.value.userId, next);
    if (isGuestSession(session.value)) return true;
    try {
      const prefs = await api.savePreferences(session.value.token, { chatFontSize: next });
      chatFontSize.value = prefs.chatFontSize;
      themeMode.value = prefs.themeMode;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyChatFontSize(prefs.chatFontSize);
      writeChatFontMirror(session.value.userId, prefs.chatFontSize);
      applyTheme(prefs.themeMode);
      writeThemeMirror(session.value.userId, prefs.themeMode);
      await applyUiLocale(prefs.uiLocale);
      return true;
    } catch (caught) {
      chatFontSize.value = previous;
      applyChatFontSize(previous);
      writeChatFontMirror(session.value.userId, previous);
      showToast(messageOf(caught), "error");
      return false;
    }
  }

  function select(agent: AgentCard): void {
    selectedId.value = agent.agentId;
    void clearUnread(agent.agentId);
  }

  async function start(agent: AgentCard): Promise<void> {
    if (!session.value) return;
    select(agent);
    // 私人助理 / 本机私有已可聊，无需招募
    if (agent.kind === "personal" || agent.kind === "local") return;
    await runWithAccount("agent.recruit", async () => {
      const current = session.value;
      if (!current || isGuestSession(current)) return;
      busyAgent.value = agent.agentId;
      try {
        if (!agent.recruited) await api.recruit(current.token, agent.agentId);
        const visit = await api.sync(current.token, agent.agentId, current.userId);
        synced.value = { ...synced.value, [agent.agentId]: String(visit.packageVersion) };
        await refresh();
        selectedId.value = agent.agentId;
      } catch (caught) {
        showToast(messageOf(caught), "error");
      } finally {
        busyAgent.value = "";
      }
    });
  }

  async function persistState(
    nextUnread: Record<string, number>,
    nextPreviews: Record<string, string>,
    nextLastActiveAt: Record<string, number>,
  ): Promise<void> {
    if (!session.value) return;
    unread.value = nextUnread;
    previews.value = nextPreviews;
    lastActiveAt.value = nextLastActiveAt;
    try {
      const saved = await api.saveState(
        session.value.token,
        session.value.userId,
        nextUnread,
        nextPreviews,
        nextLastActiveAt,
      );
      unread.value = saved.unread;
      previews.value = saved.previews;
      lastActiveAt.value = saved.lastActiveAt;
    } catch {
      /* 保持内存状态；下次 refresh 再对齐 */
    }
  }

  /** 回合结束：写入侧栏预览与最近活跃；非当前会话时累加未读。 */
  async function recordTurnEnd(agentId: string, preview: string): Promise<void> {
    if (!session.value) return;
    const nextPreviews = { ...previews.value };
    const clipped = preview.trim();
    if (clipped) nextPreviews[agentId] = clipped;
    else delete nextPreviews[agentId];
    const nextLastActiveAt = { ...lastActiveAt.value, [agentId]: Date.now() };
    const nextUnread =
      agentId === selectedId.value
        ? unread.value
        : { ...unread.value, [agentId]: (unread.value[agentId] ?? 0) + 1 };
    const agent = conversations.value.find((item) => item.agentId === agentId);
    announceReply(
      { kind: "agent", id: agentId },
      agent ? agentDisplayName(agent) : agentId,
      preview,
    );
    await persistState(nextUnread, nextPreviews, nextLastActiveAt);
  }

  /** 调用方已判定「该记一条未读」（如群回合结束且你不在该群）。 */
  async function bumpUnread(id: string): Promise<void> {
    if (!session.value || !id) return;
    const nextUnread = { ...unread.value, [id]: (unread.value[id] ?? 0) + 1 };
    await persistState(nextUnread, previews.value, lastActiveAt.value);
  }

  async function clearUnread(id: string): Promise<void> {
    if (!session.value || !id || !unread.value[id]) return;
    const next = { ...unread.value };
    delete next[id];
    await persistState(next, previews.value, lastActiveAt.value);
  }

  async function pullPulse(): Promise<void> {
    if (!session.value) {
      attention.value = emptyAttention();
      pulseFleets.value = emptyPulseFleets();
      pulseGroups.value = [];
      pulseActive = false;
      return;
    }
    if (pulseInFlight) return;
    pulseInFlight = true;
    const wasActive = pulseActive;
    const epoch = hitlEpoch;
    try {
      const snap = await api.desktopPulse(session.value.token, session.value.userId);
      attention.value = snap.attention;
      pulseFleets.value = {
        runningDelegations: snap.runningDelegations,
        unseenDelegations: snap.unseenDelegations,
        runningJobs: snap.runningJobs,
        unseenJobs: snap.unseenJobs,
      };
      pulseGroups.value = snap.groups;
      // 过期脉冲（换了账号）不弹，避免把上一身份的待处理事项通知出来。
      if (epoch === hitlEpoch) publishHitlBanners(snap.attention);
      pulseActive = desktopPulseIsActive({
        busyAgentIds: snap.attention.busyAgentIds,
        approvals: snap.attention.approvals,
        askUsers: snap.attention.askUsers,
        shellHangs: snap.attention.shellHangs,
        runningDelegations: snap.runningDelegations,
        runningJobs: snap.runningJobs,
        unseenDelegations: snap.unseenDelegations,
        unseenJobs: snap.unseenJobs,
        groups: snap.groups,
      });
      // 空闲→活跃时立刻按短间隔重排，避免卡在 12s 空闲拍上。
      if (wasActive !== pulseActive) schedulePulse();
    } catch {
      /* 保持上一帧；下次轮询再对齐 */
    } finally {
      pulseInFlight = false;
    }
  }

  function windowFocused(): boolean {
    return typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus();
  }

  function setBannerSurface(next: BannerSurface | null): void {
    bannerSurface.value = next;
  }

  function surfaceTitle(target: BannerSurface): string {
    if (target.kind === "group") {
      const title = pulseGroups.value.find((room) => room.id === target.id)?.title.trim() ?? "";
      return title || t("groupTitle");
    }
    const agent = conversations.value.find((item) => item.agentId === target.id);
    return agent ? agentDisplayName(agent) : t("navMessages");
  }

  /** 前台正看着这条会话时不弹。无桥接（浏览器 / 测试）时静默。 */
  function announceBanner(input: { title: string; body: string; target: BannerSurface }): void {
    if (suppressBecauseViewing(windowFocused(), bannerSurface.value, input.target)) return;
    const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
    if (typeof bridge?.showSystemBanner !== "function") return;
    void bridge
      .showSystemBanner({
        ...input,
        // Windows toast 按钮文案；macOS 点横幅本体即可，有签名时也会显示按钮。
        actionLabel: t("osBannerOpenChat"),
      })
      .catch(() => {
        /* 主进程不可用时忽略 */
      });
  }

  function announceReply(target: BannerSurface, title: string, preview: string): void {
    const copy = replyBannerCopy(title, preview);
    announceBanner({ ...copy, target });
  }

  function publishHitlBanners(snap: AttentionSnapshot): void {
    const step = freshHitlBanners(hitlKnown, snap);
    hitlKnown = step.known;
    for (const item of step.fresh) {
      const copy = hitlBannerCopy(surfaceTitle(item.target), item);
      announceBanner({ ...copy, target: item.target });
    }
  }

  /** 兼容旧调用点：HITL 后仍只关心 attention，但走合并脉冲。 */
  async function pullAttention(): Promise<void> {
    await pullPulse();
  }

  function schedulePulse(): void {
    stopPulsePoll();
    if (!session.value) return;
    const hidden = typeof document !== "undefined" && document.hidden;
    const delay = desktopPulseIntervalMs({ hidden, active: pulseActive });
    pulseTimer = setTimeout(() => {
      void pullPulse().finally(() => {
        schedulePulse();
      });
    }, delay);
  }

  function stopPulsePoll(): void {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = undefined;
  }

  /** 设置账号级备注名（backend 招募关系）；空字符串表示清除。 */
  async function setRemark(agentId: string, remark: string): Promise<void> {
    if (!session.value || isGuestSession(session.value)) return;
    if (agentId === PERSONAL_ASSISTANT_ID) return;
    const saved = await api.setRemark(session.value.token, agentId, remark);
    agents.value = agents.value.map((agent) =>
      agent.agentId === agentId ? { ...agent, remark: saved } : agent,
    );
  }

  /** 解除招募并永久删除本机对话记录与工作产物。 */
  async function dismiss(agentId: string): Promise<void> {
    if (!session.value || busyAgent.value || isGuestSession(session.value)) return;
    if (agentId === PERSONAL_ASSISTANT_ID) return;
    busyAgent.value = agentId;
    try {
      await api.dismiss(session.value.token, agentId, session.value.userId);
      await refresh();
    } finally {
      busyAgent.value = "";
    }
  }

  /**
   * 冷启动 / refresh：本机缓存优先展示，再向控制面续签并更新缓存。
   * 由 loadAgentsLocalFirst 并行触发，不阻塞侧栏本地提交。
   * 避免 session.enc 里过期的 q-sign URL 一打开就 403。
   */
  async function hydrateAccountAvatar(current: Session): Promise<void> {
    if (!isAccountSession(current) || !current.hasAvatar) return;
    if (current.avatarUrl && !current.avatarUrl.startsWith("data:")) {
      try {
        const local = await api.accountAvatar(current.userId);
        if (local) {
          const patched = { ...current, avatarUrl: local };
          session.value = patched;
          await saveSession(patched);
        }
      } catch {
        /* 无本机缓存时继续尝试控制面续签 */
      }
    }
    try {
      const fresh = await api.fetchMe(current.token);
      session.value = fresh;
      await saveSession(fresh);
    } catch {
      /* 离线保留当前（已尽量换成 data URL） */
    }
  }

  /** 更新展示昵称与可选头像；邮箱不变，成功后覆盖本机 session。 */
  async function updateProfile(
    nickname: string,
    options: { avatarBase64?: string } = {},
  ): Promise<Session> {
    if (!session.value || !isAccountSession(session.value)) throw new DesktopApiError("未登录");
    const next = await api.updateProfile(session.value.token, nickname, options);
    session.value = next;
    await saveSession(next);
    return next;
  }

  async function updateNickname(nickname: string): Promise<Session> {
    return updateProfile(nickname);
  }

  /** 登出后落回游客，可继续用自备模型；账号目录数据保留。 */
  async function logout(): Promise<void> {
    // 先落游客身份：偏好 / refresh 失败时也不要卡在账号昵称。
    await clearSession();
    const guest = { ...GUEST_SESSION };
    await saveSession(guest);
    session.value = guest;

    agents.value = [];
    personalAssistant.value = null;
    selectedId.value = "";
    synced.value = {};
    unread.value = {};
    previews.value = {};
    lastActiveAt.value = {};
    attention.value = emptyAttention();
    pulseFleets.value = emptyPulseFleets();
    pulseGroups.value = [];
    pulseActive = false;
    stopPulsePoll();
    themeMode.value = "system";
    chatFontSize.value = "md";
    skipEditResendConfirm.value = false;
    clearThemeMirror();
    clearChatFontMirror();
    applyTheme("system");
    applyChatFontSize("md");
    try {
      await applyUiLocale(readDeviceLocale());
    } catch {
      /* 游客已落盘；语言下次进页再对齐 */
    }
    try {
      await refresh();
    } catch {
      /* 游客已落盘；列表下次进页再对齐 */
    }
  }

  bindAuthGate({
    isAccount: () => isAccountSession(session.value),
    login: () => loginWithBrowser(),
    cancelLogin: () => cancelBrowserLogin(),
  });

  return {
    session,
    agents,
    personalAssistant,
    selected,
    selectedId,
    conversations,
    discoveries,
    synced,
    unread,
    previews,
    lastActiveAt,
    attention,
    pulseFleets,
    pulseGroups,
    blockedAgentIds,
    blockedCount,
    conversationAttentionCount,
    themeMode,
    chatFontSize,
    setChatFontSize,
    uiLocale,
    setUiLocale,
    skipEditResendConfirm,
    menuBarAvailable,
    menuBarVisible,
    setMenuBarVisible,
    busy,
    browserLoginActive,
    busyAgent,
    pullAttention,
    pullPulse,
    authenticate,
    completeSession,
    resendVerification,
    verifyEmailCode,
    requestPasswordReset,
    confirmPasswordReset,
    loginWithBrowser,
    beginBrowserLogin,
    beginForgotPassword,
    beginChangePassword,
    reopenBrowserLogin,
    cancelBrowserLogin,
    loginWithOAuth,
    refresh,
    select,
    start,
    recordTurnEnd,
    announceReply,
    setBannerSurface,
    pendingNotice,
    bumpUnread,
    clearUnread,
    setRemark,
    setSkipEditResendConfirm,
    updateNickname,
    updateProfile,
    dismiss,
    logout,
  };
}

function personalAssistantCard(profile: PersonalAssistantProfile | null): AgentCard {
  const avatarUrl = profile?.avatarUrl || PERSONAL_ASSISTANT_DEFAULT_AVATAR;
  // 名称以 profile 为准（runtime 已按 locale 解析出厂默认）；勿再二次改写，否则与设置页不一致。
  return {
    kind: "personal",
    agentId: PERSONAL_ASSISTANT_ID,
    name: profile?.name?.trim() || t("assistantNamePlaceholder"),
    role: profile?.role || t("assistantRole"),
    background: profile?.background || t("personalAssistantSummary"),
    latestVersion: 1,
    latestDigest: "personal-assistant-v1",
    localVersion: 1,
    recruited: true,
    hasAvatar: true,
    avatarUrl,
    remark: "",
    recruitCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}

function messageOf(caught: unknown): string {
  if (!(caught instanceof DesktopApiError)) return "请求失败";
  if (caught.status && caught.status >= 400) return `${caught.message}（${caught.status}）`;
  return caught.message;
}
