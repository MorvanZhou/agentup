import { expect, it, vi } from "vitest";

import { DesktopApi, DesktopApiError } from "../../src/shared/api/runtime/index.js";

it("recruits through the local runtime and then syncs the visit", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/login")) {
      return json({ user_id: "patient-a", email: "patient-a@example.com", nickname: "patient-a", token: "token" });
    }
    if (path.endsWith("/me") && (init?.method ?? "GET") === "PUT") {
      const body = init?.body ? (JSON.parse(String(init.body)) as { nickname: string }) : undefined;
      return json({
        user_id: "patient-a",
        email: "patient-a@example.com",
        nickname: body?.nickname ?? "patient-a",
        token: "token",
      });
    }
    const agentsUrl = new URL(path, "http://runtime");
    if ((init?.method ?? "GET") === "GET" && agentsUrl.pathname === "/agents") {
      return json({
        agents: [
          {
            agent_id: "respiratory-doctor",
            name: "呼吸科医生",
            background: "演示问诊",
            latest_version: 1,
            latest_digest: "abc",
            recruited: false,
            has_avatar: false,
            avatar_url: null,
          },
        ],
      });
    }
    if (path.endsWith("/recruit")) return json({ agent_id: "respiratory-doctor" });
    if (path.endsWith("/settings/provider") || path.endsWith("/settings/provider/connections")) {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            custom_model_id?: string;
            template_id?: string;
            base_url?: string;
          })
        : undefined;
      const configured = Boolean(body?.template_id);
      const modelId = body?.custom_model_id ?? "qwen3:0.6b";
      const ollamaTemplate = {
        id: "ollama",
        vendor_id: "ollama",
        vendor_label: "Ollama",
        option_label: "本机",
        label: "Ollama",
        kind: "ollama",
        pi_provider_id: "ollama",
        requires_api_key: false,
        default_base_url: "http://localhost:11434/v1",
        supports_model_discovery: true,
        models: [],
      };
      return json({
        connections: configured
          ? [
              {
                template_id: body?.template_id ?? "ollama",
                base_url: body?.base_url ?? "http://localhost:11434/v1",
                custom_model_ids: [modelId],
                discovered_model_ids: [],
                has_api_key: true,
                pi_provider_id: "ollama",
                requires_api_key: false,
                vendor_id: "ollama",
                vendor_label: "Ollama",
                option_label: "本机",
                label: "Ollama",
              },
            ]
          : [],
        enabled_models: configured ? [{ template_id: "ollama", model_id: modelId }] : [],
        active_model: configured ? { template_id: "ollama", model_id: modelId } : null,
        available_models: configured
          ? [
              {
                template_id: "ollama",
                model_id: modelId,
                name: modelId,
                vendor_label: "Ollama",
                option_label: "本机",
                enabled: true,
                active: true,
              },
            ]
          : [],
        configured,
        overridden_by_environment: false,
        vendors: [{ id: "ollama", label: "Ollama", options: [ollamaTemplate] }],
        templates: [ollamaTemplate],
      });
    }
    if (path.endsWith("/preferences")) {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            theme_mode?: string;
            skip_edit_resend_confirm?: boolean;
          })
        : undefined;
      return json({
        theme_mode: body?.theme_mode ?? "system",
        skip_edit_resend_confirm: body?.skip_edit_resend_confirm ?? false,
      });
    }
    if (path.endsWith("/agents/inspect")) {
      return json({ file_count: 3 });
    }
    if (path.endsWith("/agents/publish")) {
      return json({
        agent_id: "weather",
        name: "天气播报员",
        background: "演示天气",
        version: 1,
        digest: "weather-digest",
      });
    }
    if (path.endsWith("/respiratory-doctor/directory")) {
      return json({ path: "/tmp/agentup/users/patient-a/agents/respiratory-doctor" });
    }
    if (path.endsWith("/respiratory-doctor/sync")) {
      return json({
        user_id: "patient-a",
        agent_id: "respiratory-doctor",
        package_version: 1,
        package_digest: "abc",
      });
    }
    return json({ error: "没有这个接口" }, 404);
  });
  const api = new DesktopApi("http://runtime", fetchImpl);
  const session = await api.login("patient-a", "secret");
  expect(await api.agents(session.token, { q: "呼吸" })).toMatchObject([
    { agentId: "respiratory-doctor", recruited: false, localVersion: 0 },
  ]);
  expect(String(fetchImpl.mock.calls.at(-1)?.[0])).toContain("q=%E5%91%BC%E5%90%B8");
  fetchImpl.mockImplementationOnce(async () =>
    json({
      unread: { weather: 2 },
      previews: { weather: "晴" },
      last_active_at: { weather: 10 },
      command_allow: {},
    }),
  );
  await expect(api.state(session.token, session.userId)).resolves.toEqual({
    unread: { weather: 2 },
    previews: { weather: "晴" },
    lastActiveAt: { weather: 10 },
    commandAllow: {},
  });
  fetchImpl.mockImplementationOnce(async () =>
    json({
      unread: { weather: 3 },
      previews: { weather: "多云" },
      last_active_at: { weather: 20 },
      command_allow: { weather: "agent" },
    }),
  );
  await expect(
    api.saveState(session.token, session.userId, { weather: 3 }, { weather: "多云" }, { weather: 20 }),
  ).resolves.toEqual({
    unread: { weather: 3 },
    previews: { weather: "多云" },
    lastActiveAt: { weather: 20 },
    commandAllow: { weather: "agent" },
  });
  fetchImpl.mockImplementationOnce(async () =>
    json({
      user_id: "patient-a",
      agent_id: "weather",
      name: "天气播报员",
      latest_version: 1,
      latest_digest: "d",
      remark: "小天气",
    }),
  );
  await expect(api.setRemark(session.token, "weather", "小天气")).resolves.toBe("小天气");
  await api.recruit(session.token, "respiratory-doctor");
  await expect(api.providerSettings(session.token)).resolves.toMatchObject({
    configured: false,
    connections: [],
  });
  await expect(
    api.upsertProviderConnection(session.token, {
      templateId: "ollama",
      baseUrl: "http://localhost:11434/v1",
      customModelId: "qwen3:0.6b",
    }),
  ).resolves.toMatchObject({
    configured: true,
    activeModel: { templateId: "ollama", modelId: "qwen3:0.6b" },
  });
  await expect(api.preferences(session.token)).resolves.toEqual({
    themeMode: "system",
    skipEditResendConfirm: false,
    uiLocale: "zh",
  });
  await expect(api.savePreferences(session.token, { themeMode: "dark" })).resolves.toEqual({
    themeMode: "dark",
    skipEditResendConfirm: false,
    uiLocale: "zh",
  });
  await expect(
    api.savePreferences(session.token, { skipEditResendConfirm: true }),
  ).resolves.toEqual({
    themeMode: "system",
    skipEditResendConfirm: true,
    uiLocale: "zh",
  });
  expect(fetchImpl.mock.calls.at(-1)?.[1]).toMatchObject({ method: "PUT" });
  await expect(api.updateProfile(session.token, "小舟")).resolves.toEqual({
    kind: "account",
    userId: "patient-a",
    email: "patient-a@example.com",
    nickname: "小舟",
    token: "token",
  });
  await expect(api.inspectAgent(session.token, "/agents/weather/agent")).resolves.toEqual({ fileCount: 3 });
  await expect(api.publish(
    session.token,
    "/agents/weather/agent",
    "Weaty",
    "气象员",
    "演示天气",
  )).resolves.toMatchObject({
    agentId: "weather",
    version: 1,
  });
  await expect(api.visitDirectory(session.token, "respiratory-doctor", session.userId)).resolves.toBe(
    "/tmp/agentup/users/patient-a/agents/respiratory-doctor",
  );
  await expect(api.sync(session.token, "respiratory-doctor", session.userId)).resolves.toMatchObject({
    packageVersion: 1,
  });
  await expect(api.sync(session.token, "missing", session.userId)).rejects.toThrow(DesktopApiError);
});

it("preserves structured package validation errors", async () => {
  const api = new DesktopApi("http://runtime", async () => json({
    error: "运行包校验失败",
    details: [
      { path: "SYSTEM.md", message: "缺少 SYSTEM.md" },
      { path: "skills/weather/SKILL.md", message: "description 不能为空" },
    ],
  }, 400));

  const error = await api.inspectAgent("token", "/demo/agent").catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DesktopApiError);
  expect(error).toMatchObject({
    message: "运行包校验失败",
    status: 400,
    details: [
      { path: "SYSTEM.md", message: "缺少 SYSTEM.md" },
      { path: "skills/weather/SKILL.md", message: "description 不能为空" },
    ],
  });
});

it("reads a workspace directory and file", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/personal-assistant/workspace/file")) {
      return json({ path: "note.txt", kind: "text", size: 2, text: "hi" });
    }
    return json({ path: "", entries: [{ name: "note.txt", kind: "file", size: 2 }] });
  });
  const api = new DesktopApi("http://runtime", fetchImpl);
  await expect(api.listWorkspace("token", "patient-a", "personal-assistant", true, "")).resolves.toEqual({
    path: "",
    entries: [{ name: "note.txt", kind: "file", size: 2 }],
  });
  expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/personal-assistant/workspace?user_id=patient-a");
  await expect(api.readWorkspaceFile("token", "patient-a", "personal-assistant", true, "note.txt")).resolves.toEqual({
    path: "note.txt",
    kind: "text",
    size: 2,
    text: "hi",
  });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
