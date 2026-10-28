import { ref } from "vue";

import { t } from "../../shared/model/ui/ui-locale";
import { capabilityReasonKey, type CapabilityId } from "./capabilities";

type ResumeFn = () => void | Promise<void>;

type AuthGateBindings = {
  isAccount: () => boolean;
  login: () => Promise<boolean>;
  cancelLogin: () => Promise<void>;
};

/** 能力闸门叠层：留在当前页说明原因，由用户选择去登录或取消。 */
export const authPromptOpen = ref(false);
export const authPromptReason = ref("");
export const authPromptBusy = ref(false);

let bindings: AuthGateBindings | null = null;
let gateReadyWaiters: Array<() => void> = [];
let pendingResume: ResumeFn | null = null;
/** 等待用户在叠层上确认或取消。 */
let waiter: Promise<boolean> | null = null;
let settleWaiter: ((ok: boolean) => void) | null = null;
/** 取消时递增，避免进行中的 login 结束后误关叠层或重放意图。 */
let flightGeneration = 0;

function settleGateReady(): void {
  const pending = gateReadyWaiters;
  gateReadyWaiters = [];
  for (const resolve of pending) resolve();
}

/** 由 `useDesktopApp` 注入登录实现；路由与 composable 经本模块调用，不依赖 inject。 */
export function bindAuthGate(next: AuthGateBindings): void {
  bindings = next;
  settleGateReady();
}

export function isAuthGateReady(): boolean {
  return bindings !== null;
}

/** 冷启动的第一次导航可能早于 `App` 挂载；等到闸门 bind 再决定拦不拦。 */
export function whenAuthGateReady(): Promise<void> {
  if (bindings) return Promise.resolve();
  return new Promise((resolve) => {
    gateReadyWaiters.push(resolve);
  });
}

/** 测试用：清掉进行中的闸门状态。 */
export function resetAuthGate(): void {
  pendingResume = null;
  waiter = null;
  settleWaiter = null;
  flightGeneration += 1;
  authPromptOpen.value = false;
  authPromptReason.value = "";
  authPromptBusy.value = false;
  bindings = null;
  settleGateReady();
}

function openWaiter(): Promise<boolean> {
  if (waiter) return waiter;
  waiter = new Promise<boolean>((resolve) => {
    settleWaiter = resolve;
  });
  return waiter;
}

function finishWaiter(ok: boolean): void {
  settleWaiter?.(ok);
  settleWaiter = null;
  waiter = null;
}

/**
 * 已登录则直接执行；游客则记下意图并打开叠层（不自动打开浏览器）。
 * 用户点「去登录」且成功后只重放最后一次意图；取消则丢弃。
 */
export async function runWithAccount(capability: CapabilityId, action: ResumeFn): Promise<boolean> {
  if (bindings?.isAccount()) {
    await action();
    return true;
  }

  pendingResume = action;
  authPromptReason.value = t(capabilityReasonKey(capability));
  authPromptOpen.value = true;
  return openWaiter();
}

/** 用户确认去登录：打开系统浏览器；成功后重放意图并关闭叠层。失败则留在叠层可重试。 */
export async function confirmAuthPrompt(): Promise<void> {
  const gate = bindings;
  if (!gate || authPromptBusy.value) return;

  const generation = ++flightGeneration;
  authPromptBusy.value = true;
  try {
    const ok = await gate.login();
    if (generation !== flightGeneration) return;
    if (!ok) return;

    const resume = pendingResume;
    pendingResume = null;
    authPromptOpen.value = false;
    if (resume) await resume();
    finishWaiter(true);
  } finally {
    if (generation === flightGeneration) {
      authPromptBusy.value = false;
    }
  }
}

/** 用户取消叠层：丢掉意图；若正在等浏览器则中止 loopback。 */
export async function cancelAuthPrompt(): Promise<void> {
  pendingResume = null;
  flightGeneration += 1;
  authPromptOpen.value = false;
  authPromptBusy.value = false;
  finishWaiter(false);
  try {
    await bindings?.cancelLogin();
  } catch {
    /* ignore */
  }
}
