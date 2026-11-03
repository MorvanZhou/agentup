import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import {
  agentSdkAccountLabel,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../../../../../config/provider/index.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../../../config/providers/agent-sdk/installer.js";
import { loadCodebuddyModule, withTimeout } from "./load.js";
import { syncAgentSdkModelsAfterLogin } from "./models-impl.js";

/**
 * CodeBuddy 登录实现（浏览器授权 + CLI 控制协议，不监听端口）。
 */

const LOGIN_URL_TIMEOUT_MS = 20_000;
const LOGIN_CHECK_TIMEOUT_MS = 10_000;
const LOGOUT_TIMEOUT_MS = 5_000;

interface PendingLogin {
  templateId: string;
  authUrl?: string;
  finished: boolean;
}

const pending = new Map<string, PendingLogin>();

export interface LoginResult {
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
}

function loginOptions(onUrl: (url: string) => void, cliPath?: string): Record<string, unknown> {
  return {
    onAuthUrl: (state: { authUrl?: string }) => {
      if (state?.authUrl) onUrl(state.authUrl);
    },
    ...(cliPath ? { pathToCodebuddyCode: cliPath } : {}),
  };
}

export async function startAgentSdkLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const existing = pending.get(templateId);
  if (existing && !existing.finished) {
    return { auth_url: existing.authUrl ?? null, state: "logging_in" };
  }

  const template = getProviderTemplate(templateId);
  const dir = agentSdkDir(userDataRoot, templateId);
  const installed = template?.agentSdk ? readInstalledSdk(dir, template.agentSdk.package) : null;
  if (!installed) throw new ConfigError("尚未安装，请先开始接入");

  const sdk = await loadCodebuddyModule(userDataRoot, templateId);
  const authenticate = sdk.unstable_v2_authenticate;
  if (typeof authenticate !== "function") throw new ConfigError("本地 SDK 不支持登录接口");

  const record: PendingLogin = { templateId, finished: false };
  pending.set(templateId, record);
  setAgentSdkState(userDataRoot, templateId, "logging_in");

  const settled = new Promise<"done" | "failed">((resolve) => {
    authenticate
      .call(sdk, loginOptions((url) => (record.authUrl = url), installed.cliPath))
      .then(async (result: unknown) => {
        const previous = agentSdkAccountLabel(userDataRoot, templateId);
        setAgentSdkState(userDataRoot, templateId, "ready");
        const label = accountLabelOf(result);
        setAgentSdkAccountLabel(userDataRoot, templateId, label ?? null);
        await syncAgentSdkModelsAfterLogin(userDataRoot, templateId, {
          accountChanged: Boolean(label) && label !== previous,
        });
        record.finished = true;
        resolve("done");
      })
      .catch(() => {
        setAgentSdkState(userDataRoot, templateId, "not_logged_in", { lastError: "登录未完成" });
        record.finished = true;
        resolve("failed");
      });
  });

  const urlOrEnd = await Promise.race([
    settled.then(() => null as string | null),
    waitForAuthUrl(() => record.authUrl),
    withTimeout(new Promise<null>(() => {}), LOGIN_URL_TIMEOUT_MS),
  ]);

  if (urlOrEnd) {
    record.authUrl = urlOrEnd;
    return { auth_url: urlOrEnd, state: "logging_in" };
  }
  const finished = await Promise.race([settled, withTimeout(settled, LOGIN_CHECK_TIMEOUT_MS)]);
  record.finished = true;
  return finished === "done"
    ? { auth_url: null, state: "ready" }
    : { auth_url: null, state: "not_logged_in" };
}

function waitForAuthUrl(get: () => string | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const url = get();
      if (url) {
        clearInterval(timer);
        resolve(url);
        return;
      }
      if (Date.now() - started > LOGIN_URL_TIMEOUT_MS) {
        clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}

export async function checkAgentSdkLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const active = pending.get(templateId);
  if (active && !active.finished) return { auth_url: active.authUrl ?? null, state: "logging_in" };

  const sdk = await loadCodebuddyModule(userDataRoot, templateId);
  const authenticate = sdk.unstable_v2_authenticate;
  if (typeof authenticate !== "function") throw new ConfigError("本地 SDK 不支持登录接口");
  const template = getProviderTemplate(templateId)!;
  const installed = readInstalledSdk(
    agentSdkDir(userDataRoot, templateId),
    template.agentSdk!.package,
  );

  const record: PendingLogin = { templateId, finished: false };
  pending.set(templateId, record);

  const outcome = await withTimeout(
    authenticate
      .call(sdk, loginOptions((url) => (record.authUrl = url), installed?.cliPath))
      .then(
        (result: unknown) => ({ ok: true as const, result }),
        () => ({ ok: false as const, result: null }),
      ),
    LOGIN_CHECK_TIMEOUT_MS,
  );

  record.finished = true;
  if (outcome?.ok) {
    const previous = agentSdkAccountLabel(userDataRoot, templateId);
    const label = accountLabelOf(outcome.result);
    setAgentSdkState(userDataRoot, templateId, "ready");
    setAgentSdkAccountLabel(userDataRoot, templateId, label ?? null);
    await syncAgentSdkModelsAfterLogin(userDataRoot, templateId, {
      accountChanged: Boolean(label) && label !== previous,
    });
    return { auth_url: null, state: "ready", ...(label ? { account_label: label } : {}) };
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

export async function logoutAgentSdk(userDataRoot: string, templateId: string): Promise<void> {
  const sdk = await loadCodebuddyModule(userDataRoot, templateId);
  const logout = sdk.unstable_v2_logout;
  if (typeof logout !== "function") throw new ConfigError("本地 SDK 不支持登出接口");
  await withTimeout(logout.call(sdk, {}), LOGOUT_TIMEOUT_MS);
  pending.delete(templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

function accountLabelOf(result: unknown): string | null {
  const info = (result as { userinfo?: Record<string, unknown> } | null)?.userinfo;
  if (!info) return null;
  const value = info.userNickname ?? info.userName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
