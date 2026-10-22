import { computed, onMounted, onScopeDispose, ref, watch } from "vue";

import { totalBlocked } from "../pages/conversation/model/conversation-row";
import { DesktopApi, DesktopApiError } from "../shared/api/runtime";
import type { AttentionSnapshot } from "../shared/api/runtime/chat";
import { PERSONAL_ASSISTANT_DEFAULT_AVATAR } from "../shared/model/personal-assistant-default";
import {
  PERSONAL_ASSISTANT_ID,
  type AgentCard,
  type PersonalAssistantProfile,
  type Session,
  type ThemeMode,
} from "../shared/model/runtime";
import { GUEST_USER_ID, isAccountSession, isGuestSession } from "../shared/model/session";
import {
  applyUiLocale,
  readDeviceLocale,
  readUiLocale,
  t,
  uiLocale,
  writeDeviceLocale,
  type UiLocale,
} from "../shared/model/ui-locale";
import { showToast } from "../shared/model/toast";
import { syncAppBadge } from "./app-badge";
import { bindAuthGate, runWithAccount } from "./auth-gate";
import { clearSession, ensureGuestSession, readSession, saveSession } from "./session-store";
import { applyTheme, clearThemeMirror, readThemeMirror, writeThemeMirror } from "./theme";

const ATTENTION_POLL_MS = 2_500;

const emptyAttention = (): AttentionSnapshot => ({
  busyAgentIds: [],
  approvals: [],
  askUsers: [],
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
  const skipEditResendConfirm = ref(false);
  const busy = ref(false);
  const busyAgent = ref("");
  /** runtime 汇总：busy + 可闭合 HITL（侧栏 / Dock 真相源之一）。 */
  const attention = ref<AttentionSnapshot>(emptyAttention());
  let attentionPoll: ReturnType<typeof setInterval> | undefined;

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
    for (const item of attention.value.approvals) ids.add(item.agentId);
    for (const item of attention.value.askUsers) ids.add(item.agentId);
    return ids;
  });
  const blockedCount = computed(() =>
    totalBlocked(
      attention.value.approvals.map((item) => item.agentId),
      attention.value.askUsers.map((item) => item.agentId),
    ),
  );

  onMounted(() => {
    if (session.value) void refresh();
    else applyTheme("system");
  });

  watch(
    blockedCount,
    (value) => {
      syncAppBadge(value);
    },
    { immediate: true },
  );

  watch(
    () => (session.value ? `${session.value.userId}:${session.value.token}` : ""),
    (key) => {
      stopAttentionPoll();
      if (!key) {
        attention.value = emptyAttention();
        return;
      }
      void pullAttention();
      attentionPoll = setInterval(() => {
        void pullAttention();
      }, ATTENTION_POLL_MS);
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stopAttentionPoll();
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

  /** 打开系统浏览器中的 Web 登录页，经 loopback 换票（邮箱 / OAuth / Turnstile 均在 Web）。 */
  async function loginWithBrowser(): Promise<boolean> {
    const bridge = window.agentUp;
    if (!bridge?.oauthLoopbackStart || !bridge.openExternal || !bridge.oauthLoopbackWait) {
      showToast(t("loginDesktopOnly"), "error");
      return false;
    }
    const flight = ++browserLoginFlight;
    busy.value = true;
    try {
      // 注册回跳可能已到达（等待被取消 / 页面刷新），先领暂存码，不必再开浏览器
      const pending = (await bridge.oauthLoopbackTakePending?.()) ?? null;
      if (pending?.code) {
        if (flight !== browserLoginFlight) return false;
        return await exchangeBrowserCode(pending.code);
      }

      const uiLocale = readUiLocale();
      const { loopbackUri } = await bridge.oauthLoopbackStart(uiLocale);
      if (flight !== browserLoginFlight) return false;
      const webRoot = (await bridge.webUrl?.()) || "http://127.0.0.1:3000";
      /** Web：/ = en，/zh/ = zh；登录页同前缀 */
      const loginPath = uiLocale === "zh" ? "/zh/login" : "/login";
      const url = new URL(`${webRoot.replace(/\/$/, "")}${loginPath}`);
      url.searchParams.set("client", "desktop");
      url.searchParams.set("loopback_uri", loopbackUri);
      browserLoginUrl = url.toString();
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

  async function refresh(): Promise<void> {
    if (!session.value) return;
    const { token, userId } = session.value;
    const guest = isGuestSession(session.value);

    try {
      personalAssistant.value = await api.personalAssistantProfile(token, userId, readUiLocale());
    } catch {
      personalAssistant.value = null;
    }

    // 本机优先：侧栏 / 对话不依赖登录或控制面；各路失败互不影响
    let local: AgentCard[] = [];
    try {
      local = await api.localAgents(token, userId);
    } catch {
      local = [];
    }
    let remote: AgentCard[] = [];
    try {
      // 游客也会请求：控制面失败时 runtime 回落磁盘已投影，仍可列出本机会话
      remote = await api.agents(token, { userId });
    } catch {
      remote = [];
    }
    const seen = new Set(local.map((agent) => agent.agentId));
    agents.value = [...local, ...remote.filter((agent) => !seen.has(agent.agentId))];

    synced.value = Object.fromEntries(
      agents.value
        .filter((agent) => agent.localVersion > 0)
        .map((agent) => [agent.agentId, String(agent.localVersion)]),
    );
    synced.value[PERSONAL_ASSISTANT_ID] = "1";
    try {
      const state = await api.state(token, userId);
      unread.value = state.unread;
      previews.value = state.previews;
      lastActiveAt.value = state.lastActiveAt;
    } catch {
      unread.value = {};
      previews.value = {};
      lastActiveAt.value = {};
    }
    await pullAttention();
    await syncPreferences(token, userId, guest);
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
      return;
    }
    try {
      const prefs = await api.preferences(token);
      themeMode.value = prefs.themeMode;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(userId, prefs.themeMode);
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
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(current.userId, prefs.themeMode);
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
      await applyUiLocale(prefs.uiLocale);
    } catch (caught) {
      skipEditResendConfirm.value = previous;
      showToast(messageOf(caught), "error");
      throw caught;
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
    await persistState(nextUnread, nextPreviews, nextLastActiveAt);
  }

  async function clearUnread(agentId: string): Promise<void> {
    if (!session.value || !unread.value[agentId]) return;
    const next = { ...unread.value };
    delete next[agentId];
    await persistState(next, previews.value, lastActiveAt.value);
  }

  async function pullAttention(): Promise<void> {
    if (!session.value) {
      attention.value = emptyAttention();
      return;
    }
    try {
      attention.value = await api.attention(session.value.token, session.value.userId);
    } catch {
      /* 保持上一帧；下次轮询再对齐 */
    }
  }

  function stopAttentionPoll(): void {
    if (attentionPoll) clearInterval(attentionPoll);
    attentionPoll = undefined;
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

  /** 登出后落回游客，可继续用自备模型；账号目录数据保留，不自动进登录页。 */
  async function logout(): Promise<void> {
    agents.value = [];
    personalAssistant.value = null;
    selectedId.value = "";
    synced.value = {};
    unread.value = {};
    previews.value = {};
    lastActiveAt.value = {};
    attention.value = emptyAttention();
    stopAttentionPoll();
    themeMode.value = "system";
    skipEditResendConfirm.value = false;
    clearThemeMirror();
    applyTheme("system");
    await applyUiLocale(readDeviceLocale());
    await clearSession();
    session.value = await ensureGuestSession();
    await refresh();
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
    blockedAgentIds,
    blockedCount,
    themeMode,
    uiLocale,
    setUiLocale,
    skipEditResendConfirm,
    busy,
    busyAgent,
    pullAttention,
    authenticate,
    completeSession,
    resendVerification,
    verifyEmailCode,
    requestPasswordReset,
    confirmPasswordReset,
    loginWithBrowser,
    reopenBrowserLogin,
    cancelBrowserLogin,
    loginWithOAuth,
    refresh,
    select,
    start,
    recordTurnEnd,
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
