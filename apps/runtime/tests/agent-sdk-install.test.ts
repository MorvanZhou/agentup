import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  agentSdkDir,
  cancelAgentSdkInstall,
  readInstallJob,
  readInstalledSdk,
  resolveNpmRunner,
  startAgentSdkInstall,
  uninstallAgentSdk,
} from "../src/config/providers/agent-sdk/installer.js";
import {
  readProviderSettings,
  setAgentSdkAccountLabel,
  setAgentSdkModels,
  setAgentSdkState,
} from "../src/config/provider/index.js";
import {
  checkAgentSdkLogin,
  logoutAgentSdk,
  startAgentSdkLogin,
} from "../src/config/providers/agent-sdk/login.js";
import { refreshAgentSdkModels } from "../src/config/providers/agent-sdk/models.js";
import { startLocalServer } from "../src/local/server.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-sdk-install-"));
}

function sdkOf(root: string, templateId = "codebuddy-sdk") {
  return readProviderSettings(root, {}, "zh").agentSdks.find(
    (item) => item.templateId === templateId,
  );
}

/** 手工布置「已安装」现场：避免每条用例都真下载 180 MB。 */
function fakeInstalled(root: string, version = "0.3.295"): void {
  const pkgDir = path.join(root, "agent-sdks", "codebuddy-sdk", "node_modules", "@tencent-ai", "agent-sdk");
  fs.mkdirSync(path.join(pkgDir, "cli", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@tencent-ai/agent-sdk", version, main: "lib/index.js" }),
  );
  fs.mkdirSync(path.join(pkgDir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "lib", "index.js"), "module.exports = {};");
  fs.writeFileSync(path.join(pkgDir, "cli", "bin", "codebuddy"), "#!/usr/bin/env node\n");
}

/** 带登出口的假 SDK：登出时落一个标记文件，用来确认真的调到了 SDK。 */
function fakeLogoutModule(root: string, marker: string): void {
  fakeInstalled(root);
  const entry = path.join(
    root,
    "agent-sdks",
    "codebuddy-sdk",
    "node_modules",
    "@tencent-ai",
    "agent-sdk",
    "lib",
    "index.js",
  );
  fs.writeFileSync(
    entry,
    `exports.unstable_v2_logout = async () => { require("node:fs").writeFileSync(${JSON.stringify(marker)}, "1"); };`,
  );
}

/**
 * 假 SDK 的模型查询：raw 版带 credits，简版只回 {modelId,name}（老 SDK 的样子）。
 * credits 传什么就回什么，用来验证脏值不会污染目录。
 */
function fakeModelModule(
  root: string,
  options?: { raw?: boolean; credits?: unknown },
): void {
  fakeInstalled(root);
  const entry = path.join(
    root,
    "agent-sdks",
    "codebuddy-sdk",
    "node_modules",
    "@tencent-ai",
    "agent-sdk",
    "lib",
    "index.js",
  );
  const raw =
    options?.raw === false
      ? ""
      : `getAvailableModelsRaw: async () => ([{ id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: ${JSON.stringify(options?.credits ?? "x1.33 credits")} }]),
  `;
  fs.writeFileSync(
    entry,
    `exports.unstable_v2_createSession = () => ({
  ${raw}getAvailableModels: async () => [{ modelId: "claude-sonnet-5", name: "Claude-Sonnet-5" }],
  close: () => {},
});
`,
  );
}

/** 假 SDK：登录直接成功并回账号名，登出什么都不做（token 从不经过我们）。 */
function fakeLoginModule(root: string, marker?: string): void {
  fakeInstalled(root);
  const entry = path.join(
    root,
    "agent-sdks",
    "codebuddy-sdk",
    "node_modules",
    "@tencent-ai",
    "agent-sdk",
    "lib",
    "index.js",
  );
  // marker：把 authenticate / logout 收到的 options 落盘，断言 environment 透传
  const writeMark = marker
    ? `require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify(opts ?? {}));`
    : "";
  fs.writeFileSync(
    entry,
    `exports.unstable_v2_authenticate = async (opts) => {
  ${writeMark}
  return { userinfo: { userNickname: "morvanzhou" } };
};
exports.unstable_v2_logout = async (opts) => {
  ${writeMark}
};
`,
  );
}

/**
 * 假 SDK：第一次登录是 alice / 目录 A，之后是 bob / 目录 B。
 * 用文件记登录次数与建会话次数，才能断言「换账号会重查、同账号不重查」。
 */
function fakeSwitchingModule(root: string, options?: { same?: boolean }): void {
  fakeInstalled(root);
  const entry = path.join(
    root,
    "agent-sdks",
    "codebuddy-sdk",
    "node_modules",
    "@tencent-ai",
    "agent-sdk",
    "lib",
    "index.js",
  );
  const authMark = path.join(root, "auth-count");
  const sessionMark = path.join(root, "session-count");
  fs.writeFileSync(authMark, "0");
  fs.writeFileSync(sessionMark, "0");
  fs.writeFileSync(
    entry,
    `const fs = require("node:fs");
const authMark = ${JSON.stringify(authMark)};
const sessionMark = ${JSON.stringify(sessionMark)};
const bump = (file) => {
  const next = (Number(fs.readFileSync(file, "utf8")) || 0) + 1;
  fs.writeFileSync(file, String(next));
  return next;
};
exports.unstable_v2_authenticate = async () => {
  const n = bump(authMark);
  return { userinfo: { userNickname: ${options?.same ? '"alice"' : 'n === 1 ? "alice" : "bob"'} } };
};
exports.unstable_v2_createSession = () => {
  bump(sessionMark);
  return {
    getAvailableModelsRaw: async () =>
      Number(fs.readFileSync(authMark, "utf8")) === 1
        ? [{ id: "model-a", name: "A" }]
        : [{ id: "model-b", name: "B" }],
    getAvailableModels: async () => [],
    close: () => {},
  };
};
`,
  );
}

async function waitJob(jobId: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = readInstallJob(jobId);
    if (["done", "failed", "cancelled"].includes(job.phase)) return job.phase;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "timeout";
}

it("优先使用 AGENTUP_NPM_CLI（Desktop afterPack 注入的钉版 npm）", () => {
  const execPath = path.join("/fake", "AgentUp.app", "Contents", "MacOS", "AgentUp");
  const bundled = path.join("/fake", "AgentUp.app", "Contents", "Resources", "npm", "bin", "npm-cli.js");
  const pathNpm = path.join("/fake", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
  const files = new Set([bundled, pathNpm]);
  const runner = resolveNpmRunner({
    platform: "darwin",
    execPath,
    env: { AGENTUP_NPM_CLI: bundled, PATH: path.join("/fake", "nodejs") },
    existsSync: (filePath) => files.has(filePath),
  });
  expect(runner).toEqual({ command: execPath, args: [bundled] });
});

it("mac 打包态从 execPath 旁 Resources/npm 解析，不依赖系统 PATH", () => {
  const execPath = path.join("/fake", "AgentUp.app", "Contents", "MacOS", "AgentUp");
  const bundled = path.join("/fake", "AgentUp.app", "Contents", "Resources", "npm", "bin", "npm-cli.js");
  const runner = resolveNpmRunner({
    platform: "darwin",
    execPath,
    env: { PATH: "" },
    existsSync: (filePath) => filePath === bundled,
  });
  expect(runner).toEqual({ command: execPath, args: [bundled] });
});

it("win 打包态从 execPath 旁 resources/npm 解析，不 spawn npm.cmd", () => {
  const execPath = path.join("/fake", "AgentUp", "AgentUp.exe");
  const bundled = path.join("/fake", "AgentUp", "resources", "npm", "bin", "npm-cli.js");
  const runner = resolveNpmRunner({
    platform: "win32",
    execPath,
    env: { PATH: "" },
    existsSync: (filePath) => filePath === bundled,
  });
  expect(runner).toEqual({ command: execPath, args: [bundled] });
  expect(runner?.command.toLowerCase().endsWith(".cmd")).toBe(false);
});

it("Windows 从 PATH 反查 npm-cli.js，绝不把 npm.cmd 当作 spawn command", () => {
  // 不用盘符路径：本机若是 darwin，PATH 按 `:` 分割会把 `C:` 拆碎
  const nodeDir = path.join("/fake", "nodejs");
  const execPath = path.join("/fake", "AgentUp", "AgentUp.exe");
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  const files = new Set([path.join(nodeDir, "node.exe"), path.join(nodeDir, "npm.cmd"), npmCli]);
  const runner = resolveNpmRunner({
    platform: "win32",
    execPath,
    env: { PATH: nodeDir },
    existsSync: (filePath) => files.has(filePath),
  });
  expect(runner).toEqual({ command: execPath, args: [npmCli] });
  expect(runner?.command.toLowerCase().endsWith(".cmd")).toBe(false);
});

it("Windows 仅有 npm.cmd、找不到 npm-cli.js 时返回 null（避免 spawn EINVAL）", () => {
  const nodeDir = path.join("/fake", "tools");
  const runner = resolveNpmRunner({
    platform: "win32",
    execPath: path.join("/fake", "AgentUp", "AgentUp.exe"),
    env: { PATH: nodeDir },
    existsSync: (filePath) => filePath === path.join(nodeDir, "npm.cmd"),
  });
  expect(runner).toBeNull();
});

it(
  "installs a package into the managed directory and records the version",
  async () => {
    const root = tempRoot();
    // 用轻量包走真实 npm 链路，保证 spawn / 临时目录 / 自检 / rename 都是真的
    const jobId = startAgentSdkInstall(root, "codebuddy-sdk", "ms@2.1.3");
    expect(["resolving", "downloading"]).toContain(readInstallJob(jobId).phase);

    const phase = await waitJob(jobId);
    expect(phase).toBe("done");
    expect(fs.existsSync(path.join(agentSdkDir(root, "codebuddy-sdk"), "node_modules", "ms"))).toBe(true);
    expect(sdkOf(root)?.state).toBe("installed");
    expect(sdkOf(root)?.installedVersion).toBe("2.1.3");
  },
  90_000,
);

it("reports install_failed and rolls back when npm cannot resolve the spec", async () => {
  const root = tempRoot();
  const jobId = startAgentSdkInstall(root, "codebuddy-sdk", "@tencent-ai/agent-sdk@0.0.0-nope");
  const phase = await waitJob(jobId, 60_000);
  expect(phase).toBe("failed");
  expect(readInstallJob(jobId).error).toBeTruthy();
  expect(sdkOf(root)?.state).toBe("install_failed");
  // 失败不留半装目录
  expect(fs.existsSync(agentSdkDir(root, "codebuddy-sdk"))).toBe(false);
}, 90_000);

it("refuses a second install and cleans up on uninstall", () => {
  const root = tempRoot();
  fakeInstalled(root);
  expect(() => startAgentSdkInstall(root, "codebuddy-sdk")).toThrow(/已经接入/);

  uninstallAgentSdk(root, "codebuddy-sdk");
  expect(fs.existsSync(agentSdkDir(root, "codebuddy-sdk"))).toBe(false);
  expect(sdkOf(root)?.state).toBe("not_installed");
});

it("reads the installed version and bundled cli path", () => {
  const root = tempRoot();
  fakeInstalled(root, "0.3.300");
  const info = readInstalledSdk(agentSdkDir(root, "codebuddy-sdk"), "@tencent-ai/agent-sdk");
  expect(info?.version).toBe("0.3.300");
  expect(info?.cliPath && fs.existsSync(info.cliPath)).toBe(true);
});

it("cancels a running install without leaving the temp directory", () => {
  const root = tempRoot();
  const jobId = startAgentSdkInstall(root, "codebuddy-sdk", "ms@2.1.3");
  cancelAgentSdkInstall(jobId);
  expect(readInstallJob(jobId).phase).toBe("cancelled");
  expect(sdkOf(root)?.state).toBe("not_installed");
  const leftovers = fs
    .readdirSync(path.join(root, "agent-sdks"))
    .filter((name) => name.startsWith(".tmp-"));
  expect(leftovers).toEqual([]);
});

it("cannot log in before the SDK is installed", async () => {
  const root = tempRoot();
  await expect(checkAgentSdkLogin(root, "codebuddy-sdk")).rejects.toThrow(/尚未接入/);
});

it("cannot log out before the SDK is installed", async () => {
  const root = tempRoot();
  await expect(logoutAgentSdk(root, "codebuddy-sdk")).rejects.toThrow(/尚未接入/);
});

it("logs out through the SDK and drops back to not_logged_in with models cleared", async () => {
  const root = tempRoot();
  const marker = path.join(root, "logged-out");
  fakeLogoutModule(root, marker);
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  setAgentSdkModels(root, "codebuddy-sdk", [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  expect(sdkOf(root)?.models?.length).toBe(1);

  await logoutAgentSdk(root, "codebuddy-sdk");

  // token 归各家 CLI 管，我们只能确认调用到了它，并把自己的状态与模型目录清干净
  expect(fs.existsSync(marker)).toBe(true);
  expect(sdkOf(root)?.state).toBe("not_logged_in");
  expect(sdkOf(root)?.models ?? []).toEqual([]);
  // 已登出 → 不再进「启用服务」列表
  expect(readProviderSettings(root, {}, "zh").availableModels).toEqual([]);
});

it("carries the credit rate from getAvailableModelsRaw into the settings list", async () => {
  const root = tempRoot();
  fakeModelModule(root);
  setAgentSdkState(root, "codebuddy-sdk", "ready");

  const models = await refreshAgentSdkModels(root, "codebuddy-sdk");
  expect(models).toEqual([{ id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 }]);
  // 落盘后仍带倍率：设置页每次打开读的是这份目录，不是刚查的结果
  expect(sdkOf(root)?.models).toEqual([
    { id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 },
  ]);
  // 「启用服务」的模型行要能拿到倍率
  const rows = readProviderSettings(root, {}, "zh").availableModels.filter(
    (item) => item.templateId === "codebuddy-sdk",
  );
  expect(rows[0]?.credits).toBe(1.33);
});

it("falls back to getAvailableModels without a credit rate", async () => {
  const root = tempRoot();
  fakeModelModule(root, { raw: false });
  setAgentSdkState(root, "codebuddy-sdk", "ready");

  const models = await refreshAgentSdkModels(root, "codebuddy-sdk");
  // 老 SDK 没有 raw：模型照常进目录，只是没有倍率可显示
  expect(models).toEqual([{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  expect(models[0]?.credits).toBeUndefined();
});

it("keeps a zero credit rate so the row can show ×0", async () => {
  const root = tempRoot();
  // 混元自部署 / echo 报的就是 'x0.00 credits'：0 是真实值，不能当成「没数据」丢掉
  fakeModelModule(root, { credits: "x0.00 credits" });
  setAgentSdkState(root, "codebuddy-sdk", "ready");

  const models = await refreshAgentSdkModels(root, "codebuddy-sdk");
  expect(models).toEqual([{ id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 0 }]);
  expect(sdkOf(root)?.models?.[0]?.credits).toBe(0);
  const rows = readProviderSettings(root, {}, "zh").availableModels.filter(
    (item) => item.templateId === "codebuddy-sdk",
  );
  expect(rows[0]?.credits).toBe(0);
});

it("drops a credit rate it cannot read", async () => {
  const root = tempRoot();
  fakeModelModule(root, { credits: "free" });
  setAgentSdkState(root, "codebuddy-sdk", "ready");

  const models = await refreshAgentSdkModels(root, "codebuddy-sdk");
  // 认不出来的倍率宁缺勿假：不写 0，也不写 NaN
  expect(models[0]?.credits).toBeUndefined();
});

it("remembers the signed-in account on both login entry points", async () => {
  const root = tempRoot();
  fakeLoginModule(root);
  const started = await startAgentSdkLogin(root, "codebuddy-sdk");
  expect(started.state).toBe("ready");
  // 账号名要落盘：设置页每次打开是读配置，不是读登录那一次的返回值
  expect(sdkOf(root)?.accountLabel).toBe("morvanzhou");

  const other = tempRoot();
  fakeLoginModule(other);
  const checked = await checkAgentSdkLogin(other, "codebuddy-sdk");
  expect(checked.account_label).toBe("morvanzhou");
  expect(sdkOf(other)?.accountLabel).toBe("morvanzhou");
});

it("passes and remembers CodeBuddy auth environment on login", async () => {
  const root = tempRoot();
  const mark = path.join(root, "auth-opts.json");
  fakeLoginModule(root, mark);
  setAgentSdkState(root, "codebuddy-sdk", "installed", { installedVersion: "0.3.295" });

  const started = await startAgentSdkLogin(root, "codebuddy-sdk", { environment: "internal" });
  expect(started.state).toBe("ready");
  expect(sdkOf(root)?.authEnvironment).toBe("internal");
  expect(JSON.parse(fs.readFileSync(mark, "utf8")).environment).toBe("internal");
  // CLI 自开浏览器靠 BROWSER；须传空操作，避免与 Desktop openExternal 双开
  expect(JSON.parse(fs.readFileSync(mark, "utf8")).env?.BROWSER).toBeTruthy();

  // 登出保留站点偏好，logout 也要带同一 environment
  await logoutAgentSdk(root, "codebuddy-sdk");
  expect(sdkOf(root)?.authEnvironment).toBe("internal");
  expect(JSON.parse(fs.readFileSync(mark, "utf8")).environment).toBe("internal");
});

it("clears the remembered account on logout", async () => {
  const root = tempRoot();
  fakeLoginModule(root);
  await checkAgentSdkLogin(root, "codebuddy-sdk");
  expect(sdkOf(root)?.accountLabel).toBe("morvanzhou");

  await logoutAgentSdk(root, "codebuddy-sdk");
  // 登出后不该再挂着上一个账号
  expect(sdkOf(root)?.state).toBe("not_logged_in");
  expect(sdkOf(root)?.accountLabel).toBeUndefined();
});

it("keeps the catalog, version and account when the state advances", async () => {
  const root = tempRoot();
  fakeModelModule(root);
  setAgentSdkState(root, "codebuddy-sdk", "installed", { installedVersion: "0.3.295" });
  await refreshAgentSdkModels(root, "codebuddy-sdk");
  setAgentSdkAccountLabel(root, "codebuddy-sdk", "alice");

  // 再推一次状态（重新登录 / 登录态探测都会走）：不该把目录、版本、账号一起清掉
  setAgentSdkState(root, "codebuddy-sdk", "logging_in");

  expect(sdkOf(root)?.state).toBe("logging_in");
  expect(sdkOf(root)?.installedVersion).toBe("0.3.295");
  expect(sdkOf(root)?.accountLabel).toBe("alice");
  expect(sdkOf(root)?.models).toEqual([
    { id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 },
  ]);
});

it("reloads the model catalog when a different account signs in", async () => {
  const root = tempRoot();
  fakeSwitchingModule(root);

  await checkAgentSdkLogin(root, "codebuddy-sdk");
  expect(sdkOf(root)?.accountLabel).toBe("alice");
  expect(sdkOf(root)?.models?.map((model) => model.id)).toEqual(["model-a"]);

  // 换成 bob 登录：上一个账号的目录对 bob 是错的，必须作废重拉
  await checkAgentSdkLogin(root, "codebuddy-sdk");
  expect(sdkOf(root)?.accountLabel).toBe("bob");
  expect(sdkOf(root)?.models?.map((model) => model.id)).toEqual(["model-b"]);
});

it("does not re-query the catalog when the same account signs in again", async () => {
  const root = tempRoot();
  fakeSwitchingModule(root, { same: true });
  const sessions = path.join(root, "session-count");

  await checkAgentSdkLogin(root, "codebuddy-sdk");
  expect(sdkOf(root)?.models?.map((model) => model.id)).toEqual(["model-a"]);
  expect(fs.readFileSync(sessions, "utf8")).toBe("1");

  // 账号没换 → 沿用节流，不重复拉起 CLI
  await checkAgentSdkLogin(root, "codebuddy-sdk");
  expect(fs.readFileSync(sessions, "utf8")).toBe("1");
});

it("rejects unknown jobs", () => {
  expect(() => readInstallJob("not-a-job")).toThrow(/不存在/);
});

it("exposes install / login / uninstall over the loopback API", async () => {
  const root = tempRoot();
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const request = (method: string, pathname: string) =>
    fetch(`${local.url}${pathname}`, {
      method,
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
  try {
    // 未安装就登录 / 登出 → 400
    expect((await request("POST", "/settings/provider/agents/codebuddy-sdk/login")).status).toBe(400);
    expect((await request("POST", "/settings/provider/agents/codebuddy-sdk/logout")).status).toBe(400);
    // 未知接入方式 → 400
    expect((await request("POST", "/settings/provider/agents/deepseek/install")).status).toBe(400);
    // 不存在的任务 → 404
    expect((await request("GET", "/settings/provider/agents/codebuddy-sdk/install/nope")).status).toBe(404);
    // 卸载不存在的接入方式 → 400；存在的（没装过）→ 200
    expect((await request("DELETE", "/settings/provider/agents/deepseek")).status).toBe(400);
    expect((await request("DELETE", "/settings/provider/agents/codebuddy-sdk")).status).toBe(200);
  } finally {
    await local.close();
  }
});
