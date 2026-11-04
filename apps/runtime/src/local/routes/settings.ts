import type { Hono } from "hono";

import { ConfigError } from "../../config/load.js";
import {
  deleteProviderConnection,
  readProviderSettings,
  refreshProviderModels,
  removeCustomModel,
  setActiveModel,
  setModelEnabled,
  setRuntimeProviderSecrets,
  upsertProviderConnection,
} from "../../config/provider/index.js";
import {
  cancelAgentSdkInstall,
  readInstallJob,
  startAgentSdkInstall,
  uninstallAgentSdk,
} from "../../config/providers/agent-sdk/installer.js";
import {
  checkAgentSdkLogin,
  logoutAgentSdk,
  startAgentSdkLogin,
  submitAgentSdkApiKey,
} from "../../config/providers/agent-sdk/login.js";
import {
  ensureAgentSdkModels,
  refreshAgentSdkModels,
} from "../../config/providers/agent-sdk/models.js";
import {
  bearer,
  json,
  LocalError,
  optionalText,
  readJson,
  requireUserId,
  text,
  uiLocaleFromRequest,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { providerSettingsBody } from "../serialize.js";
import {
  UserResourceError,
  deleteUserSkill,
  installUserSkillPackage,
  listUserSkills,
  readUserAgentsMd,
  readUserMcpServers,
  setUserSkillEnabled,
  writeUserAgentsMd,
  writeUserMcpServers,
} from "../assistant/user-resources.js";

export function registerSettingsRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config, chats } = deps;

  app.get("/settings/skills", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    return json(c, 200, {
      skills: listUserSkills(config.userDataRoot, userId).map((skill) => ({
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
      })),
    });
  });

  app.post("/settings/skills/install", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const expectName = optionalText(body, "expect_name");
    const skill = await installUserSkillPackage(config.userDataRoot, userId, text(body, "path"), {
      ...(expectName ? { expectName } : {}),
    });
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, { name: skill.name, description: skill.description, enabled: skill.enabled });
  });

  app.put("/settings/skills/:name/enabled", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    if (typeof body.enabled !== "boolean") throw new LocalError("请求无效", 400);
    const skill = setUserSkillEnabled(config.userDataRoot, userId, c.req.param("name"), body.enabled);
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, { name: skill.name, description: skill.description, enabled: skill.enabled });
  });

  app.delete("/settings/skills/:name", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    deleteUserSkill(config.userDataRoot, userId, c.req.param("name"));
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, { deleted: true });
  });

  app.get("/settings/mcp", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    try {
      return json(c, 200, { mcp_servers: readUserMcpServers(config.userDataRoot, userId) });
    } catch (error) {
      if (error instanceof UserResourceError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.put("/settings/mcp", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    const servers = body.mcp_servers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      throw new LocalError("mcp_servers 必须是对象", 400);
    }
    const saved = writeUserMcpServers(config.userDataRoot, userId, servers as Record<string, unknown>);
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, { mcp_servers: saved });
  });

  app.get("/settings/agents-md", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? null);
    return json(c, 200, { content: readUserAgentsMd(config.userDataRoot, userId) });
  });

  app.put("/settings/agents-md", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const userId = requireUserId(text(body, "user_id"));
    if (typeof body.content !== "string") throw new LocalError("AGENTS.md 内容无效", 400);
    const content = writeUserAgentsMd(config.userDataRoot, userId, body.content);
    chats.invalidatePersonalAssistant(userId);
    return json(c, 200, { content });
  });

  app.get("/settings/provider", (c) => {
    bearer(c);
    const locale = uiLocaleFromRequest(c);
    return json(c, 200, providerSettingsBody(readProviderSettings(config.userDataRoot, process.env, locale)));
  });

  app.post("/settings/provider/connections", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    try {
      const settings = upsertProviderConnection(config.userDataRoot, {
        templateId: text(body, "template_id"),
        baseUrl: optionalText(body, "base_url"),
        apiKeyCipher: optionalText(body, "api_key_cipher"),
        clearApiKey: body.clear_api_key === true,
        customModelId: optionalText(body, "custom_model_id"),
        locale,
      });
      return json(c, 200, providerSettingsBody(settings));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  // CLI / SDK 接入：按需安装（runtime 代跑 npm，用户不敲命令）
  app.post("/settings/provider/agents/:templateId/install", (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    try {
      const jobId = startAgentSdkInstall(config.userDataRoot, templateId);
      return json(c, 200, { job_id: jobId });
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.get("/settings/provider/agents/:templateId/install/:jobId", (c) => {
    bearer(c);
    try {
      return json(c, 200, readInstallJob(c.req.param("jobId")));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 404);
      throw error;
    }
  });

  app.post("/settings/provider/agents/:templateId/install/:jobId/cancel", (c) => {
    bearer(c);
    try {
      cancelAgentSdkInstall(c.req.param("jobId"));
      return json(c, 200, providerSettingsBody(readProviderSettings(config.userDataRoot, process.env, uiLocaleFromRequest(c))));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/settings/provider/agents/:templateId/login", async (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    try {
      // CodeBuddy：body.environment = internal|external；其它 driver 忽略
      const body = await readJson(c);
      const environment = optionalText(body, "environment");
      const result = await startAgentSdkLogin(config.userDataRoot, templateId, {
        ...(environment === "internal" || environment === "external"
          ? { environment }
          : {}),
      });
      // 登录刚成功时顺手补一次模型目录，设置页的「启用服务」才有东西可选
      if (result.state === "ready") {
        await ensureAgentSdkModels(config.userDataRoot, templateId);
      }
      return json(c, 200, result);
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/settings/provider/agents/:templateId/login-check", async (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    try {
      const body = await readJson(c);
      const environment = optionalText(body, "environment");
      const result = await checkAgentSdkLogin(config.userDataRoot, templateId, {
        ...(environment === "internal" || environment === "external"
          ? { environment }
          : {}),
      });
      if (result.state === "ready") {
        await ensureAgentSdkModels(config.userDataRoot, templateId);
      }
      return json(c, 200, result);
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  // OpenCode Zen 等：官网复制 Key 后粘贴写入隔离目录（非 API Key 接入组）
  app.post("/settings/provider/agents/:templateId/login-key", async (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    try {
      const body = await readJson(c);
      const apiKey = optionalText(body, "api_key") ?? optionalText(body, "apiKey");
      if (!apiKey) throw new LocalError("请输入 API Key", 400);
      const result = await submitAgentSdkApiKey(config.userDataRoot, templateId, apiKey);
      // 粘贴 Key 路径：adaptor 内已顺手 listModels；勿再 ensure（Copilot 冷启贵，失败会连开三次）
      return json(c, 200, result);
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  // 登出：token 在 CLI 手里，runtime 只代调 logout 并把状态与模型目录打回未登录
  app.post("/settings/provider/agents/:templateId/logout", async (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    const locale = uiLocaleFromRequest(c);
    try {
      await logoutAgentSdk(config.userDataRoot, templateId);
      return json(c, 200, providerSettingsBody(readProviderSettings(config.userDataRoot, process.env, locale)));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  // 本地接入的模型目录只能问本地 SDK；服务端不知道这家订阅能用什么
  app.post("/settings/provider/agents/:templateId/models", async (c) => {
    bearer(c);
    const locale = uiLocaleFromRequest(c);
    try {
      await refreshAgentSdkModels(config.userDataRoot, c.req.param("templateId"));
      return json(
        c,
        200,
        providerSettingsBody(readProviderSettings(config.userDataRoot, process.env, locale)),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/settings/provider/agents/:templateId", (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    const locale = uiLocaleFromRequest(c);
    try {
      uninstallAgentSdk(config.userDataRoot, templateId);
      return json(c, 200, providerSettingsBody(readProviderSettings(config.userDataRoot, process.env, locale)));
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/settings/provider/connections/:templateId", (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    const locale = uiLocaleFromRequest(c);
    try {
      return json(
        c,
        200,
        providerSettingsBody(deleteProviderConnection(config.userDataRoot, templateId, locale)),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/settings/provider/connections/:templateId/refresh-models", async (c) => {
    bearer(c);
    const templateId = c.req.param("templateId");
    const locale = uiLocaleFromRequest(c);
    try {
      return json(
        c,
        200,
        providerSettingsBody(await refreshProviderModels(config.userDataRoot, templateId, locale)),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.delete("/settings/provider/connections/:templateId/custom-models/:modelId", (c) => {
    bearer(c);
    const locale = uiLocaleFromRequest(c);
    try {
      return json(
        c,
        200,
        providerSettingsBody(
          removeCustomModel(
            config.userDataRoot,
            {
              templateId: c.req.param("templateId"),
              modelId: decodeURIComponent(c.req.param("modelId")),
            },
            locale,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/settings/provider/models/enabled", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    try {
      return json(
        c,
        200,
        providerSettingsBody(
          setModelEnabled(
            config.userDataRoot,
            { templateId: text(body, "template_id"), modelId: text(body, "model_id") },
            body.enabled === true,
            locale,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.post("/settings/provider/models/active", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const locale = uiLocaleFromRequest(c);
    try {
      return json(
        c,
        200,
        providerSettingsBody(
          setActiveModel(
            config.userDataRoot,
            {
              templateId: text(body, "template_id"),
              modelId: text(body, "model_id"),
            },
            locale,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof ConfigError) throw new LocalError(error.message, 400);
      throw error;
    }
  });

  app.put("/settings/provider/runtime-secrets", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const secrets = body.secrets;
    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
      throw new LocalError("密钥载荷无效", 400);
    }
    const next: Record<string, string> = {};
    for (const [templateId, value] of Object.entries(secrets as Record<string, unknown>)) {
      if (typeof value === "string") next[templateId] = value;
    }
    setRuntimeProviderSecrets(next);
    return json(c, 200, { ok: true });
  });
}
