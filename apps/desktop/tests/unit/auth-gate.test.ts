import { beforeEach, expect, it, vi } from "vitest";

import {
  authPromptBusy,
  authPromptOpen,
  authPromptReason,
  bindAuthGate,
  cancelAuthPrompt,
  confirmAuthPrompt,
  resetAuthGate,
  runWithAccount,
} from "../../src/app/auth-gate";
import { CAPABILITIES, isHostedProviderKind } from "../../src/app/capabilities";
import { applyUiLocale } from "../../src/shared/model/ui/ui-locale";

beforeEach(async () => {
  resetAuthGate();
  await applyUiLocale("zh");
});

it("能力表为发布、招募与托管模型保留原因文案键", () => {
  expect(CAPABILITIES["agent.publish"].reasonKey).toBe("authReasonPublish");
  expect(CAPABILITIES["agent.recruit"].reasonKey).toBe("authReasonRecruit");
  expect(CAPABILITIES["chat.useHostedModel"].reasonKey).toBe("authReasonHostedModel");
  expect(isHostedProviderKind("agentup")).toBe(true);
  expect(isHostedProviderKind("ollama")).toBe(false);
});

it("已登录时 runWithAccount 直接执行意图", async () => {
  const action = vi.fn();
  bindAuthGate({
    isAccount: () => true,
    login: async () => false,
    cancelLogin: async () => undefined,
  });
  await expect(runWithAccount("agent.recruit", action)).resolves.toBe(true);
  expect(action).toHaveBeenCalledOnce();
  expect(authPromptOpen.value).toBe(false);
});

it("游客只打开叠层，不自动登录；确认后才登录并重放最后一次意图", async () => {
  let resolveLogin: ((ok: boolean) => void) | undefined;
  const login = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveLogin = resolve;
      }),
  );
  const first = vi.fn();
  const second = vi.fn();
  bindAuthGate({
    isAccount: () => false,
    login,
    cancelLogin: async () => undefined,
  });

  const pending = runWithAccount("agent.recruit", first);
  expect(authPromptOpen.value).toBe(true);
  expect(authPromptReason.value).toContain("招募");
  expect(login).not.toHaveBeenCalled();
  expect(authPromptBusy.value).toBe(false);

  const overlapping = runWithAccount("agent.publish", second);
  expect(login).not.toHaveBeenCalled();

  const confirming = confirmAuthPrompt();
  expect(login).toHaveBeenCalledOnce();
  expect(authPromptBusy.value).toBe(true);
  resolveLogin?.(true);
  await confirming;
  await expect(pending).resolves.toBe(true);
  await expect(overlapping).resolves.toBe(true);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  expect(authPromptOpen.value).toBe(false);
});

it("取消叠层会丢掉意图且不登录", async () => {
  const action = vi.fn();
  const login = vi.fn(async () => true);
  const cancelLogin = vi.fn(async () => undefined);
  bindAuthGate({
    isAccount: () => false,
    login,
    cancelLogin,
  });
  const pending = runWithAccount("agent.publish", action);
  await cancelAuthPrompt();
  await expect(pending).resolves.toBe(false);
  expect(action).not.toHaveBeenCalled();
  expect(login).not.toHaveBeenCalled();
  expect(cancelLogin).toHaveBeenCalledOnce();
  expect(authPromptOpen.value).toBe(false);
});
