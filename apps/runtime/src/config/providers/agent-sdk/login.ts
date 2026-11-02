import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import {
  agentSdkAccountLabel,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../../provider/index.js";
import { agentSdkDir, readInstalledSdk } from "./installer.js";
import { loadAgentSdkModule, withTimeout } from "./loader.js";
import { syncAgentSdkModelsAfterLogin } from "./models.js";

/**
 * 本地 SDK 登录（阶段 1）。
 *
 * 已实测的行为（见 docs/agent_cli §11）：
 * - 已登录时 `authenticate()` 约 1 秒直接返回，不触发 onAuthUrl → 这就是登录态探测；
 * - 未登录时才回调 authUrl，完成信号由 CLI 经控制协议回报，不需要我们监听端口；
 * - 但它没有 timeout / signal 参数，未登录会一直挂着 → 必须外层自加超时。
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
  /** 需要用户去浏览器完成登录时为非空；为空表示本机已登录 */
  auth_url: string | null;
  state: "logging_in" | "ready" | "not_logged_in";
  account_label?: string;
}

/** 站点由用户在浏览器登录页里选，我们不预设 environment。 */
function loginOptions(
  onUrl: (url: string) => void,
  cliPath?: string,
): Record<string, unknown> {
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

  const sdk = await loadAgentSdkModule(userDataRoot, templateId);
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
        // 登录刚成功：把账号名记下来（设置页要显示「谁在登录」），token 一律不落盘。
        // previous 必须在写状态前取：写完就分不清「账号换了」还是「本来就是这个」。
        const label = accountLabelOf(result);
        setAgentSdkAccountLabel(userDataRoot, templateId, label ?? null);
        // 换账号登录：旧目录是上一个账号的，必须重拉（见 models.ts 注释）
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

  // 等两件事：拿到登录页 URL（立刻给前端去开浏览器），或这次调用直接结束（说明已登录）
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

/** 冷启动探测：已登录就 ready，超时就当没登录（不要一直挂着等浏览器）。 */
export async function checkAgentSdkLogin(
  userDataRoot: string,
  templateId: string,
): Promise<LoginResult> {
  const active = pending.get(templateId);
  if (active && !active.finished) return { auth_url: active.authUrl ?? null, state: "logging_in" };

  const sdk = await loadAgentSdkModule(userDataRoot, templateId);
  const authenticate = sdk.unstable_v2_authenticate;
  if (typeof authenticate !== "function") throw new ConfigError("本地 SDK 不支持登录接口");
  const template = getProviderTemplate(templateId)!;
  const installed = readInstalledSdk(agentSdkDir(userDataRoot, templateId), template.agentSdk!.package);

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
    // 换账号登录：旧目录是上一个账号的，必须重拉（见 models.ts 注释）
    await syncAgentSdkModelsAfterLogin(userDataRoot, templateId, {
      accountChanged: Boolean(label) && label !== previous,
    });
    return { auth_url: null, state: "ready", ...(label ? { account_label: label } : {}) };
  }
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  return { auth_url: null, state: "not_logged_in" };
}

/**
 * 登出：token 归各家 CLI 自己管，我们只能代调 `unstable_v2_logout()`，
 * 再把状态打回 `not_logged_in`（未安装 / 不支持登出都直接报错，别假装登出了）。
 * 已查到的模型目录一并清空：登出后 card 不该再显示「已获取 N 个模型」。
 */
export async function logoutAgentSdk(userDataRoot: string, templateId: string): Promise<void> {
  const sdk = await loadAgentSdkModule(userDataRoot, templateId);
  const logout = sdk.unstable_v2_logout;
  if (typeof logout !== "function") throw new ConfigError("本地 SDK 不支持登出接口");
  await withTimeout(logout.call(sdk, {}), LOGOUT_TIMEOUT_MS);
  pending.delete(templateId);
  setAgentSdkState(userDataRoot, templateId, "not_logged_in");
  setAgentSdkModels(userDataRoot, templateId, []);
  // 显式清一次账号：不靠 setAgentSdkState 重建记录时「顺带丢掉」这个副作用
  setAgentSdkAccountLabel(userDataRoot, templateId, null);
}

/** 只取展示用的昵称/用户名，token 一律不往外带。 */
function accountLabelOf(result: unknown): string | null {
  const info = (result as { userinfo?: Record<string, unknown> } | null)?.userinfo;
  if (!info) return null;
  const value = info.userNickname ?? info.userName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
