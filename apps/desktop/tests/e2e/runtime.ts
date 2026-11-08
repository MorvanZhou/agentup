import type { Page, Route } from "@playwright/test";

type AgentRecord = {
  agent_id: string;
  name: string;
  role: string;
  background: string;
  latest_version: number;
  latest_digest: string;
  local_version: number;
  recruited: boolean;
  has_avatar: boolean;
  avatar_url: string | null;
  remark: string;
  recruit_count: number;
  created_at: string;
  updated_at: string;
};

function sse(chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
}

function sessionModelPayload(
  settings: {
  active_model: { template_id: string; model_id: string } | null;
  available_models: Array<{
    template_id: string;
    model_id: string;
    name: string;
    vendor_id?: string;
    vendor_label: string;
    option_label: string;
    label?: string;
    enabled: boolean;
    credits?: number;
  }>;
  configured: boolean;
  model_mode?: string;
  templates?: Array<{ id: string; access?: string; label?: string }>;
},
  followUp = false,
) {
  const enabled = settings.available_models.filter((model) => model.enabled);
  const activeAccess = settings.active_model
    ? settings.templates?.find((item) => item.id === settings.active_model!.template_id)?.access
    : undefined;
  return {
    current: settings.active_model,
    models: enabled.map((model) => ({
      template_id: model.template_id,
      model_id: model.model_id,
      name: model.name,
      vendor_id: model.vendor_id ?? "",
      vendor_label: model.vendor_label,
      option_label: model.option_label,
      label:
        model.label ??
        settings.templates?.find((item) => item.id === model.template_id)?.label ??
        "",
      credits: model.credits ?? null,
    })),
    configured: settings.configured,
    model_mode: settings.model_mode === "per_agent" ? "per_agent" : "unified",
    // 本地 Agent App 当前模型 → 桌面回合中发送改成排队（也可由 prompt 场景强制）
    follow_up: followUp || activeAccess === "agent-sdk",
  };
}

export async function installRuntime(
  page: Page,
  options?: {
    loginError?: string;
    prompt?:
      | "stream"
      | "slow-stream"
      | "interruptible"
      | "interruptible-fallback"
      | "missing-model"
      | "approval"
      | "ask-user"
      | "ask-user-multi"
      | "delegation"
      | "delegation-running"
      /** 外部 SDK 过程卡：解包后的 mcp__agentup__* 专用卡 + 旁白 */
      | "sdk-process"
      /** 第一轮挂起（保持 busy），后续 prompt 一律 202 入队 */
      | "follow-up"
      /** 同上，但第一轮约 2.5s 就收：用来测队列被消费那一轮的顺序 */
      | "follow-up-drain";
    inspectError?: {
      error: string;
      details: Array<{ path: string; message: string }>;
    };
    publishError?: string;
    recruited?: string[];
    localVersions?: Record<string, number>;
    unread?: Record<string, number>;
    previews?: Record<string, string>;
    lastActiveAt?: Record<string, number>;
    remarks?: Record<string, string>;
    history?: Record<string, unknown[]>;
    /** 委托旁路过程 history：taskId → UIMessage[] */
    delegationHistories?: Record<string, unknown[]>;
    modelConfigured?: boolean;
    /** 群聊房间 mock（id / title / members 必填，其余字段有默认）。 */
    groups?: Array<Record<string, unknown>>;
    /** 追加市场 Agent（群设置加人等场景）。 */
    extraAgents?: Array<{
      agent_id: string;
      name: string;
      role?: string;
      background?: string;
    }>;
  },
): Promise<void> {
  const histories: Record<string, unknown[]> = Object.fromEntries(
    Object.entries(options?.history ?? {}).map(([agentId, messages]) => [agentId, [...messages]]),
  );
  const delegationHistories: Record<string, unknown[]> = Object.fromEntries(
    Object.entries(options?.delegationHistories ?? {}).map(([taskId, messages]) => [
      taskId,
      [...messages],
    ]),
  );
  const agents: AgentRecord[] = [
    {
      agent_id: "respiratory-doctor",
      name: "呼吸科医生",
      role: "医生",
      background: "演示用呼吸科问诊。",
      latest_version: 1,
      latest_digest: "digest",
      local_version: 0,
      recruited: false,
      has_avatar: false,
      avatar_url: null,
      remark: "",
      recruit_count: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
    {
      agent_id: "weather",
      name: "Weaty",
      role: "气象员",
      background: "演示用天气 Agent。按城市查询天气、预报和气候。",
      latest_version: 1,
      latest_digest: "weather-digest",
      local_version: 0,
      recruited: false,
      has_avatar: false,
      avatar_url: null,
      remark: "",
      recruit_count: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-03T00:00:00Z",
    },
  ];
  for (const extra of options?.extraAgents ?? []) {
    if (agents.some((agent) => agent.agent_id === extra.agent_id)) continue;
    agents.push({
      agent_id: extra.agent_id,
      name: extra.name,
      role: extra.role ?? "",
      background: extra.background ?? "",
      latest_version: 1,
      latest_digest: `${extra.agent_id}-digest`,
      local_version: 0,
      recruited: false,
      has_avatar: false,
      avatar_url: null,
      remark: "",
      recruit_count: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  }
  type LocalAgentRecord = {
    agent_id: string;
    name: string;
    role: string;
    background: string;
    rules: string;
    skills: string[];
    mcp_servers: Record<string, unknown>;
    published_agent_id: string | null;
    latest_version: number;
    latest_digest: string;
    created_at: string;
    updated_at: string;
    avatar_url: string | null;
  };
  const localAgents: LocalAgentRecord[] = [];
  let localSeq = 0;
  const FAKE_AVATAR = "data:image/png;base64,iVBORw0KGgo=";

  function upsertPublishedWriter(body: {
    name: string;
    role?: string;
    background: string;
    agent_id?: string;
  }) {
    const version = body.agent_id ? 2 : 1;
    if (!agents.some((agent) => agent.agent_id === "writer")) {
      agents.push({
        agent_id: "writer",
        name: body.name,
        role: body.role ?? "",
        background: body.background,
        latest_version: version,
        latest_digest: "writer-digest",
        local_version: 0,
        recruited: false,
        has_avatar: true,
        avatar_url: FAKE_AVATAR,
        remark: "",
        recruit_count: 0,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      });
    } else {
      const agent = agents.find((item) => item.agent_id === "writer")!;
      agent.name = body.name;
      agent.role = body.role ?? "";
      agent.background = body.background;
      agent.latest_version = version;
      agent.has_avatar = true;
      agent.avatar_url = agent.avatar_url ?? FAKE_AVATAR;
      agent.updated_at = "2026-02-02T00:00:00Z";
    }
    return {
      agent_id: "writer",
      name: body.name,
      role: body.role ?? "",
      background: body.background,
      version,
      digest: "writer-digest",
    };
  }

  function localCard(agent: LocalAgentRecord) {
    return {
      kind: "local",
      agent_id: agent.agent_id,
      name: agent.name,
      role: agent.role,
      background: agent.background,
      latest_version: agent.latest_version,
      latest_digest: agent.latest_digest,
      local_version: agent.latest_version,
      recruited: true,
      has_avatar: Boolean(agent.avatar_url),
      avatar_url: agent.avatar_url,
      remark: "",
      recruit_count: 0,
      created_at: agent.created_at,
      updated_at: agent.updated_at,
      rules: agent.rules,
      skills: agent.skills,
      mcp_servers: agent.mcp_servers,
      published_agent_id: agent.published_agent_id,
    };
  }
  // 契约与 runtime serialize 对齐：模板带 access，顶层带 agent_sdks（缺了 reader 会拒收整份配置）
  const ollamaTemplate = {
    id: "ollama",
    access: "api",
    vendor_id: "ollama",
    vendor_label: "Ollama",
    option_label: "本机",
    label: "Ollama",
    kind: "ollama",
    pi_provider_id: "ollama",
    requires_api_key: false,
    default_base_url: "http://localhost:11434/v1",
    default_model_id: "qwen3:4b",
    hint: "模型名需与 ollama list 一致",
    api: "openai-completions",
    supports_model_discovery: true,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const deepseekTemplate = {
    id: "deepseek",
    access: "api",
    vendor_id: "deepseek",
    vendor_label: "DeepSeek",
    option_label: "DeepSeek",
    label: "DeepSeek",
    kind: "pi-native",
    pi_provider_id: "deepseek",
    requires_api_key: true,
    default_model_id: "deepseek-flash",
    supports_model_discovery: false,
    models: [{ id: "deepseek-flash", name: "deepseek-flash", api: "openai-completions", reasoning: false }],
  };
  // 与生产目录对齐：本地 Agent App 始终出现在第二组（默认未安装）
  const claudeAgentSdkTemplate = {
    id: "claude-agent-sdk",
    access: "agent-sdk",
    vendor_id: "anthropic",
    vendor_label: "Claude Code",
    option_label: "本地 Agent App",
    label: "Claude Code",
    kind: "agent-sdk",
    pi_provider_id: "claude-agent-sdk",
    requires_api_key: false,
    default_model_id: null,
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const codebuddySdkTemplate = {
    id: "codebuddy-sdk",
    access: "agent-sdk",
    vendor_id: "codebuddy",
    vendor_label: "Workbuddy / CodeBuddy",
    option_label: "本地 Agent App",
    label: "Workbuddy / CodeBuddy",
    kind: "agent-sdk",
    pi_provider_id: "codebuddy-sdk",
    requires_api_key: false,
    default_model_id: "claude-sonnet-5",
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const codexSdkTemplate = {
    id: "codex-sdk",
    access: "agent-sdk",
    vendor_id: "codex",
    vendor_label: "Codex",
    option_label: "本地 Agent App",
    label: "Codex",
    kind: "agent-sdk",
    pi_provider_id: "codex-sdk",
    requires_api_key: false,
    default_model_id: "default",
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const opencodeSdkTemplate = {
    id: "opencode-sdk",
    access: "agent-sdk",
    vendor_id: "opencode",
    vendor_label: "OpenCode",
    option_label: "本地 Agent App",
    label: "OpenCode",
    kind: "agent-sdk",
    pi_provider_id: "opencode-sdk",
    requires_api_key: false,
    default_model_id: "default",
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const copilotSdkTemplate = {
    id: "copilot-sdk",
    access: "agent-sdk",
    vendor_id: "copilot",
    vendor_label: "GitHub Copilot",
    option_label: "本地 Agent App",
    label: "GitHub Copilot",
    kind: "agent-sdk",
    pi_provider_id: "copilot-sdk",
    requires_api_key: false,
    default_model_id: "auto",
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  const deepseekHarnessSdkTemplate = {
    id: "deepseek-harness-sdk",
    access: "agent-sdk",
    vendor_id: "deepseek-harness",
    vendor_label: "DeepSeek",
    option_label: "本地 Agent App",
    label: "DeepSeek Harness",
    kind: "agent-sdk",
    pi_provider_id: "deepseek-harness-sdk",
    requires_api_key: false,
    default_model_id: "deepseek-flash",
    supports_model_discovery: false,
    models: [] as Array<{ id: string; name: string; api: string; reasoning: boolean }>,
  };
  type AgentSdkRow = {
    template_id: string;
    vendor_label: string;
    option_label: string;
    label: string;
    hint: string | null;
    package: string;
    size_hint_mb: number;
    login_guide: { command: string; doc_url: string | null } | null;
    state: string;
    installed_version: string | null;
    last_error: string | null;
    account_label: string | null;
    models: Array<{ id: string; name: string; credits: number | null }>;
    auth_environments: Array<"internal" | "external"> | null;
    auth_environment: "internal" | "external" | null;
    api_key_paste?: "opencode" | "github-pat" | "deepseek" | null;
  };
  const defaultSdkModels: AgentSdkRow["models"] = [
    { id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 },
  ];
  /** 安装轮询：第 1 次 downloading，第 2 次起 done（对齐桌面 700ms 轮询） */
  let sdkInstallPolls = 0;
  let sdkInstallJobId: string | null = null;
  let providerSettings = {
    connections:
      options?.modelConfigured === false
        ? []
        : [
            {
              template_id: "ollama",
              base_url: "http://localhost:11434/v1",
              api_key_cipher: undefined as string | undefined,
              custom_model_ids: ["qwen3:4b"],
              discovered_model_ids: [] as string[],
              has_api_key: true,
              pi_provider_id: "ollama",
              requires_api_key: false,
              vendor_id: "ollama",
              vendor_label: "Ollama",
              option_label: "本机",
              label: "Ollama",
            },
          ],
    enabled_models:
      options?.modelConfigured === false ? [] : [{ template_id: "ollama", model_id: "qwen3:4b" }],
    active_model:
      options?.modelConfigured === false ? null : { template_id: "ollama", model_id: "qwen3:4b" },
    available_models:
      options?.modelConfigured === false
        ? []
        : ([
            {
              template_id: "ollama",
              model_id: "qwen3:4b",
              name: "qwen3:4b",
              vendor_id: "ollama",
              vendor_label: "Ollama",
              option_label: "本机",
              label: "Ollama · 本机",
              enabled: true,
              active: true,
              custom: true,
            },
          ] as Array<{
            template_id: string;
            model_id: string;
            name: string;
            vendor_id: string;
            vendor_label: string;
            option_label: string;
            label: string;
            enabled: boolean;
            active: boolean;
            custom: boolean;
            credits?: number;
          }>),
    configured: options?.modelConfigured !== false,
    model_mode: "unified" as "unified" | "per_agent",
    overridden_by_environment: false,
    vendors: [
      { id: "ollama", label: "Ollama", options: [ollamaTemplate] },
      {
        id: "deepseek",
        label: "DeepSeek",
        options: [deepseekTemplate, deepseekHarnessSdkTemplate],
      },
    ],
    templates: [
      ollamaTemplate,
      deepseekTemplate,
      deepseekHarnessSdkTemplate,
      claudeAgentSdkTemplate,
      codebuddySdkTemplate,
      codexSdkTemplate,
      opencodeSdkTemplate,
      copilotSdkTemplate,
    ],
    agent_sdks: [
      {
        template_id: "claude-agent-sdk",
        vendor_label: "Claude Code",
        option_label: "本地 Agent App",
        label: "Claude Code",
        hint: "用 Anthropic Console API Key 在本机跑 Claude Code",
        package: "@anthropic-ai/claude-agent-sdk",
        size_hint_mb: 300,
        login_guide: {
          command: "paste Anthropic API Key",
          doc_url: "https://console.anthropic.com/settings/keys",
        },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: null,
        auth_environment: null,
        api_key_paste: "anthropic",
      },
      {
        template_id: "codebuddy-sdk",
        vendor_label: "Workbuddy / CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        hint: "用你本机的 Workbuddy / CodeBuddy 订阅执行任务",
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: { command: "cbc login", doc_url: null },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: ["internal", "external"],
        auth_environment: null,
      },
      {
        template_id: "codex-sdk",
        vendor_label: "Codex",
        option_label: "本地 Agent App",
        label: "Codex",
        hint: "用你的 ChatGPT 订阅在本机跑 Codex Agent",
        package: "@openai/codex-sdk",
        size_hint_mb: 360,
        login_guide: { command: "codex login", doc_url: "https://learn.chatgpt.com/docs/codex-sdk" },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: null,
        auth_environment: null,
      },
      {
        template_id: "opencode-sdk",
        vendor_label: "OpenCode",
        option_label: "本地 Agent App",
        label: "OpenCode",
        hint: "用你的 OpenCode 官方账号在本机跑 Agent",
        package: "opencode-ai",
        size_hint_mb: 180,
        login_guide: { command: "opencode auth login opencode", doc_url: "https://opencode.ai/auth" },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: null,
        auth_environment: null,
        api_key_paste: "opencode",
      },
      {
        template_id: "copilot-sdk",
        vendor_label: "GitHub Copilot",
        option_label: "本地 Agent App",
        label: "GitHub Copilot",
        hint: "用你的 GitHub Copilot 订阅在本机跑 Agent",
        package: "@github/copilot-sdk",
        size_hint_mb: 160,
        login_guide: {
          command: "paste GitHub token",
          doc_url: "https://github.com/settings/personal-access-tokens",
        },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: null,
        auth_environment: null,
        api_key_paste: "github-pat",
      },
      {
        template_id: "deepseek-harness-sdk",
        vendor_label: "DeepSeek",
        option_label: "本地 Agent App",
        label: "DeepSeek Harness",
        hint: "用 DeepSeek 平台 API Key 在本机跑 Harness Agent",
        package: "@deepseek-ai/dsh-sdk-client",
        size_hint_mb: 100,
        login_guide: {
          command: "paste DeepSeek API Key",
          doc_url: "https://platform.deepseek.com/api_keys",
        },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        account_label: null,
        models: [],
        auth_environments: null,
        auth_environment: null,
        api_key_paste: "deepseek",
      },
    ] as AgentSdkRow[],
  };

  /** 只 mock CodeBuddy 状态机；勿用 [0]——目录里 Claude 等可能排在前面 */
  function sdkRow(): AgentSdkRow {
    const row = providerSettings.agent_sdks.find((item) => item.template_id === "codebuddy-sdk");
    if (!row) throw new Error("e2e mock 缺少 codebuddy-sdk");
    return row;
  }

  function clearSdkModelsFromSelection(): void {
    const templateId = "codebuddy-sdk";
    let enabledModels = providerSettings.enabled_models.filter((item) => item.template_id !== templateId);
    let activeModel =
      providerSettings.active_model?.template_id === templateId ? null : providerSettings.active_model;
    if (!activeModel && enabledModels.length > 0) activeModel = enabledModels[0]!;
    providerSettings = {
      ...providerSettings,
      enabled_models: enabledModels,
      active_model: activeModel,
      configured: Boolean(activeModel),
    };
  }

  function rebuildAvailableModels(): void {
    const enabled = new Set(
      providerSettings.enabled_models.map((item) => `${item.template_id}::${item.model_id}`),
    );
    const activeKey = providerSettings.active_model
      ? `${providerSettings.active_model.template_id}::${providerSettings.active_model.model_id}`
      : "";
    const rows: typeof providerSettings.available_models = [];
    for (const connection of providerSettings.connections) {
      const template = providerSettings.templates.find((item) => item.id === connection.template_id);
      if (!template) continue;
      const catalogIds = new Set([
        ...template.models.map((model) => model.id),
        ...(connection.discovered_model_ids ?? []),
      ]);
      const customIds = new Set(connection.custom_model_ids);
      const ids = [
        ...template.models.map((model) => model.id),
        ...(connection.discovered_model_ids ?? []),
        ...connection.custom_model_ids,
      ];
      const seen = new Set<string>();
      for (const modelId of ids) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        const key = `${connection.template_id}::${modelId}`;
        const catalog = template.models.find((model) => model.id === modelId);
        rows.push({
          template_id: connection.template_id,
          model_id: modelId,
          name: catalog?.name ?? modelId,
          vendor_id: template.vendor_id,
          vendor_label: template.vendor_label,
          option_label: template.option_label,
          label: template.label,
          enabled: enabled.has(key),
          active: key === activeKey,
          custom: customIds.has(modelId) && !catalogIds.has(modelId),
        });
      }
    }
    // 本地接入没有 connection：ready 后目录进「启用服务」
    for (const sdk of providerSettings.agent_sdks) {
      if (sdk.state !== "ready") continue;
      const template = providerSettings.templates.find((item) => item.id === sdk.template_id);
      if (!template) continue;
      for (const model of sdk.models) {
        const key = `${sdk.template_id}::${model.id}`;
        rows.push({
          template_id: sdk.template_id,
          model_id: model.id,
          name: model.name,
          vendor_id: template.vendor_id,
          vendor_label: template.vendor_label,
          option_label: template.option_label,
          label: template.label,
          enabled: enabled.has(key),
          active: key === activeKey,
          custom: false,
          ...(typeof model.credits === "number" ? { credits: model.credits } : {}),
        });
      }
    }
    providerSettings.available_models = rows;
  }
  let themeMode = "system";
  let skipEditResendConfirm = false;
  let uiLocale = "zh";
  let chatFontSize = "md";
  /** 群聊列表 mock：e2e 群聊（附件预览等）场景的最小房间数据。 */
  const groupRooms: Array<Record<string, unknown>> = (options?.groups ?? []).map((room) => {
    const members = Array.isArray(room.members) ? room.members : [];
    const firstId =
      members[0] && typeof members[0] === "object" && typeof (members[0] as { agentId?: unknown }).agentId === "string"
        ? (members[0] as { agentId: string }).agentId
        : "";
    return {
      lines: [],
      phase: "idle",
      holderId: null,
      defaultHolderId: firstId,
      holderSpeaking: false,
      taskIds: [],
      pendingDelegations: [],
      queue: [],
      updatedAt: 0,
      linesHasMore: false,
      ...room,
    };
  });
  let uiUnread: Record<string, number> = { ...(options?.unread ?? {}) };
  let uiPreviews: Record<string, string> = { ...(options?.previews ?? {}) };
  let uiLastActiveAt: Record<string, number> = { ...(options?.lastActiveAt ?? {}) };
  let userSkills: Array<{ name: string; description: string; enabled: boolean }> = [];
  let userAgentsMd = "";
  let userMcpServers: Record<string, unknown> = {};
  let personalProfile = {
    name: "小A",
    role: "我的助理",
    background: "熟悉用户的工作习惯，擅长日常协作。",
    avatar_url: null as string | null,
  };
  let accountAvatarUrl: string | null = null;
  const workspaces = new Map<string, WorkspaceNode>();
  for (const agent of agents) {
    agent.recruited = options?.recruited?.includes(agent.agent_id) ?? false;
    agent.remark = agent.recruited ? (options?.remarks?.[agent.agent_id] ?? "") : "";
    if (options?.localVersions?.[agent.agent_id] !== undefined) {
      agent.local_version = options.localVersions[agent.agent_id]!;
    }
  }
  // 只拦截应用的 /runtime 控制面；不要误伤 Vite 的 /src/shared/api/runtime/*.ts 模块。
  let interruptiblePrompts = 0;
  let releaseFirstInterrupt: (() => void) | null = null;
  /** followUp 队列 mock：本地 Agent App 接入下，回合中的新消息落到这里。 */
  let followUpPrompts = 0;
  let followUpQueue: Array<{ id: string; text: string; created_at: number }> = [];
  /** 第一轮（挂着的那轮）是否已回完：/turn-stream 要等它结束才发消费轮。 */
  let firstDrainTurnServed = false;
  /** 消费轮已开始：wake busy 要保持到测试结束，直播区块才不会一闪而过。 */
  let drainWake = false;
  /**
   * 消费轮要发的那条用户消息：第一次消费时把队列拼好并清空，之后重连（runtime 的 hub 会回放缓冲）
   * 仍发同一条，保证晚连上的客户端也先看到用户那条。
   */
  let drainedEcho: string | null = null;
  /**
   * 首轮 SSE 常被 reload / wake 依赖抖动打断。
   * 多回放几次（带短延迟）给观察者抓到；次数用尽再挂住防风暴。
   * 只回放 1 次时，并发行下第二次重连会空挂，消费轮文案永远进不了 DOM。
   */
  let drainReplayCount = 0;
  /** 队列被消费后发的那一轮：先 echo 用户那条，再出助手正文（顺序 = 用户 → 助手）。 */
  function followUpDrainSse(agentId: string): string {
    if (drainedEcho === null) {
      drainedEcho = followUpQueue.map((item) => item.text).join("\n");
      followUpQueue = [];
      // 写入 history：wake 流 onDone→reloadHistory 时不至于把线程刷空
      if (agentId && drainedEcho) {
        const list = histories[agentId] ?? (histories[agentId] = []);
        list.push(
          {
            id: "follow-up-drain-user",
            role: "user",
            parts: [{ type: "text", text: drainedEcho }],
          },
          {
            id: "follow-up-drain",
            role: "assistant",
            parts: [{ type: "text", text: "已收到，正在查" }],
          },
        );
      }
    }
    const joined = drainedEcho;
    return sse([
      { type: "data-agentup-follow-up-sent", data: { text: joined, ids: [] } },
      { type: "start", messageId: "follow-up-drain" },
      { type: "start-step" },
      { type: "text-start", id: "follow-up-drain-text" },
      { type: "text-delta", id: "follow-up-drain-text", delta: "已收到，正在查" },
      { type: "text-end", id: "follow-up-drain-text" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
  }
  async function holdTurnStream(
    route: { fulfill: (r: { status: number; body: string }) => Promise<unknown> },
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    try {
      await route.fulfill({ status: 204, body: "" });
    } catch {
      /* 页面关了 */
    }
  }
  function fulfillDrain(
    route: {
      fulfill: (r: {
        status: number;
        headers: Record<string, string>;
        body: string;
      }) => Promise<unknown>;
    },
    agentId: string,
  ) {
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-cache",
      },
      body: followUpDrainSse(agentId),
    });
  }
  await page.route(/^https?:\/\/[^/]+\/runtime(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/runtime/, "");

    // ── 群聊 mock（e2e：群附件 / 芯片缩略预览） ──
    if (request.method() === "GET" && path === "/groups") {
      return json(route, 200, { groups: groupRooms });
    }
    if (request.method() === "GET" && /^\/groups\/[^/]+$/.test(path)) {
      const groupId = path.split("/")[2]!;
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      return json(route, 200, { group: room, liveTurnId: "" });
    }
    if (request.method() === "PUT" && /^\/groups\/[^/]+$/.test(path)) {
      const groupId = path.split("/")[2]!;
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      const body = request.postDataJSON() as { title?: string };
      if (typeof body.title === "string") room.title = body.title.trim() || room.title;
      return json(route, 200, { group: room });
    }
    if (request.method() === "PUT" && /^\/groups\/[^/]+\/members$/.test(path)) {
      const groupId = path.split("/")[2]!;
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      const body = request.postDataJSON() as { members?: unknown; defaultHolderId?: unknown };
      if (Array.isArray(body.members)) room.members = body.members;
      if (typeof body.defaultHolderId === "string" && body.defaultHolderId.trim()) {
        room.defaultHolderId = body.defaultHolderId.trim();
      }
      return json(route, 200, { group: room });
    }
    if (request.method() === "PUT" && /^\/groups\/[^/]+\/model-mode$/.test(path)) {
      const groupId = path.split("/")[2]!;
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      const body = request.postDataJSON() as { mode?: string };
      room.modelMode = body.mode === "per_agent" || body.mode === "perAgent" ? "perAgent" : "unified";
      return json(route, 200, { group: room });
    }
    if (request.method() === "PUT" && /^\/groups\/[^/]+\/model$/.test(path)) {
      const groupId = path.split("/")[2]!;
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      const body = request.postDataJSON() as { template_id?: string; model_id?: string };
      room.model = { templateId: body.template_id ?? "", modelId: body.model_id ?? "" };
      return json(route, 200, { group: room });
    }
    if (request.method() === "POST" && /^\/groups\/[^/]+\/messages$/.test(path)) {
      const groupId = path.split("/")[2] ?? "";
      const room = groupRooms.find((item) => item.id === groupId);
      if (!room) return json(route, 404, { error: "找不到群" });
      const body = request.postDataJSON() as { text?: string };
      const lines = Array.isArray(room.lines) ? [...room.lines] : [];
      lines.push({
        id: `line-${lines.length + 1}`,
        role: "user",
        authorId: "patient-a",
        text: typeof body.text === "string" ? body.text : "",
        at: Date.now(),
      });
      room.lines = lines;
      return json(route, 200, { room, liveTurnId: "" });
    }
    if (request.method() === "POST" && /^\/groups\/[^/]+\/attachments$/.test(path)) {
      // staging 成功：固定返回带 id 后缀的图片附件（`<stem>_<id>.<ext>` 格式）
      const body = request.postDataJSON() as { name?: string };
      return json(route, 200, {
        id: "94319ddb",
        path: "ATTACHMENTS/cover_94319ddb.png",
        ref: "@ATTACHMENTS/cover_94319ddb.png",
        name: body.name ?? "cover.png",
        media_type: "image/png",
      });
    }
    if (request.method() === "GET" && /^\/groups\/[^/]+\/workspace\/file$/.test(path)) {
      const filePath = url.searchParams.get("path") ?? "";
      if (!filePath.endsWith(".png")) return json(route, 200, { path: filePath, kind: "binary", size: 1 });
      // 1x1 PNG：供芯片缩略经 dataURL 渲染
      return json(route, 200, {
        path: filePath,
        kind: "image",
        size: 70,
        media_type: "image/png",
        data_base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKsMIQAAAABJRU5ErkJggg==",
      });
    }
    if (request.method() === "GET" && path === "/personal-assistant/profile") {
      return json(route, 200, personalProfile);
    }
    if (request.method() === "PUT" && path === "/personal-assistant/profile") {
      const body = request.postDataJSON() as {
        name?: string;
        role?: string;
        background?: string;
        avatar_data_url?: string | null;
      };
      if (!body.name?.trim() || !body.role?.trim() || !body.background?.trim()) {
        return json(route, 400, { error: "请求无效" });
      }
      if (body.avatar_data_url === null) {
        return json(route, 400, { error: "不支持移除头像" });
      }
      personalProfile = {
        name: body.name.trim(),
        role: body.role.trim(),
        background: body.background.trim(),
        avatar_url:
          typeof body.avatar_data_url === "string"
            ? body.avatar_data_url
            : personalProfile.avatar_url,
      };
      return json(route, 200, personalProfile);
    }
    if (request.method() === "GET" && path === "/settings/provider") {
      return json(route, 200, providerSettings);
    }
    // ── 本地 Agent App：安装 / 登录 / 登出 / 模型 / 卸载（.cursor/skills/agentup-sdk-adapter） ──
    const sdkAgent = path.match(/^\/settings\/provider\/agents\/([^/]+)(.*)$/);
    if (sdkAgent) {
      const templateId = decodeURIComponent(sdkAgent[1]!);
      const rest = sdkAgent[2] ?? "";
      if (templateId !== "codebuddy-sdk") {
        return json(route, 400, { error: "未知的本地接入" });
      }
      if (request.method() === "POST" && rest === "/install") {
        sdkInstallJobId = `sdk-install-${Date.now()}`;
        sdkInstallPolls = 0;
        sdkRow().state = "installing";
        sdkRow().last_error = null;
        return json(route, 200, { job_id: sdkInstallJobId });
      }
      // 取消接入：杀进行中 job，状态打回待接入（与 runtime cancel 对齐）
      const installCancel = rest.match(/^\/install\/([^/]+)\/cancel$/);
      if (request.method() === "POST" && installCancel) {
        const jobId = decodeURIComponent(installCancel[1]!);
        if (jobId !== sdkInstallJobId) return json(route, 400, { error: "安装任务不存在" });
        sdkInstallJobId = null;
        sdkInstallPolls = 0;
        sdkRow().state = "not_installed";
        sdkRow().installed_version = null;
        sdkRow().last_error = null;
        return json(route, 200, providerSettings);
      }
      const installJob = rest.match(/^\/install\/([^/]+)$/);
      if (request.method() === "GET" && installJob) {
        const jobId = decodeURIComponent(installJob[1]!);
        if (jobId !== sdkInstallJobId) return json(route, 404, { error: "安装任务不存在" });
        sdkInstallPolls += 1;
        // 前几轮保持 downloading，便于「取消接入」测例点到按钮；第 8 轮起完成
        if (sdkInstallPolls < 8) {
          return json(route, 200, {
            job_id: jobId,
            template_id: templateId,
            phase: "downloading",
            detail: "正在下载接入组件…",
          });
        }
        sdkRow().state = "not_logged_in";
        sdkRow().installed_version = "0.3.295";
        sdkRow().models = [];
        sdkRow().account_label = null;
        rebuildAvailableModels();
        return json(route, 200, {
          job_id: jobId,
          template_id: templateId,
          phase: "done",
        });
      }
      if (request.method() === "POST" && rest === "/login") {
        if (sdkRow().state === "not_installed") {
          return json(route, 400, { error: "尚未接入，请先开始接入" });
        }
        // 记住站点偏好：中国站 internal / 国际站 external
        const body = (request.postDataJSON() ?? {}) as { environment?: string };
        if (body.environment === "internal" || body.environment === "external") {
          sdkRow().auth_environment = body.environment;
        }
        sdkRow().state = "logging_in";
        return json(route, 200, {
          auth_url: "https://example.com/codebuddy-login",
          state: "logging_in",
        });
      }
      if (request.method() === "POST" && rest === "/login-check") {
        sdkRow().state = "ready";
        sdkRow().account_label = "mock-sdk-user";
        sdkRow().models = [...defaultSdkModels];
        sdkRow().last_error = null;
        rebuildAvailableModels();
        return json(route, 200, {
          auth_url: null,
          state: "ready",
          account_label: "mock-sdk-user",
        });
      }
      if (request.method() === "POST" && rest === "/logout") {
        sdkRow().state = "not_logged_in";
        sdkRow().account_label = null;
        sdkRow().models = [];
        clearSdkModelsFromSelection();
        rebuildAvailableModels();
        return json(route, 200, providerSettings);
      }
      if (request.method() === "POST" && rest === "/models") {
        if (sdkRow().state !== "ready") {
          return json(route, 400, { error: "请先登录本地 Agent App" });
        }
        sdkRow().models = [
          ...defaultSdkModels,
          { id: "claude-opus-4", name: "Claude-Opus-4", credits: 5 },
        ];
        rebuildAvailableModels();
        return json(route, 200, providerSettings);
      }
      if (request.method() === "DELETE" && rest === "") {
        sdkRow().state = "not_installed";
        sdkRow().installed_version = null;
        sdkRow().account_label = null;
        sdkRow().models = [];
        sdkRow().last_error = null;
        sdkInstallJobId = null;
        clearSdkModelsFromSelection();
        rebuildAvailableModels();
        return json(route, 200, providerSettings);
      }
    }
    if (request.method() === "PUT" && path === "/settings/provider/runtime-secrets") {
      return json(route, 200, { ok: true });
    }
    if (request.method() === "POST" && path === "/settings/provider/connections") {
      const body = request.postDataJSON() as {
        template_id: string;
        base_url?: string;
        api_key_cipher?: string;
        clear_api_key?: boolean;
        custom_model_id?: string;
      };
      const template =
        providerSettings.templates.find((item) => item.id === body.template_id) ?? ollamaTemplate;
      const existing = providerSettings.connections.find((item) => item.template_id === body.template_id);
      const customModelIds = [...(existing?.custom_model_ids ?? [])];
      if (body.custom_model_id && !customModelIds.includes(body.custom_model_id)) {
        customModelIds.push(body.custom_model_id);
      }
      const connection = {
        template_id: body.template_id,
        base_url: (body.base_url ?? existing?.base_url ?? "").replace(/\/+$/, ""),
        api_key_cipher: body.clear_api_key ? undefined : body.api_key_cipher ?? existing?.api_key_cipher,
        custom_model_ids: customModelIds,
        discovered_model_ids: existing?.discovered_model_ids ?? [],
        has_api_key:
          (!body.clear_api_key && Boolean(body.api_key_cipher || existing?.api_key_cipher)) ||
          body.template_id === "ollama",
        pi_provider_id: template.pi_provider_id,
        requires_api_key: template.requires_api_key,
        vendor_id: template.vendor_id,
        vendor_label: template.vendor_label,
        option_label: template.option_label,
        label: template.label,
      };
      const connections = [
        ...providerSettings.connections.filter((item) => item.template_id !== body.template_id),
        connection,
      ];
      const modelId = body.custom_model_id || template.default_model_id || customModelIds[0];
      let enabledModels = [...providerSettings.enabled_models];
      let activeModel = providerSettings.active_model;
      if (modelId && !activeModel) {
        activeModel = { template_id: body.template_id, model_id: modelId };
        if (!enabledModels.some((item) => item.template_id === body.template_id && item.model_id === modelId)) {
          enabledModels = [...enabledModels, activeModel];
        }
      } else if (modelId) {
        const ref = { template_id: body.template_id, model_id: modelId };
        if (
          !enabledModels.some(
            (item) => item.template_id === ref.template_id && item.model_id === ref.model_id,
          )
        ) {
          enabledModels = [...enabledModels, ref];
        }
      }
      providerSettings = {
        ...providerSettings,
        connections,
        enabled_models: enabledModels,
        active_model: activeModel,
        configured: Boolean(activeModel),
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (
      request.method() === "POST" &&
      path.startsWith("/settings/provider/connections/") &&
      path.endsWith("/refresh-models")
    ) {
      const templateId = decodeURIComponent(
        path.slice("/settings/provider/connections/".length, -"/refresh-models".length),
      );
      const connection = providerSettings.connections.find((item) => item.template_id === templateId);
      if (!connection) return json(route, 400, { error: "请先配置该服务商" });
      const template = providerSettings.templates.find((item) => item.id === templateId);
      if (!template?.supports_model_discovery) {
        return json(route, 400, { error: "该服务商不支持自动拉取模型列表" });
      }
      const discovered = ["qwen3:4b", "llama3.2:3b"];
      connection.discovered_model_ids = discovered;
      let enabledModels = [...providerSettings.enabled_models];
      let activeModel = providerSettings.active_model;
      if (!activeModel) {
        activeModel = { template_id: templateId, model_id: discovered[0]! };
        enabledModels = [...enabledModels, activeModel];
      }
      providerSettings = {
        ...providerSettings,
        enabled_models: enabledModels,
        active_model: activeModel,
        configured: Boolean(activeModel),
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (
      request.method() === "DELETE" &&
      path.startsWith("/settings/provider/connections/") &&
      path.includes("/custom-models/")
    ) {
      const rest = path.slice("/settings/provider/connections/".length);
      const marker = "/custom-models/";
      const at = rest.indexOf(marker);
      const templateId = decodeURIComponent(rest.slice(0, at));
      const modelId = decodeURIComponent(rest.slice(at + marker.length));
      const connection = providerSettings.connections.find((item) => item.template_id === templateId);
      if (!connection) return json(route, 400, { error: "请先配置该服务商" });
      if (!connection.custom_model_ids.includes(modelId)) {
        return json(route, 400, { error: "只能移除手动添加的模型" });
      }
      connection.custom_model_ids = connection.custom_model_ids.filter((id) => id !== modelId);
      let enabledModels = providerSettings.enabled_models.filter(
        (item) => !(item.template_id === templateId && item.model_id === modelId),
      );
      let activeModel = providerSettings.active_model;
      if (activeModel?.template_id === templateId && activeModel.model_id === modelId) {
        activeModel = enabledModels.find((item) => item.template_id === templateId) ?? enabledModels[0] ?? null;
      }
      providerSettings = {
        ...providerSettings,
        enabled_models: enabledModels,
        active_model: activeModel,
        configured: Boolean(activeModel),
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (request.method() === "DELETE" && path.startsWith("/settings/provider/connections/")) {
      const templateId = decodeURIComponent(path.slice("/settings/provider/connections/".length));
      // refresh-models 已在上方处理；此处忽略带斜杠的子路径
      if (templateId.includes("/")) return json(route, 404, { error: "not found" });
      const connections = providerSettings.connections.filter((item) => item.template_id !== templateId);
      let enabledModels = providerSettings.enabled_models.filter((item) => item.template_id !== templateId);
      let activeModel =
        providerSettings.active_model?.template_id === templateId ? null : providerSettings.active_model;
      if (!activeModel && enabledModels.length > 0) activeModel = enabledModels[0]!;
      providerSettings = {
        ...providerSettings,
        connections,
        enabled_models: enabledModels,
        active_model: activeModel,
        configured: Boolean(activeModel),
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (request.method() === "POST" && path === "/settings/provider/models/enabled") {
      const body = request.postDataJSON() as {
        template_id: string;
        model_id: string;
        enabled: boolean;
      };
      const key = `${body.template_id}::${body.model_id}`;
      let enabledModels = [...providerSettings.enabled_models];
      let activeModel = providerSettings.active_model;
      const exists = enabledModels.some(
        (item) => item.template_id === body.template_id && item.model_id === body.model_id,
      );
      if (body.enabled && !exists) {
        enabledModels.push({ template_id: body.template_id, model_id: body.model_id });
        if (!activeModel) activeModel = { template_id: body.template_id, model_id: body.model_id };
      }
      if (!body.enabled && exists) {
        enabledModels = enabledModels.filter(
          (item) => !(item.template_id === body.template_id && item.model_id === body.model_id),
        );
        if (activeModel && `${activeModel.template_id}::${activeModel.model_id}` === key) {
          activeModel = enabledModels[0] ?? null;
        }
      }
      providerSettings = {
        ...providerSettings,
        enabled_models: enabledModels,
        active_model: activeModel,
        configured: enabledModels.length > 0,
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (request.method() === "POST" && path === "/settings/provider/models/active") {
      const body = request.postDataJSON() as { template_id: string; model_id: string };
      let enabledModels = [...providerSettings.enabled_models];
      if (
        !enabledModels.some(
          (item) => item.template_id === body.template_id && item.model_id === body.model_id,
        )
      ) {
        enabledModels.push({ template_id: body.template_id, model_id: body.model_id });
      }
      providerSettings = {
        ...providerSettings,
        enabled_models: enabledModels,
        active_model: { template_id: body.template_id, model_id: body.model_id },
        configured: true,
      };
      rebuildAvailableModels();
      return json(route, 200, providerSettings);
    }
    if (request.method() === "GET" && path === "/preferences") {
      return json(route, 200, {
        theme_mode: themeMode,
        skip_edit_resend_confirm: skipEditResendConfirm,
        ui_locale: uiLocale,
        chat_font_size: chatFontSize,
      });
    }
    if (request.method() === "PUT" && path === "/preferences") {
      const body = request.postDataJSON() as {
        theme_mode?: string;
        skip_edit_resend_confirm?: boolean;
        ui_locale?: string;
        chat_font_size?: string;
      };
      if (body.theme_mode !== undefined) {
        if (body.theme_mode !== "system" && body.theme_mode !== "light" && body.theme_mode !== "dark") {
          return json(route, 400, { error: "theme_mode 无效" });
        }
        themeMode = body.theme_mode;
      }
      if (body.skip_edit_resend_confirm !== undefined) {
        if (typeof body.skip_edit_resend_confirm !== "boolean") {
          return json(route, 400, { error: "skip_edit_resend_confirm 无效" });
        }
        skipEditResendConfirm = body.skip_edit_resend_confirm;
      }
      if (body.ui_locale !== undefined) {
        if (body.ui_locale !== "zh" && body.ui_locale !== "en") {
          return json(route, 400, { error: "ui_locale 无效" });
        }
        uiLocale = body.ui_locale;
      }
      if (body.chat_font_size !== undefined) {
        if (body.chat_font_size !== "sm" && body.chat_font_size !== "md" && body.chat_font_size !== "lg") {
          return json(route, 400, { error: "chat_font_size 无效" });
        }
        chatFontSize = body.chat_font_size;
      }
      if (
        body.theme_mode === undefined &&
        body.skip_edit_resend_confirm === undefined &&
        body.ui_locale === undefined &&
        body.chat_font_size === undefined
      ) {
        return json(route, 400, { error: "至少提供一项偏好" });
      }
      return json(route, 200, {
        theme_mode: themeMode,
        skip_edit_resend_confirm: skipEditResendConfirm,
        ui_locale: uiLocale,
        chat_font_size: chatFontSize,
      });
    }
    if (request.method() === "GET" && path === "/state") {
      return json(route, 200, {
        unread: uiUnread,
        previews: uiPreviews,
        last_active_at: uiLastActiveAt,
        command_allow: {},
      });
    }
    if (request.method() === "POST" && path === "/state") {
      const body = request.postDataJSON() as {
        unread: Record<string, number>;
        previews: Record<string, string>;
        last_active_at: Record<string, number>;
      };
      uiUnread = {};
      for (const [agentId, count] of Object.entries(body.unread)) {
        if (typeof count === "number" && count > 0) uiUnread[agentId] = count;
      }
      uiPreviews = {};
      for (const [agentId, text] of Object.entries(body.previews)) {
        if (typeof text === "string" && text.trim()) uiPreviews[agentId] = text.trim();
      }
      uiLastActiveAt = {};
      for (const [agentId, at] of Object.entries(body.last_active_at ?? {})) {
        if (typeof at === "number" && Number.isInteger(at) && at > 0) uiLastActiveAt[agentId] = at;
      }
      return json(route, 200, {
        unread: uiUnread,
        previews: uiPreviews,
        last_active_at: uiLastActiveAt,
        command_allow: {},
      });
    }
    if (request.method() === "GET" && path === "/settings/skills") {
      return json(route, 200, { skills: userSkills });
    }
    if (request.method() === "POST" && path === "/settings/skills/inspect") {
      const body = request.postDataJSON() as { path?: string };
      if (typeof body.path !== "string" || !body.path.trim()) {
        return json(route, 400, { error: "请求无效" });
      }
      const base = body.path.replace(/\\/g, "/").split("/").pop() || "note-taker";
      const name = base.replace(/\.zip$/i, "") || "note-taker";
      return json(route, 200, { name, description: "整理笔记" });
    }
    if (request.method() === "POST" && path === "/settings/skills/install") {
      const body = request.postDataJSON() as { path?: string; expect_name?: string };
      if (typeof body.path !== "string" || !body.path.trim()) {
        return json(route, 400, { error: "请求无效" });
      }
      const name = body.expect_name?.trim() || "note-taker";
      const skill = {
        name,
        description: "整理笔记",
        enabled: userSkills.find((item) => item.name === name)?.enabled ?? true,
      };
      userSkills = [skill, ...userSkills.filter((item) => item.name !== skill.name)];
      return json(route, 200, skill);
    }
    const skillEnabled = path.match(/^\/settings\/skills\/([^/]+)\/enabled$/);
    if (request.method() === "PUT" && skillEnabled) {
      const body = request.postDataJSON() as { enabled?: boolean };
      if (typeof body.enabled !== "boolean") return json(route, 400, { error: "请求无效" });
      const name = decodeURIComponent(skillEnabled[1]);
      const current = userSkills.find((item) => item.name === name);
      if (!current) return json(route, 400, { error: "技能不存在" });
      current.enabled = body.enabled;
      return json(route, 200, current);
    }
    const skillDelete = path.match(/^\/settings\/skills\/([^/]+)$/);
    if (request.method() === "DELETE" && skillDelete) {
      const name = decodeURIComponent(skillDelete[1]);
      userSkills = userSkills.filter((item) => item.name !== name);
      return json(route, 200, { deleted: true });
    }
    if (request.method() === "GET" && path === "/settings/mcp") {
      return json(route, 200, { mcp_servers: userMcpServers });
    }
    if (request.method() === "PUT" && path === "/settings/mcp") {
      const body = request.postDataJSON() as { mcp_servers?: Record<string, unknown> };
      if (!body.mcp_servers || typeof body.mcp_servers !== "object" || Array.isArray(body.mcp_servers)) {
        return json(route, 400, { error: "mcp_servers 必须是对象" });
      }
      userMcpServers = body.mcp_servers;
      return json(route, 200, { mcp_servers: userMcpServers });
    }
    if (request.method() === "GET" && path === "/settings/agents-md") {
      return json(route, 200, { content: userAgentsMd });
    }
    if (request.method() === "PUT" && path === "/settings/agents-md") {
      const body = request.postDataJSON() as { content?: string };
      if (typeof body.content !== "string") return json(route, 400, { error: "AGENTS.md 内容无效" });
      userAgentsMd = body.content.trim()
        ? body.content.endsWith("\n")
          ? body.content
          : `${body.content}\n`
        : "";
      return json(route, 200, { content: userAgentsMd });
    }
    if (request.method() === "GET" && path === "/personal-assistant/skills") {
      return json(route, 200, {
        skills: userSkills
          .filter((skill) => skill.enabled)
          .map(({ name, description }) => ({ name, description })),
      });
    }
    const agentSkills = path.match(/^\/agents\/([^/]+)\/skills$/);
    if (request.method() === "GET" && agentSkills) {
      const agentId = decodeURIComponent(agentSkills[1]);
      if (agentId === "weather") {
        return json(route, 200, {
          skills: [{ name: "check-weather", description: "查询城市天气" }],
        });
      }
      return json(route, 200, { skills: [] });
    }
    const agentApprovals = path.match(/^\/agents\/([^/]+)\/approvals$/);
    if (agentApprovals && (request.method() === "GET" || request.method() === "PUT")) {
      const empty = {
        command: "once",
        tools: [] as Array<{
          tool_name: string;
          kind: "mcp_server" | "mcp_tool";
          label: string;
          scope: string;
        }>,
        delegation: { anyone: "once", targets: [] as Array<{ agent_id: string; scope: string }> },
      };
      if (request.method() === "GET") return json(route, 200, empty);
      const body = request.postDataJSON() as {
        command?: string;
        tools?: Array<{ tool_name: string; scope: string }>;
        delegation?: { anyone?: string; targets?: Array<{ agent_id: string; scope: string }> };
      };
      return json(route, 200, {
        command: body.command ?? empty.command,
        tools: (body.tools ?? []).map((item) => ({
          tool_name: item.tool_name,
          kind:
            item.tool_name.startsWith("mcp__") && !item.tool_name.slice(5).includes("__")
              ? "mcp_server"
              : "mcp_tool",
          label: item.tool_name,
          scope: item.scope,
        })),
        delegation: {
          anyone: body.delegation?.anyone ?? "once",
          targets: (body.delegation?.targets ?? [])
            .filter((item) => item.scope !== "once")
            .map((item) => ({ agent_id: item.agent_id, scope: item.scope })),
        },
      });
    }
    if (request.method() === "GET" && path === "/personal-assistant/history") {
      return json(route, 200, { messages: histories["personal-assistant"] ?? [] });
    }
    if (request.method() === "GET" && path === "/personal-assistant/session/model") {
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    if (request.method() === "PUT" && path === "/personal-assistant/session/model-mode") {
      const body = request.postDataJSON() as { mode?: string };
      providerSettings = {
        ...providerSettings,
        model_mode: body.mode === "per_agent" ? "per_agent" : "unified",
      };
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    if (request.method() === "PUT" && path === "/personal-assistant/session/model") {
      const body = request.postDataJSON() as { template_id: string; model_id: string };
      providerSettings = {
        ...providerSettings,
        active_model: { template_id: body.template_id, model_id: body.model_id },
        configured: true,
      };
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    const agentSessionModel = path.match(/^\/agents\/([^/]+)\/session\/model$/);
    if (agentSessionModel && request.method() === "GET") {
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    if (path.match(/^\/agents\/([^/]+)\/session\/model-mode$/) && request.method() === "PUT") {
      const body = request.postDataJSON() as { mode?: string };
      providerSettings = {
        ...providerSettings,
        model_mode: body.mode === "per_agent" ? "per_agent" : "unified",
      };
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    if (agentSessionModel && request.method() === "PUT") {
      const body = request.postDataJSON() as { template_id: string; model_id: string };
      providerSettings = {
        ...providerSettings,
        active_model: { template_id: body.template_id, model_id: body.model_id },
        configured: true,
      };
      return json(route, 200, sessionModelPayload(providerSettings, options?.prompt === "follow-up" || options?.prompt === "follow-up-drain"));
    }
    const delegationHistory = path.match(
      /^\/personal-assistant\/delegations\/([^/]+)\/history$/,
    );
    if (request.method() === "GET" && delegationHistory) {
      const taskId = decodeURIComponent(delegationHistory[1]);
      const messages = delegationHistories[taskId] ?? [];
      return json(route, 200, {
        task: {
          id: taskId,
          status: "completed",
          to_agent_id: "weather",
          to_agent_name: "天气",
          brief: "查询当前天气情况",
          result_summary: "晴",
          error: null,
        },
        messages,
      });
    }
    const delegationStream = path.match(
      /^\/personal-assistant\/delegations\/([^/]+)\/stream$/,
    );
    if (request.method() === "GET" && delegationStream) {
      // 已完成任务：空流，客户端走 history
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-vercel-ai-ui-message-stream": "v1",
          "cache-control": "no-cache",
        },
        body: sse([{ type: "start", messageId: "empty" }, { type: "finish-step" }, { type: "finish" }]),
      });
    }
    if (request.method() === "DELETE" && path === "/personal-assistant/history") {
      delete histories["personal-assistant"];
      delete uiUnread["personal-assistant"];
      delete uiPreviews["personal-assistant"];
      delete uiLastActiveAt["personal-assistant"];
      return json(route, 200, { cleared: true });
    }
    if (request.method() === "POST" && path === "/personal-assistant/context") {
      const current = histories["personal-assistant"] ?? [];
      histories["personal-assistant"] = [
        ...current,
        {
          id: `context-reset-${Date.now()}`,
          role: "system",
          parts: [{ type: "text", text: "已开始新对话，之后不再带入此前上下文" }],
          metadata: { custom: { agentUpKind: "context-reset" } },
        },
      ];
      return json(route, 200, { cleared: true });
    }
    const history = path.match(/^\/agents\/([^/]+)\/history$/);
    if (request.method() === "GET" && history) {
      if (url.searchParams.get("user_id") !== "patient-a") return json(route, 200, { messages: [] });
      return json(route, 200, { messages: histories[history[1]] ?? [] });
    }
    if (request.method() === "DELETE" && history) {
      if (url.searchParams.get("user_id") !== "patient-a") return json(route, 400, { error: "请求无效" });
      const agentId = history[1];
      delete histories[agentId];
      delete uiUnread[agentId];
      delete uiPreviews[agentId];
      delete uiLastActiveAt[agentId];
      return json(route, 200, { cleared: true });
    }
    const context = path.match(/^\/agents\/([^/]+)\/context$/);
    if (request.method() === "POST" && context) {
      const agentId = context[1];
      const current = histories[agentId] ?? [];
      histories[agentId] = [
        ...current,
        {
          id: `context-reset-${Date.now()}`,
          role: "system",
          parts: [{ type: "text", text: "已开始新对话，之后不再带入此前上下文" }],
          metadata: { custom: { agentUpKind: "context-reset" } },
        },
      ];
      return json(route, 200, { cleared: true });
    }
    if (request.method() === "POST" && path === "/register") {
      const body = request.postDataJSON() as { email?: string };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "patient-b@example.com";
      // 故意不发真实邮件：e2e 只返回 pending，验证走 /auth/verify-email mock
      return json(route, 200, {
        email,
        status: "pending_verification",
      });
    }
    if (request.method() === "POST" && path === "/auth/resend-verification") {
      return json(route, 200, { ok: true });
    }
    if (request.method() === "POST" && path === "/auth/verify-email") {
      const body = request.postDataJSON() as { email?: string; code?: string };
      if (!body.code || !/^\d{6}$/.test(body.code)) {
        return json(route, 400, { error: "验证码无效或已过期" });
      }
      return json(route, 200, {
        user_id: "patient-b",
        email: typeof body.email === "string" ? body.email : "patient-b@example.com",
        nickname: "patient-b",
        token: "token-b",
        has_avatar: false,
        avatar_url: null,
      });
    }
    if (request.method() === "POST" && path === "/auth/forgot-password") {
      return json(route, 200, { ok: true });
    }
    if (request.method() === "POST" && path === "/auth/reset-password") {
      return json(route, 200, {
        user_id: "patient-a",
        email: "patient-a@example.com",
        nickname: "patient-a",
        token: "token-a",
        has_avatar: false,
        avatar_url: null,
      });
    }
    if (request.method() === "POST" && path.startsWith("/auth/oauth/") && path.endsWith("/authorize-url")) {
      return json(route, 200, { url: "https://example.com/oauth-mock" });
    }
    if (request.method() === "POST" && path === "/auth/oauth/exchange") {
      // Desktop Web/OAuth loopback 换票：与登录 mock 同一测试账号，避免全套 e2e 改昵称
      return json(route, 200, {
        user_id: "patient-a",
        email: "patient-a@example.com",
        nickname: "patient-a",
        token: "token-a",
        has_avatar: Boolean(accountAvatarUrl),
        avatar_url: accountAvatarUrl,
      });
    }
    if (request.method() === "POST" && path === "/auth/desktop/handoff") {
      return json(route, 200, { code: "desktop-bridge-mock" });
    }
    if (request.method() === "GET" && path === "/auth/turnstile") {
      return json(route, 200, { site_key: "", required: false });
    }
    if (request.method() === "POST" && path === "/login") {
      if (options?.loginError) return json(route, 401, { error: options.loginError });
      const body = request.postDataJSON() as { email?: string };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "patient-a@example.com";
      const nickname = email.split("@")[0] || "patient-a";
      return json(route, 200, {
        user_id: "patient-a",
        email,
        nickname,
        token: "token-a",
        has_avatar: Boolean(accountAvatarUrl),
        avatar_url: accountAvatarUrl,
      });
    }
    if (request.method() === "GET" && path === "/me") {
      // 冷启动续签头像：与 PUT /me 同形状，e2e 不模拟过期签名
      return json(route, 200, {
        user_id: "patient-a",
        email: "patient-a@example.com",
        nickname: "patient-a",
        token: "token-a",
        has_avatar: Boolean(accountAvatarUrl),
        avatar_url: accountAvatarUrl,
      });
    }
    if (request.method() === "GET" && path === "/local/account-avatar") {
      return json(route, 200, { avatar_url: accountAvatarUrl });
    }
    if (request.method() === "PUT" && path === "/me") {
      const body = request.postDataJSON() as { nickname?: string; avatar?: string };
      const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
      if (!nickname || nickname !== body.nickname) {
        return json(route, 400, { error: "昵称无效" });
      }
      if (typeof body.avatar === "string" && body.avatar.length > 0) {
        accountAvatarUrl = "http://127.0.0.1:8787/statics/users/patient-a/avatar.webp?v=1";
      }
      return json(route, 200, {
        user_id: "patient-a",
        email: "patient-a@example.com",
        nickname,
        token: "token-a",
        has_avatar: Boolean(accountAvatarUrl),
        avatar_url: accountAvatarUrl,
      });
    }
    if (request.method() === "POST" && path === "/local/migrate-user") {
      return json(route, 200, { migrated: true });
    }
    if (request.method() === "GET" && path === "/agents/public") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      return json(route, 200, {
        agents: agents
          .filter((agent) => {
            if (!q) return true;
            return (
              agent.name.toLowerCase().includes(q) ||
              agent.role.toLowerCase().includes(q) ||
              agent.background.toLowerCase().includes(q) ||
              agent.agent_id.toLowerCase().includes(q)
            );
          })
          .map((agent) => ({ ...agent, recruited: false, remark: "" })),
      });
    }
    if (request.method() === "GET" && path === "/agents") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const recruitedOnly = url.searchParams.get("recruited") === "true";
      return json(route, 200, {
        agents: agents.filter((agent) => {
          if (recruitedOnly && !agent.recruited) return false;
          if (!q) return true;
          return (
            agent.name.toLowerCase().includes(q) ||
            agent.role.toLowerCase().includes(q) ||
            agent.background.toLowerCase().includes(q) ||
            agent.agent_id.toLowerCase().includes(q)
          );
        }),
      });
    }
    if (request.method() === "GET" && path === "/agents/owned") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      return json(route, 200, {
        agents: agents.filter((agent) => {
          if (agent.agent_id !== "writer") return false;
          if (!q) return true;
          return (
            agent.name.toLowerCase().includes(q) ||
            agent.role.toLowerCase().includes(q) ||
            agent.background.toLowerCase().includes(q) ||
            agent.agent_id.toLowerCase().includes(q)
          );
        }),
      });
    }
    const recruit = path.match(/^\/agents\/([^/]+)\/recruit$/);
    if (request.method() === "POST" && recruit) {
      const agent = agents.find((item) => item.agent_id === recruit[1]);
      if (!agent) return json(route, 404, { error: "找不到 Agent" });
      // 模拟终身台账：同一用户首次招募才 +1
      if (!agent.recruited) agent.recruit_count += 1;
      agent.recruited = true;
      return json(route, 200, {
        user_id: "patient-a",
        agent_id: agent.agent_id,
        name: agent.name,
        latest_version: agent.latest_version,
        latest_digest: agent.latest_digest,
        remark: agent.remark,
      });
    }
    const remarkMatch = path.match(/^\/agents\/([^/]+)\/remark$/);
    if (request.method() === "PUT" && remarkMatch) {
      const agent = agents.find((item) => item.agent_id === remarkMatch[1]);
      if (!agent?.recruited) return json(route, 403, { error: "尚未招募" });
      const body = request.postDataJSON() as { remark?: string };
      agent.remark =
        typeof body.remark === "string" ? body.remark.trim().replace(/\s+/g, " ").slice(0, 40) : "";
      return json(route, 200, {
        user_id: "patient-a",
        agent_id: agent.agent_id,
        name: agent.name,
        latest_version: agent.latest_version,
        latest_digest: agent.latest_digest,
        remark: agent.remark,
      });
    }
    const dismiss = path.match(/^\/agents\/([^/]+)\/dismiss$/);
    if (request.method() === "POST" && dismiss) {
      const agent = agents.find((item) => item.agent_id === dismiss[1]);
      if (!agent?.recruited) return json(route, 403, { error: "尚未招募" });
      const agentId = dismiss[1];
      agent.recruited = false;
      agent.remark = "";
      agent.local_version = 0;
      delete histories[agentId];
      delete uiUnread[agentId];
      delete uiPreviews[agentId];
      delete uiLastActiveAt[agentId];
      return json(route, 200, { status: "ok" });
    }
    const deleteOwned = path.match(/^\/agents\/([^/]+)$/);
    if (request.method() === "DELETE" && deleteOwned) {
      const agentId = deleteOwned[1];
      const index = agents.findIndex((item) => item.agent_id === agentId);
      if (index < 0) return json(route, 404, { error: "找不到 Agent" });
      agents.splice(index, 1);
      delete histories[agentId];
      delete uiUnread[agentId];
      delete uiPreviews[agentId];
      delete uiLastActiveAt[agentId];
      return json(route, 200, { status: "ok" });
    }
    if (request.method() === "POST" && path === "/agents/inspect") {
      if (options?.inspectError) return json(route, 400, options.inspectError);
      return json(route, 200, { file_count: 2 });
    }
    if (request.method() === "POST" && path === "/agents/publish-editor/preview") {
      const body = request.postDataJSON() as { published_agent_id?: string };
      const agent = agents.find((item) => item.agent_id === body.published_agent_id);
      if (!agent) return json(route, 404, { error: "找不到要更新的 Agent" });
      return json(route, 200, {
        agent_id: agent.agent_id,
        name: agent.name,
        role: agent.role,
        background: agent.background,
        rules: "",
        skills: [],
        mcp_servers: {},
        avatar_url: agent.avatar_url,
      });
    }
    if (request.method() === "POST" && path === "/agents/publish-editor") {
      if (options?.inspectError) return json(route, 400, options.inspectError);
      if (options?.publishError) return json(route, 403, { error: options.publishError });
      const body = request.postDataJSON() as {
        name: string;
        role?: string;
        background: string;
        agent_id?: string;
        rules?: string;
      };
      return json(route, 200, upsertPublishedWriter(body));
    }
    if (request.method() === "POST" && path === "/agents/publish") {
      if (options?.publishError) return json(route, 403, { error: options.publishError });
      const body = request.postDataJSON() as {
        name: string;
        role?: string;
        background: string;
        agent_id?: string;
        rules?: string;
      };
      return json(route, 200, upsertPublishedWriter(body));
    }
    const cardUpdate = path.match(/^\/agents\/([^/]+)\/card$/);
    if (request.method() === "PUT" && cardUpdate) {
      const agent = agents.find((item) => item.agent_id === cardUpdate[1]);
      if (!agent) return json(route, 404, { error: "找不到这个 Agent" });
      const body = request.postDataJSON() as {
        name: string;
        role?: string;
        background: string;
        rules?: string;
        avatar_data_url?: string;
      };
      agent.name = body.name;
      agent.role = body.role ?? "";
      agent.background = body.background;
      if (typeof body.avatar_data_url === "string" && body.avatar_data_url.length > 0) {
        agent.has_avatar = true;
        agent.avatar_url = body.avatar_data_url;
      }
      return json(route, 200, agent);
    }
    if (request.method() === "POST" && path === "/agents/local/from-published") {
      const body = request.postDataJSON() as { published_agent_id?: string };
      const published = agents.find((item) => item.agent_id === body.published_agent_id);
      if (!published) return json(route, 404, { error: "找不到已发布 Agent" });
      localSeq += 1;
      const created: LocalAgentRecord = {
        agent_id: `loc-writer${localSeq}`,
        name: published.name,
        role: published.role,
        background: published.background,
        rules: "",
        skills: [],
        mcp_servers: {},
        published_agent_id: published.agent_id,
        latest_version: published.latest_version,
        latest_digest: published.latest_digest,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        avatar_url: published.avatar_url,
      };
      localAgents.push(created);
      return json(route, 200, localCard(created));
    }
    if (request.method() === "GET" && path === "/agents/local") {
      return json(route, 200, { agents: localAgents.map(localCard) });
    }
    if (request.method() === "POST" && path === "/agents/local") {
      const body = request.postDataJSON() as {
        name: string;
        role?: string;
        background: string;
        rules?: string;
        skill_paths?: string[];
        mcp_servers?: Record<string, unknown>;
        avatar_data_url?: string;
      };
      localSeq += 1;
      const created: LocalAgentRecord = {
        agent_id: `loc-writer${localSeq}`,
        name: body.name,
        role: body.role ?? "",
        background: body.background,
        rules: typeof body.rules === "string" ? body.rules : "",
        skills: Array.isArray(body.skill_paths)
          ? body.skill_paths.map((item) => item.split("/").pop() || item)
          : [],
        mcp_servers: body.mcp_servers && typeof body.mcp_servers === "object" ? body.mcp_servers : {},
        published_agent_id: null,
        latest_version: 1,
        latest_digest: `local-digest-${localSeq}`,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        avatar_url:
          typeof body.avatar_data_url === "string" && body.avatar_data_url.length > 0
            ? body.avatar_data_url
            : FAKE_AVATAR,
      };
      localAgents.push(created);
      return json(route, 200, localCard(created));
    }
    const localOne = path.match(/^\/agents\/local\/([^/]+)$/);
    if (localOne) {
      const agent = localAgents.find((item) => item.agent_id === localOne[1]);
      if (!agent) return json(route, 404, { error: "找不到本机 Agent" });
      if (request.method() === "GET") return json(route, 200, localCard(agent));
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as {
          name: string;
          role?: string;
          background: string;
          rules?: string;
          skill_paths?: string[];
          remove_skills?: string[];
          mcp_servers?: Record<string, unknown>;
          avatar_data_url?: string;
        };
        agent.name = body.name;
        agent.role = body.role ?? "";
        agent.background = body.background;
        if (typeof body.rules === "string") agent.rules = body.rules;
        if (typeof body.avatar_data_url === "string" && body.avatar_data_url.length > 0) {
          agent.avatar_url = body.avatar_data_url;
        }
        if (Array.isArray(body.remove_skills)) {
          agent.skills = agent.skills.filter((name) => !body.remove_skills!.includes(name));
        }
        if (Array.isArray(body.skill_paths)) {
          for (const skillPath of body.skill_paths) {
            const label = skillPath.split("/").pop() || skillPath;
            if (!agent.skills.includes(label)) agent.skills.push(label);
          }
        }
        if (body.mcp_servers && typeof body.mcp_servers === "object") {
          agent.mcp_servers = body.mcp_servers;
        }
        agent.updated_at = "2026-02-02T00:00:00Z";
        return json(route, 200, localCard(agent));
      }
      if (request.method() === "DELETE") {
        const index = localAgents.findIndex((item) => item.agent_id === localOne[1]);
        if (index >= 0) localAgents.splice(index, 1);
        return json(route, 200, { status: "ok" });
      }
    }
    const localBind = path.match(/^\/agents\/local\/([^/]+)\/published$/);
    if (request.method() === "PUT" && localBind) {
      const agent = localAgents.find((item) => item.agent_id === localBind[1]);
      if (!agent) return json(route, 404, { error: "找不到本机 Agent" });
      const body = request.postDataJSON() as { published_agent_id: string };
      agent.published_agent_id = body.published_agent_id;
      return json(route, 200, localCard(agent));
    }
    const directory = path.match(/^\/agents\/([^/]+)\/directory$/);
    if (request.method() === "POST" && directory) {
      const agentId = directory[1]!;
      if (agentId.startsWith("loc-")) {
        const local = localAgents.find((item) => item.agent_id === agentId);
        if (!local) return json(route, 404, { error: "找不到本机 Agent" });
        return json(route, 200, { path: `/tmp/agentup/users/patient-a/agents/${agentId}` });
      }
      const agent = agents.find((item) => item.agent_id === agentId);
      if (!agent?.recruited) return json(route, 403, { error: "尚未招募" });
      return json(route, 200, { path: `/tmp/agentup/users/patient-a/agents/${agent.agent_id}` });
    }
    const sync = path.match(/^\/agents\/([^/]+)\/sync$/);
    if (request.method() === "POST" && sync) {
      const agent = agents.find((item) => item.agent_id === sync[1]);
      if (!agent?.recruited) return json(route, 403, { error: "尚未招募" });
      agent.local_version = agent.latest_version;
      return json(route, 200, {
        user_id: "patient-a",
        agent_id: agent.agent_id,
        package_version: agent.latest_version,
        package_digest: agent.latest_digest,
      });
    }
    // ── followUp 队列 mock（本地 Agent App 接入，见 .cursor/skills/agentup-sdk-adapter/references/follow-up.md） ──
    if (path === "/follow-ups") {
      if (request.method() === "GET") return json(route, 200, { queue: followUpQueue });
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { text?: string };
        const item = makeFollowUp(typeof body.text === "string" ? body.text : "");
        followUpQueue.push(item);
        return json(route, 202, { queued: item, queue: followUpQueue });
      }
      if (request.method() === "DELETE") {
        const cleared = followUpQueue.length;
        followUpQueue = [];
        return json(route, 200, { cleared });
      }
    }
    const followUpItem = path.match(/^\/follow-ups\/([^/]+)(?:\/promote)?$/);
    if (followUpItem) {
      const id = decodeURIComponent(followUpItem[1]!);
      if (path.endsWith("/promote") && request.method() === "POST") {
        const at = followUpQueue.findIndex((item) => item.id === id);
        if (at > 0) {
          const [row] = followUpQueue.splice(at, 1);
          followUpQueue.unshift(row!);
        }
        return json(route, 200, { queue: followUpQueue });
      }
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { text?: string };
        const row = followUpQueue.find((item) => item.id === id);
        if (row && typeof body.text === "string" && body.text.trim()) row.text = body.text.trim();
        return json(route, 200, { queue: followUpQueue });
      }
      if (request.method() === "DELETE") {
        followUpQueue = followUpQueue.filter((item) => item.id !== id);
        return json(route, 200, { queue: followUpQueue });
      }
    }

    // 队列被消费的那一轮：桌面连 /turn-stream 看直播（.cursor/skills/agentup-sdk-adapter/references/follow-up.md）。
    // runtime 的顺序是先 echo 拼好的用户那条，再出助手正文——错的那个版本反过来。
    if (request.method() === "GET" && path === "/turn-stream") {
      if (options?.prompt !== "follow-up-drain") return json(route, 404, { error: "本场景没有旁路流" });
      const turnAgentId = url.searchParams.get("agent_id") ?? "";
      // 已播过：回放同一份（首轮常被 reload / wake 抖动掐断）。次数用尽再挂住。
      if (drainedEcho !== null) {
        if (drainReplayCount >= 8) return holdTurnStream(route);
        drainReplayCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return fulfillDrain(route, turnAgentId);
      }
      // 等第一轮收完、队列里真有东西，再发消费轮
      const deadline = Date.now() + 15_000;
      while (!(firstDrainTurnServed && followUpQueue.length > 0) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (drainedEcho !== null) {
        if (drainReplayCount >= 8) return holdTurnStream(route);
        drainReplayCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return fulfillDrain(route, turnAgentId);
      }
      return fulfillDrain(route, turnAgentId);
    }

    // 插话：API / Pi 原生接入走 runtime 的 Pi 原生 steer（.cursor/skills/agentup-sdk-adapter/references/follow-up.md）。
    // `interruptible-fallback` 场景 = runtime 没接住（会话没在跑等）→ 退回停止后重发。
    const steerMatch = path.match(/^\/agents\/([^/]+)\/steer$/);
    if (steerMatch && request.method() === "POST") {
      return json(route, 200, { steered: options?.prompt !== "interruptible-fallback" });
    }

    const promptMatch =
      path === "/personal-assistant/prompt"
        ? ["", "personal-assistant"]
        : path.match(/^\/agents\/([^/]+)\/prompt$/);
    if (request.method() === "POST" && promptMatch) {
      if (options?.prompt === "missing-model") return json(route, 503, { error: "打开会话前请先在设置中配置本地模型" });
      // 第一轮挂起（保持 busy）；之后的 prompt 一律 202 入队，模拟 SDK 接入没有 steer。
      // `follow-up-drain` 挂 2.5s：够塞队列；消费轮靠下方 pulse 标 busy，勿再等 12s 空闲拍。
      if (options?.prompt === "follow-up" || options?.prompt === "follow-up-drain") {
        followUpPrompts += 1;
        if (followUpPrompts === 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, options?.prompt === "follow-up-drain" ? 2_500 : 20_000),
          );
          try {
            return await route.fulfill({
              status: 200,
              headers: {
                "content-type": "text/event-stream; charset=utf-8",
                "x-vercel-ai-ui-message-stream": "v1",
                "cache-control": "no-cache",
              },
              body: sse([
                { type: "start", messageId: "follow-up-old" },
                { type: "start-step" },
                { type: "text-start", id: "follow-up-old-text" },
                { type: "text-delta", id: "follow-up-old-text", delta: "旧回复" },
                { type: "text-end", id: "follow-up-old-text" },
                { type: "finish-step" },
                { type: "finish" },
              ]),
            });
          } catch {
            return;
          } finally {
            firstDrainTurnServed = true;
          }
        }
        const body = request.postDataJSON() as { text?: string } | null;
        const item = makeFollowUp(typeof body?.text === "string" ? body.text : "");
        followUpQueue.push(item);
        return json(route, 202, { queued: item, queue: followUpQueue });
      }
      // 模拟长回复：先挂起再吐完整 SSE，便于测切走再接回。
      if (options?.prompt === "slow-stream") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      // 第一轮挂起，直到客户端中止或下一轮 prompt 到来；第二轮立刻返回新助手正文。
      // `interruptible-fallback` 同样挂起第一轮，只是 /steer 会回 false（见上）
      if (options?.prompt === "interruptible" || options?.prompt === "interruptible-fallback") {
        interruptiblePrompts += 1;
        if (interruptiblePrompts === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstInterrupt = resolve;
            setTimeout(resolve, 30_000);
          });
          try {
            return await route.fulfill({
              status: 200,
              headers: {
                "content-type": "text/event-stream; charset=utf-8",
                "x-vercel-ai-ui-message-stream": "v1",
                "cache-control": "no-cache",
              },
              body: sse([
                { type: "start", messageId: "interrupt-old" },
                { type: "start-step" },
                { type: "text-start", id: "interrupt-old-text" },
                { type: "text-delta", id: "interrupt-old-text", delta: "旧回复" },
                { type: "text-end", id: "interrupt-old-text" },
                { type: "finish-step" },
                { type: "finish" },
              ]),
            });
          } catch {
            return;
          }
        }
        releaseFirstInterrupt?.();
        return route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "x-vercel-ai-ui-message-stream": "v1",
            "cache-control": "no-cache",
          },
          body: sse([
            { type: "start", messageId: `interrupt-new-${interruptiblePrompts}` },
            { type: "start-step" },
            { type: "text-start", id: "interrupt-new-text" },
            { type: "text-delta", id: "interrupt-new-text", delta: "新回复" },
            { type: "text-end", id: "interrupt-new-text" },
            { type: "finish-step" },
            { type: "finish" },
          ]),
        });
      }
      const agentId = decodeURIComponent(promptMatch[1]);
      const turn = `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const approvalId = `approval-${agentId}`;
      const askUserId = `ask-user-${agentId}`;
      const chunks =
        options?.prompt === "approval"
          ? [
              { type: "start", messageId: `${turn}-assistant` },
              { type: "start-step" },
              {
                type: "tool-input-available",
                toolCallId: `${turn}-call`,
                toolName: "bash",
                input: { command: "node weather.mjs" },
                dynamic: true,
              },
              {
                type: "data-agentup-approval",
                data: {
                  id: approvalId,
                  toolCallId: `${turn}-call`,
                  toolName: "bash",
                  args: { command: "node weather.mjs" },
                },
                transient: true,
              },
              { type: "finish-step" },
              { type: "finish" },
            ]
          : options?.prompt === "ask-user" || options?.prompt === "ask-user-multi"
            ? [
                ...askUserChunks(turn, askUserId, options.prompt === "ask-user-multi"),
                { type: "finish-step" },
                { type: "finish" },
              ]
            : options?.prompt === "sdk-process"
              ? sdkProcessChunks(turn)
              : [
                  { type: "start", messageId: `${turn}-assistant` },
                  { type: "start-step" },
                  { type: "reasoning-start", id: `${turn}-reasoning` },
                  { type: "reasoning-delta", id: `${turn}-reasoning`, delta: "先看" },
                  { type: "reasoning-end", id: `${turn}-reasoning` },
                  { type: "text-start", id: `${turn}-text` },
                  { type: "text-delta", id: `${turn}-text`, delta: "你好" },
                  { type: "text-end", id: `${turn}-text` },
                  {
                    type: "tool-input-start",
                    toolCallId: `${turn}-call`,
                    toolName: "read",
                    dynamic: true,
                  },
                  {
                    type: "tool-input-delta",
                    toolCallId: `${turn}-call`,
                    inputTextDelta: '{"path":"note"}',
                  },
                  {
                    type: "tool-input-available",
                    toolCallId: `${turn}-call`,
                    toolName: "read",
                    input: { path: "note" },
                    dynamic: true,
                  },
                  {
                    type: "tool-output-available",
                    toolCallId: `${turn}-call`,
                    output: "病历",
                    dynamic: true,
                    preliminary: true,
                  },
                  {
                    type: "tool-output-available",
                    toolCallId: `${turn}-call`,
                    output: "病历",
                    dynamic: true,
                  },
                  { type: "finish-step" },
                  { type: "finish" },
                ];
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "x-vercel-ai-ui-message-stream": "v1",
          "cache-control": "no-cache",
        },
        body: sse(chunks),
      });
    }
    if (request.method() === "POST" && /^\/approvals\/[^/]+$/.test(path)) {
      return json(route, 200, { decided: true });
    }
    if (request.method() === "POST" && /^\/ask-user\/[^/]+$/.test(path)) {
      return json(route, 200, { answered: true });
    }
    // 桌面合并脉冲：attention + fleets + 本机群；e2e 默认空快照即可。
    if (request.method() === "GET" && path === "/desktop-pulse") {
      // 消费轮是 wake 回合：桌面据此连 /turn-stream 直播（第一轮跑完且队列有货才开始）
      const drainTurn =
        options?.prompt === "follow-up-drain" &&
        firstDrainTurnServed &&
        (drainWake || followUpQueue.length > 0);
      if (drainTurn) drainWake = true;
      const recruitedIds = agents.filter((item) => item.recruited).map((item) => item.agent_id);
      // drain 场景整段标 busy：否则空闲 12s 一拍，消费轮要干等下一拍才启动（这两条曾各 ~22s）
      const drainScenarioBusy = options?.prompt === "follow-up-drain";
      const wakeTurns = drainTurn
        ? recruitedIds.map((agentId) => ({
            agent_id: agentId,
            phase: "wake",
            sources: [],
          }))
        : drainScenarioBusy
          ? recruitedIds.map((agentId) => ({
              agent_id: agentId,
              phase: "prompt",
              sources: [],
            }))
          : [];
      return json(route, 200, {
        attention: {
          busy_agent_ids: drainScenarioBusy ? recruitedIds : [],
          busy_turns: wakeTurns,
          approvals: [],
          ask_users: [],
          shell_hangs: [],
        },
        delegations: { running: [], unseen: [] },
        background_jobs: { running: [], unseen: [] },
        // 侧栏群列表真正吃的是桌面 pulse（显式 GET /groups 的结果会被 pulse 覆盖）
        groups: groupRooms,
      });
    }
    const workspaceHit = matchWorkspace(path);
    if (workspaceHit) {
      const key = workspaceHit.personal ? "personal" : workspaceHit.agentId;
      if (!workspaceHit.personal) {
        const agent = agents.find((item) => item.agent_id === workspaceHit.agentId);
        if (!agent?.recruited) return json(route, 404, { error: "工作目录不存在" });
      }
      const body =
        request.method() === "GET" || request.method() === "DELETE" ? {} : request.postDataJSON();
      return handleWorkspace(route, request.method(), workspaceHit.action, workspaces, key, url, body);
    }
    return json(route, 404, { error: "没有这个接口" });
  });
}

function askUserChunks(turn: string, askUserId: string, multi: boolean): unknown[] {
  const questions = multi
    ? [
        {
          question: "用哪个数据库？",
          context: "单区服务",
          options: [
            { title: "Postgres", description: "托管" },
            { title: "SQLite", description: "无额外基建" },
          ],
          allowMultiple: false,
        },
        {
          question: "需要哪些能力？",
          options: [{ title: "搜索" }, { title: "写文件" }, { title: "联网" }],
          allowMultiple: true,
        },
      ]
    : [
        {
          question: "用哪个数据库？",
          context: "单区服务",
          options: [
            { title: "Postgres", description: "托管" },
            { title: "SQLite", description: "无额外基建" },
          ],
          allowMultiple: false,
        },
      ];
  const toolCallId = `${turn}-call`;
  const inputJson = JSON.stringify({ questions });
  return [
    { type: "start", messageId: `${turn}-assistant` },
    { type: "start-step" },
    {
      type: "tool-input-start",
      toolCallId,
      toolName: "ask_user",
      dynamic: true,
    },
    {
      type: "tool-input-delta",
      toolCallId,
      inputTextDelta: inputJson.slice(0, Math.max(24, Math.floor(inputJson.length / 2))),
    },
    {
      type: "tool-input-delta",
      toolCallId,
      inputTextDelta: inputJson.slice(Math.max(24, Math.floor(inputJson.length / 2))),
    },
    {
      type: "tool-input-available",
      toolCallId,
      toolName: "ask_user",
      input: { questions },
      dynamic: true,
    },
    {
      type: "data-agentup-ask-user",
      data: {
        id: askUserId,
        toolCallId,
        questions,
      },
      transient: true,
    },
  ];
}

/** 模拟外部 SDK 回合：工具间旁白 + ToolSearch/DeferExecute 形参数（桌面 GenericTool 摘要）。 */
function sdkProcessChunks(turn: string): object[] {
  // 模拟 translator 解包后的投影：无 ToolSearch / DeferExecute 壳，直接 AgentUp MCP
  const searchId = `${turn}-agent-search`;
  const delegateId = `${turn}-delegate`;
  return [
    { type: "start", messageId: `${turn}-assistant` },
    { type: "start-step" },
    { type: "text-start", id: `${turn}-text-1` },
    { type: "text-delta", id: `${turn}-text-1`, delta: "先搜一下专家花名册。" },
    { type: "text-end", id: `${turn}-text-1` },
    {
      type: "tool-input-available",
      toolCallId: searchId,
      toolName: "mcp__agentup__agent_search",
      input: { query: "weather 天气 气象" },
      dynamic: true,
    },
    {
      type: "tool-output-available",
      toolCallId: searchId,
      output: "Weaty (气象员)",
      dynamic: true,
    },
    { type: "text-start", id: `${turn}-text-2` },
    { type: "text-delta", id: `${turn}-text-2`, delta: "接下来委托气象员。" },
    { type: "text-end", id: `${turn}-text-2` },
    {
      type: "tool-input-available",
      toolCallId: delegateId,
      toolName: "mcp__agentup__delegate_to_agent",
      input: { agent_id: "weather", brief: "查今天天气" },
      dynamic: true,
    },
    {
      type: "data-agentup-delegation-started",
      data: {
        taskId: "task-sdk-1",
        toolCallId: delegateId,
        toAgentId: "weather",
        toAgentName: "Weaty",
        brief: "查今天天气",
        wait: false,
      },
    },
    {
      type: "tool-output-available",
      toolCallId: delegateId,
      output:
        "Delegation completed.\ntask_id: task-sdk-1\nagent: Weaty (weather)\nresult:\n阴转小雨",
      dynamic: true,
    },
    { type: "text-start", id: `${turn}-text-3` },
    { type: "text-delta", id: `${turn}-text-3`, delta: "已找到 Weaty。" },
    { type: "text-end", id: `${turn}-text-3` },
    {
      type: "data-agentup-summary",
      data: { textPartIndex: 2 },
    },
    { type: "finish-step" },
    { type: "finish" },
  ];
}

function makeFollowUp(text: string): { id: string; text: string; created_at: number } {
  return { id: `fu-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, created_at: Date.now() };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

type WorkspaceNode =
  | { kind: "dir"; children: Record<string, WorkspaceNode> }
  | { kind: "file"; text: string };

function matchWorkspace(pathname: string): { personal: boolean; agentId: string; action?: string } | undefined {
  const personal = pathname.match(/^\/personal-assistant\/workspace(?:\/(file|rename|absolute))?$/);
  if (personal) return { personal: true, agentId: "", action: personal[1] };
  const agent = pathname.match(/^\/agents\/([^/]+)\/workspace(?:\/(file|rename|absolute))?$/);
  if (!agent) return undefined;
  return { personal: false, agentId: decodeURIComponent(agent[1] ?? ""), action: agent[2] };
}

function seedWorkspace(): WorkspaceNode {
  return {
    kind: "dir",
    children: {
      ".pi": { kind: "dir", children: { "SYSTEM.md": { kind: "file", text: "hidden" } } },
      WORK: { kind: "dir", children: { "scratch.ts": { kind: "file", text: "temp" } } },
      ATTACHMENTS: { kind: "dir", children: {} },
      ARTIFACT: {
        kind: "dir",
        children: {
          "note.txt": { kind: "file", text: "门诊记录" },
          reports: { kind: "dir", children: {} },
        },
      },
    },
  };
}

function workspaceTree(trees: Map<string, WorkspaceNode>, key: string): WorkspaceNode {
  const existing = trees.get(key);
  if (existing) return existing;
  const created = seedWorkspace();
  trees.set(key, created);
  return created;
}

function splitWorkspacePath(relative: string): string[] | null {
  if (relative.includes("\\") || relative.startsWith("/") || relative.includes("\0")) return null;
  const parts = relative.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) return null;
  if (parts[0] === ".pi" || parts[0] === "WORK") return null;
  return parts;
}

function workspaceNode(root: WorkspaceNode, parts: string[]): WorkspaceNode | undefined {
  let current = root;
  for (const part of parts) {
    if (current.kind !== "dir") return undefined;
    const next = current.children[part];
    if (!next) return undefined;
    current = next;
  }
  return current;
}

function handleWorkspace(
  route: Route,
  method: string,
  action: string | undefined,
  trees: Map<string, WorkspaceNode>,
  key: string,
  url: URL,
  body: unknown,
): Promise<void> {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const relative =
    method === "GET" || method === "DELETE"
      ? (url.searchParams.get("path") ?? "")
      : typeof record.path === "string"
        ? record.path
        : null;
  if (relative === null) return json(route, 400, { error: "路径无效" });
  const parts = splitWorkspacePath(relative);
  if (!parts) return json(route, 400, { error: "路径无效" });
  const root = workspaceTree(trees, key);
  if (!action && method === "GET") {
    const node = workspaceNode(root, parts);
    if (!node || node.kind !== "dir") return json(route, 404, { error: "找不到文件" });
    const entries = Object.entries(node.children)
      .filter(([name]) => !(parts.length === 0 && (name === ".pi" || name === "WORK")))
      .map(([name, child]) => ({
        name,
        kind: child.kind === "dir" ? "dir" : "file",
        size: child.kind === "file" ? Buffer.byteLength(child.text) : 0,
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
        return left.name.localeCompare(right.name, "zh");
      });
    return json(route, 200, { path: parts.join("/"), entries });
  }
  if (!action && method === "POST") {
    if (record.kind !== "file" && record.kind !== "dir") return json(route, 400, { error: "请求无效" });
    if (parts.length === 0) return json(route, 400, { error: "名称无效" });
    const parent = workspaceNode(root, parts.slice(0, -1));
    const name = parts[parts.length - 1] ?? "";
    if (!parent || parent.kind !== "dir") return json(route, 404, { error: "找不到文件" });
    if (parent.children[name]) return json(route, 409, { error: "已经存在" });
    parent.children[name] =
      record.kind === "dir" ? { kind: "dir", children: {} } : { kind: "file", text: "" };
    return json(route, 200, { path: parts.join("/") });
  }
  if (!action && method === "DELETE") {
    if (parts.length === 0) return json(route, 400, { error: "不能删除工作目录" });
    const parent = workspaceNode(root, parts.slice(0, -1));
    const name = parts[parts.length - 1] ?? "";
    if (!parent || parent.kind !== "dir" || !parent.children[name]) return json(route, 404, { error: "找不到文件" });
    delete parent.children[name];
    return json(route, 200, { deleted: true });
  }
  if (action === "file" && method === "GET") {
    const node = workspaceNode(root, parts);
    if (!node || node.kind !== "file") return json(route, 404, { error: "找不到文件" });
    return json(route, 200, {
      path: parts.join("/"),
      kind: "text",
      size: Buffer.byteLength(node.text),
      text: node.text,
    });
  }
  if (action === "file" && method === "PUT") {
    if (typeof record.text !== "string") return json(route, 400, { error: "请求无效" });
    const node = workspaceNode(root, parts);
    if (!node || node.kind !== "file") return json(route, 404, { error: "找不到文件" });
    node.text = record.text;
    return json(route, 200, { path: parts.join("/"), size: Buffer.byteLength(record.text) });
  }
  if (action === "rename" && method === "POST") {
    if (typeof record.name !== "string" || !record.name.trim()) return json(route, 400, { error: "名称无效" });
    if (parts.length === 0) return json(route, 404, { error: "找不到文件" });
    const parent = workspaceNode(root, parts.slice(0, -1));
    const name = parts[parts.length - 1] ?? "";
    const nextName = record.name.trim();
    if (!parent || parent.kind !== "dir" || !parent.children[name]) return json(route, 404, { error: "找不到文件" });
    if (parts.length === 1 && nextName === ".pi") return json(route, 400, { error: "名称无效" });
    if (parent.children[nextName] && nextName !== name) return json(route, 409, { error: "已经存在" });
    const node = parent.children[name];
    if (!node) return json(route, 404, { error: "找不到文件" });
    delete parent.children[name];
    parent.children[nextName] = node;
    const nextParts = [...parts.slice(0, -1), nextName];
    return json(route, 200, { path: nextParts.join("/") });
  }
  if (action === "absolute" && method === "GET") {
    const node = workspaceNode(root, parts);
    if (!node) return json(route, 404, { error: "找不到文件" });
    const prefix =
      key === "personal"
        ? "/tmp/agentup/users/patient-a/personal-assistant/cwd"
        : `/tmp/agentup/users/patient-a/agents/${key}/cwd`;
    return json(route, 200, { path: parts.length ? `${prefix}/${parts.join("/")}` : prefix });
  }
  return json(route, 404, { error: "没有这个接口" });
}
