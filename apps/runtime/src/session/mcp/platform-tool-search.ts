import {
  createToolSearchExtension,
  type AgentSession,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

/** 平台 Browser Use / Playwright / Computer Use MCP 工具名前缀。 */
export const PLATFORM_BROWSER_MCP_PREFIX = "mcp__browser__";
export const PLATFORM_PLAYWRIGHT_MCP_PREFIX = "mcp__playwright__";
export const PLATFORM_COMPUTER_MCP_PREFIX = "mcp__computer__";

const PLATFORM_PREFIXES = [
  PLATFORM_BROWSER_MCP_PREFIX,
  PLATFORM_PLAYWRIGHT_MCP_PREFIX,
  PLATFORM_COMPUTER_MCP_PREFIX,
] as const;

export type PlatformMcpPrefix = (typeof PLATFORM_PREFIXES)[number];

/** 会话内钉住的平台套件：一旦用过，跨回合保持可执行，避免关窗后 not found → 误用 playwright。 */
export type PlatformPinState = {
  pinned: Set<PlatformMcpPrefix>;
  lastSearchQuery: string;
};

export function createPlatformPinState(): PlatformPinState {
  return { pinned: new Set(), lastSearchQuery: "" };
}

/** 若是平台 browser / playwright / computer MCP 工具，返回其前缀。 */
export function platformMcpPrefix(toolName: string): PlatformMcpPrefix | undefined {
  for (const prefix of PLATFORM_PREFIXES) {
    if (toolName.startsWith(prefix)) return prefix;
  }
  return undefined;
}

/**
 * A：`tool_search`（或其它 setActive）已点到任一平台 browser/playwright 工具时，
 * 把同前缀已注册工具一次装齐，避免下回合再搜 click/type。
 */
export function expandPlatformMcpSuites(activeToolNames: string[], allToolNames: string[]): string[] {
  const prefixes = new Set<PlatformMcpPrefix>();
  for (const name of activeToolNames) {
    const prefix = platformMcpPrefix(name);
    if (prefix) prefixes.add(prefix);
  }
  if (prefixes.size === 0) return activeToolNames;
  const extra = allToolNames.filter((name) => {
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return true;
    }
    return false;
  });
  return [...new Set([...activeToolNames, ...extra])];
}

/**
 * 外站登录态优先 browser：普通 browser 搜索不要只激活 playwright。
 * 显式 playwright / preview / headless / localhost 仍走 playwright。
 */
export function preferBrowserSuite(
  query: string,
  toolNames: string[],
  allToolNames: string[],
  pinned: ReadonlySet<PlatformMcpPrefix>,
): string[] {
  const browserAll = allToolNames.filter((name) => name.startsWith(PLATFORM_BROWSER_MCP_PREFIX));
  const playwrightAll = allToolNames.filter((name) => name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX));
  const wantsPlaywright = queryWantsPlaywright(query);
  const wantsBrowser = queryWantsBrowser(query) || pinned.has(PLATFORM_BROWSER_MCP_PREFIX);
  // 明确桌面 computer：不要把 BM25 误命中的 playwright 拐成 headed browser
  const wantsComputerOnly = queryWantsComputer(query) && !wantsBrowser && !wantsPlaywright;

  // 已钉住 browser：除非本次明确要 playwright，否则丢掉 playwright、保 browser 整套
  if (
    pinned.has(PLATFORM_BROWSER_MCP_PREFIX) &&
    browserAll.length > 0 &&
    !wantsPlaywright &&
    !wantsComputerOnly
  ) {
    return [
      ...new Set([
        ...toolNames.filter((name) => !name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX)),
        ...browserAll,
      ]),
    ];
  }

  // 明确只要 playwright
  if (wantsPlaywright && !wantsBrowser) {
    if (playwrightAll.length === 0) return toolNames;
    return [
      ...new Set([
        ...toolNames.filter((name) => !name.startsWith(PLATFORM_BROWSER_MCP_PREFIX)),
        ...playwrightAll,
      ]),
    ];
  }

  // 模糊 / 偏 browser：有 browser 工具时，不要只装 playwright（computer 查询除外）
  const activatingPw = toolNames.some((name) => name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX));
  const activatingBr = toolNames.some((name) => name.startsWith(PLATFORM_BROWSER_MCP_PREFIX));
  if (
    browserAll.length > 0 &&
    activatingPw &&
    !activatingBr &&
    !wantsPlaywright &&
    !wantsComputerOnly
  ) {
    return [
      ...new Set([
        ...toolNames.filter((name) => !name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX)),
        ...browserAll,
      ]),
    ];
  }

  // 钉住或命中 browser 时补齐整套
  if (wantsBrowser && browserAll.length > 0) {
    return [...new Set([...toolNames, ...browserAll])];
  }

  return toolNames;
}

export function queryWantsPlaywright(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /\bplaywright\b/.test(q) ||
    /\bheadless\b/.test(q) ||
    /\bpreview_url\b/.test(q) ||
    /\blocalhost\b/.test(q) ||
    /\b127\.0\.0\.1\b/.test(q)
  );
}

export function queryWantsBrowser(query: string): boolean {
  const q = query.toLowerCase();
  // 裸 "browser" 或中文登录态场景；排除已明确 playwright 的由 prefer 分支处理
  return (
    /\bbrowser\b/.test(q) ||
    /browser_use/.test(q) ||
    /headed/.test(q) ||
    /登录/.test(query) ||
    /外站/.test(query)
  );
}

/** 本机桌面 / 原生 App（非网页）场景。 */
export function queryWantsComputer(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /\bcomputer\b/.test(q) ||
    /computer_use/.test(q) ||
    /computer-use/.test(q) ||
    /\bdesktop\b/.test(q) ||
    /accessibility/.test(q) ||
    /桌面/.test(query) ||
    /本机应用/.test(query) ||
    /系统设置/.test(query)
  );
}

/**
 * 桌面 Computer Use：搜到或钉住时补齐 `mcp__computer__*`，不与 browser 互斥。
 */
export function preferComputerSuite(
  query: string,
  toolNames: string[],
  allToolNames: string[],
  pinned: ReadonlySet<PlatformMcpPrefix>,
): string[] {
  const computerAll = allToolNames.filter((name) => name.startsWith(PLATFORM_COMPUTER_MCP_PREFIX));
  if (computerAll.length === 0) return toolNames;
  const wants =
    queryWantsComputer(query) ||
    pinned.has(PLATFORM_COMPUTER_MCP_PREFIX) ||
    toolNames.some((name) => name.startsWith(PLATFORM_COMPUTER_MCP_PREFIX));
  if (!wants) return toolNames;
  return [...new Set([...toolNames, ...computerAll])];
}

type NamedTool = { name: string };

/**
 * B：Pi 的 createContextSnapshot 只切片 `agent.state.tools`（已声明集），
 * deferred 虽在会话里可调，同回合直接点名仍会 not found。
 * 把平台 deferred 可执行实例并进 snapshot.tools，让历史里见过的名字可立刻跑。
 */
export function mergePlatformDeferredCallables<T extends NamedTool>(
  declared: readonly T[],
  callables: readonly T[],
): T[] {
  const byName = new Map<string, T>();
  for (const tool of declared) byName.set(tool.name, tool);
  for (const tool of callables) {
    if (!platformMcpPrefix(tool.name)) continue;
    if (byName.has(tool.name)) continue;
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

/** 把已钉住的平台套件写回 active，避免下回合 toolsRemoved 后 not found。 */
export function ensurePinnedPlatformSuites(session: AgentSession, pinned: ReadonlySet<PlatformMcpPrefix>): void {
  if (pinned.size === 0) return;
  const active = session.getActiveToolNames();
  const all = session.getAllTools().map((tool) => tool.name);
  const extra: string[] = [];
  for (const prefix of pinned) {
    for (const name of all) {
      if (name.startsWith(prefix)) extra.push(name);
    }
  }
  if (extra.length === 0) return;
  const next = [...new Set([...active, ...extra])];
  if (sameNameSet(active, next)) return;
  session.setActiveToolsByName(next);
}

/**
 * 替换股票 `createToolSearchExtension`：挂钩 `setActiveTools`，
 * 命中平台 browser/playwright 时展开整套，并优先 browser（防误用无登录态 playwright）。
 * 同步改写 tool_search 返回文案——否则模型仍按 BM25 文案去调 playwright，有窗永远不会 execute。
 *
 * 自愈要点：Pi 对「Tool … not found」走 immediate 路径，**不**调用 afterToolCall / tool_result 钩子，
 * 因此不能靠改写错误文案自愈。真正有效的是 `before_agent_start` 等 MCP 注册并写回 active，
 * 让本回合 context.tools 里已经有 `mcp__browser__*`。
 */
export function createPlatformToolSearchExtension(state: PlatformPinState = createPlatformPinState()): ExtensionFactory {
  const stock = createToolSearchExtension();
  return (pi) => {
    // 回合开始前：若已钉住平台套件，等 deferred MCP 注册完再激活（Pi 默认只等 direct）
    pi.on("before_agent_start", async () => {
      if (state.pinned.size === 0) return;
      await waitForPinnedPlatformTools(pi, state, 15_000);
      activatePinnedOnHost(pi, state);
    });

    // 记下 tool_search 的 query；平台工具点名时提前钉住并激活整套（本回合可能已冻结，仍利下一次）
    pi.on("tool_call", (event) => {
      if (event.toolName === "tool_search") {
        const query = (event.input as { query?: unknown } | undefined)?.query;
        state.lastSearchQuery = typeof query === "string" ? query : "";
        return;
      }
      const prefix = platformMcpPrefix(event.toolName);
      if (!prefix) return;
      state.pinned.add(prefix);
      const all = pi.getAllTools().map((tool) => tool.name);
      if (!all.some((name) => name.startsWith(prefix))) return;
      let next = expandPlatformMcpSuites([...pi.getActiveTools(), event.toolName], all);
      next = preferBrowserSuite(state.lastSearchQuery, next, all, state.pinned);
      next = preferComputerSuite(state.lastSearchQuery, next, all, state.pinned);
      pi.setActiveTools(next);
    });

    const setActive = pi.setActiveTools.bind(pi);
    pi.setActiveTools = (toolNames: string[]) => {
      const all = pi.getAllTools().map((tool) => tool.name);
      let next = expandPlatformMcpSuites(toolNames, all);
      next = preferBrowserSuite(state.lastSearchQuery, next, all, state.pinned);
      // computer 与 browser/playwright 不互斥；搜到或已钉住时补齐整套
      next = preferComputerSuite(state.lastSearchQuery, next, all, state.pinned);
      for (const name of next) {
        const prefix = platformMcpPrefix(name);
        if (prefix) state.pinned.add(prefix);
      }
      setActive(next);
    };

    pi.on("tool_result", (event) => {
      // 注意：immediate「not found」不会进到这里；此分支只覆盖真执行后的错误 / tool_search 文案
      if (event.isError) {
        const healed = rewritePlatformToolNotFound(event, pi, state);
        if (healed) return healed;
      }
      if (event.toolName !== "tool_search" || event.isError) return;
      return rewriteToolSearchResult(event, pi, state);
    });

    if (typeof stock === "function") stock(pi);
  };
}

type PlatformToolHost = {
  getAllTools: () => Array<{ name: string; description?: string }>;
  getActiveTools: () => string[];
  setActiveTools: (toolNames: string[]) => void;
};

/** 已钉住的前缀是否都已出现在 registry（MCP 已连上并 registerTools）。 */
export function pinnedPlatformToolsReady(
  allToolNames: readonly string[],
  pinned: ReadonlySet<PlatformMcpPrefix>,
): boolean {
  if (pinned.size === 0) return true;
  for (const prefix of pinned) {
    if (!allToolNames.some((name) => name.startsWith(prefix))) return false;
  }
  return true;
}

/**
 * deferred MCP 在 session_start 后台连，首 prompt 默认不等。
 * 已钉住 browser/computer 时轮询 registry，避免历史点名 → immediate not found。
 */
export async function waitForPinnedPlatformTools(
  pi: Pick<PlatformToolHost, "getAllTools">,
  state: PlatformPinState,
  timeoutMs = 15_000,
): Promise<boolean> {
  if (state.pinned.size === 0) return true;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const all = pi.getAllTools().map((tool) => tool.name);
    if (pinnedPlatformToolsReady(all, state.pinned)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function activatePinnedOnHost(pi: PlatformToolHost, state: PlatformPinState): void {
  if (state.pinned.size === 0) return;
  const all = pi.getAllTools().map((tool) => tool.name);
  if (!pinnedPlatformToolsReady(all, state.pinned)) return;
  const extra = all.filter((name) => {
    const prefix = platformMcpPrefix(name);
    return prefix !== undefined && state.pinned.has(prefix);
  });
  if (extra.length === 0) return;
  let next = expandPlatformMcpSuites([...pi.getActiveTools(), ...extra], all);
  next = preferBrowserSuite(state.lastSearchQuery, next, all, state.pinned);
  next = preferComputerSuite(state.lastSearchQuery, next, all, state.pinned);
  pi.setActiveTools(next);
}

type ToolResultContent = Array<{ type: string; text?: string } | Record<string, unknown>>;

type ToolSearchResultEvent = {
  content: ToolResultContent;
  details?: unknown;
};

type ToolSearchHost = {
  getAllTools: () => Array<{ name: string; description?: string }>;
  getActiveTools: () => string[];
  /** not-found 自愈写回 active；纯文案改写可不提供 */
  setActiveTools?: (toolNames: string[]) => void;
};

/** 从错误正文解析 `Error: Tool mcp__browser__… not found`（可带引号）。 */
export function parsePlatformToolNotFound(text: string): string | undefined {
  const match = /Tool\s+'?(mcp__(?:browser|playwright|computer)__[\w.-]+)'?\s+not found/i.exec(text);
  return match?.[1];
}

function toolResultText(content: ToolResultContent): string {
  return content
    .map((part) => (typeof part === "object" && part && "text" in part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

type PlatformNotFoundEvent = {
  toolName: string;
  isError?: boolean;
  content: ToolResultContent;
};

/**
 * 自愈：平台工具 not found 时钉住前缀、尽量写回 active，并改写错误文案。
 * - registry 已有整套 → 激活后让模型立刻同参重试（会拉起有窗 Chrome）。
 * - 尚未注册 → 引导 tool_search 一次再重试，禁止拐去 playwright。
 */
export function rewritePlatformToolNotFound(
  event: PlatformNotFoundEvent,
  pi: ToolSearchHost,
  state: PlatformPinState,
): { content: Array<{ type: "text"; text: string }>; details: { healed: boolean; loaded: string[] } } | undefined {
  if (!event.isError) return undefined;
  const body = toolResultText(event.content);
  const missing =
    parsePlatformToolNotFound(body) ??
    (platformMcpPrefix(event.toolName) && /not found/i.test(body) ? event.toolName : undefined);
  if (!missing) return undefined;
  const prefix = platformMcpPrefix(missing);
  if (!prefix) return undefined;

  state.pinned.add(prefix);
  const all = pi.getAllTools().map((tool) => tool.name);
  const suite = all.filter((name) => name.startsWith(prefix));

  if (suite.length > 0) {
    const next = expandPlatformMcpSuites([...pi.getActiveTools(), missing], all);
    pi.setActiveTools?.(next);
    const label =
      prefix === PLATFORM_BROWSER_MCP_PREFIX
        ? "headed Browser Use"
        : prefix === PLATFORM_COMPUTER_MCP_PREFIX
          ? "Computer Use"
          : "Playwright";
    return {
      content: [
        {
          type: "text",
          text:
            `Tool \`${missing}\` was not in the active set; the platform ${label} suite is now reactivated (${suite.length} tools). ` +
            `Call the SAME tool again immediately with the same arguments — that relaunches the shared Chrome profile if the window was closed. ` +
            `Do NOT call tool_search again and do NOT switch to mcp__playwright__* for logged-in sites.`,
        },
      ],
      details: { healed: true, loaded: suite },
    };
  }

  return {
    content: [
      {
        type: "text",
        text:
          `Tool \`${missing}\` is not registered yet (platform MCP may still be connecting). ` +
          `Call tool_search once with query \`${prefix === PLATFORM_COMPUTER_MCP_PREFIX ? "computer" : "browser"}\`, then immediately retry the SAME tool. ` +
          `Do NOT use mcp__playwright__* for logged-in sites — headless has no that login.`,
      },
    ],
    details: { healed: false, loaded: [] },
  };
}

/** 把 tool_search 结果改成真实应使用的平台套件（computer / headed browser 分流）。 */
export function rewriteToolSearchResult(
  event: ToolSearchResultEvent,
  pi: ToolSearchHost,
  state: PlatformPinState,
): { content: Array<{ type: "text"; text: string }>; details: { loaded: string[] } } | undefined {
  const allInfos = pi.getAllTools();
  const allNames = allInfos.map((tool) => tool.name);
  const browserAll = allNames.filter((name) => name.startsWith(PLATFORM_BROWSER_MCP_PREFIX));
  const computerAll = allNames.filter((name) => name.startsWith(PLATFORM_COMPUTER_MCP_PREFIX));
  const details = (event.details ?? {}) as { loaded?: string[] };
  const loaded = Array.isArray(details.loaded) ? details.loaded : [];
  const query = state.lastSearchQuery;
  const wantsPw = queryWantsPlaywright(query);
  const wantsBr = queryWantsBrowser(query) || state.pinned.has(PLATFORM_BROWSER_MCP_PREFIX);
  const wantsComputer = queryWantsComputer(query) || state.pinned.has(PLATFORM_COMPUTER_MCP_PREFIX);
  const loadedPw = loaded.some((name) => name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX));
  const loadedBr = loaded.some((name) => name.startsWith(PLATFORM_BROWSER_MCP_PREFIX));
  const loadedComputer = loaded.some((name) => name.startsWith(PLATFORM_COMPUTER_MCP_PREFIX));

  // 桌面 computer：优先改写为 computer 套件（BM25 常误命中 playwright/browser）
  if (wantsComputer && !wantsBr && !wantsPw) {
    if (computerAll.length === 0) {
      const text =
        "Platform Computer Use (`mcp__computer__*`) is not registered right now (MCP may still be starting, or open-computer-use failed to launch). Do NOT use `mcp__browser__*` / `mcp__playwright__*` for native desktop apps. Retry `tool_search` with query `computer` shortly; on macOS grant Accessibility + Screen Recording to Open Computer Use.";
      return { content: [{ type: "text", text }], details: { loaded: [] } };
    }
    const active = new Set(pi.getActiveTools());
    const report = computerAll.filter((name) => active.has(name));
    const names = report.length > 0 ? report : computerAll;
    return {
      content: [
        {
          type: "text",
          text: formatLoadedSuite(
            names,
            allInfos,
            "platform computer suite (accessibility-first). Use these for native desktop apps — do not call mcp__browser__* / mcp__playwright__* for that task",
          ),
        },
      ],
      details: { loaded: names },
    };
  }

  // 要 headed browser 但 registry 里没有：说清楚，禁止改用 playwright
  if ((wantsBr || (!wantsPw && !wantsComputer && loadedPw)) && browserAll.length === 0) {
    const text =
      "Platform headed Browser Use (`mcp__browser__*`) is not registered right now (MCP may still be starting, or the headed server dropped). Do NOT use `mcp__playwright__*` for logged-in sites — headless has no that login. Retry `tool_search` with query `browser` shortly; once listed, call `mcp__browser__browser_navigate` (closing the window only pauses Chrome — the next call relaunches the same profile).";
    return {
      content: [{ type: "text", text }],
      details: { loaded: [] },
    };
  }

  // 应走 browser：改写为 browser 套件列表（即使 BM25 只命中了 playwright）
  // 注意：纯 computer 查询已在上方处理，避免再被拐成 headed browser
  if (
    browserAll.length > 0 &&
    !wantsPw &&
    !wantsComputer &&
    (wantsBr || loadedPw || state.pinned.has(PLATFORM_BROWSER_MCP_PREFIX))
  ) {
    const active = new Set(pi.getActiveTools());
    const report = browserAll.filter((name) => active.has(name));
    const names = report.length > 0 ? report : browserAll;
    const text = `Loaded ${names.length} tool${names.length === 1 ? "" : "s"} (platform headed browser suite). Use these — do not call mcp__playwright__* for logged-in sites:\n${formatToolLines(names, allInfos)}`;
    return {
      content: [{ type: "text", text }],
      details: { loaded: names },
    };
  }

  // 已同时加载两者且未明确要 playwright：删掉文案里的 playwright，避免模型跟错
  if (loadedBr && loadedPw && !wantsPw && !wantsComputer) {
    const names = loaded.filter((name) => !name.startsWith(PLATFORM_PLAYWRIGHT_MCP_PREFIX));
    if (names.length === 0) return undefined;
    const text = `Loaded ${names.length} tool${names.length === 1 ? "" : "s"}. Prefer mcp__browser__* for logged-in sites:\n${formatToolLines(names, allInfos)}`;
    return {
      content: [{ type: "text", text }],
      details: { loaded: names },
    };
  }

  // computer 已加载但文案可能混了别的：钉住/命中时收成 computer 列表
  if (loadedComputer && wantsComputer && computerAll.length > 0) {
    const active = new Set(pi.getActiveTools());
    const report = computerAll.filter((name) => active.has(name));
    const names = report.length > 0 ? report : computerAll;
    return {
      content: [
        {
          type: "text",
          text: formatLoadedSuite(
            names,
            allInfos,
            "platform computer suite. Prefer element refs from get_app_state",
          ),
        },
      ],
      details: { loaded: names },
    };
  }

  return undefined;
}

function formatToolLines(
  names: string[],
  allInfos: Array<{ name: string; description?: string }>,
): string {
  const descByName = new Map(allInfos.map((tool) => [tool.name, tool.description ?? ""] as const));
  return names
    .map((name) => {
      const desc = (descByName.get(name) ?? "").trim().split(/\r?\n/)[0] ?? "";
      return desc ? `- ${name}: ${desc}` : `- ${name}`;
    })
    .join("\n");
}

function formatLoadedSuite(
  names: string[],
  allInfos: Array<{ name: string; description?: string }>,
  blurb: string,
): string {
  return `Loaded ${names.length} tool${names.length === 1 ? "" : "s"} (${blurb}):\n${formatToolLines(names, allInfos)}`;
}

type AgentWithSnapshot = {
  createContextSnapshot: () => { messages: unknown[]; tools: NamedTool[] };
};

type SessionInternals = {
  agent?: AgentWithSnapshot;
  _getCallableTools?: () => NamedTool[];
};

/**
 * B：会话建好后挂上——钉住套件写回 active；snapshot 并入平台 deferred；调用时 sticky。
 * 测里若 mock 了无 agent 的 session，安静跳过。
 */
export function installDeferredPlatformToolRescue(
  session: AgentSession,
  state: PlatformPinState = createPlatformPinState(),
): () => void {
  // Pi 把 createContextSnapshot / _getCallableTools 标成 private，运行时仍可挂补丁
  const internals = session as unknown as SessionInternals;
  const agent = internals.agent;
  if (!agent || typeof agent.createContextSnapshot !== "function") return () => {};

  // 续会话：transcript 已恢复的 active 名 + 历史消息写回 pin（进程重启后内存 pin 为空）
  seedPinsFromNames(state, session.getActiveToolNames());
  try {
    seedPinsFromMessages(state, session.messages ?? []);
  } catch {
    // messages 未就绪时忽略，createContextSnapshot 还会再扫
  }
  ensurePinnedPlatformSuites(session, state.pinned);

  const original = agent.createContextSnapshot.bind(agent);
  agent.createContextSnapshot = () => {
    // 关窗 / 新回合前先把钉住的 browser 套件写回 active，避免 toolsRemoved → not found
    ensurePinnedPlatformSuites(session, state.pinned);
    const snap = original();
    // 历史里见过的平台工具名也钉住（active 被 toolsRemoved 清空后仍能写回）
    seedPinsFromMessages(state, snap.messages ?? []);
    ensurePinnedPlatformSuites(session, state.pinned);
    const callables =
      typeof internals._getCallableTools === "function"
        ? internals._getCallableTools.call(session)
        : [];
    return {
      ...snap,
      tools: mergePlatformDeferredCallables(snap.tools, callables),
    };
  };

  if (typeof session.subscribe !== "function") return () => {};

  // 真跑到平台工具时钉住 + sticky 激活整套
  return session.subscribe((event) => {
    if (event.type !== "tool_execution_start") return;
    const prefix = platformMcpPrefix(event.toolName);
    if (!prefix) return;
    state.pinned.add(prefix);
    stickyActivatePlatformSuite(session, event.toolName);
  });
}

/** 从工具名列表恢复 pin（续会话 / sticky）。 */
export function seedPinsFromNames(state: PlatformPinState, names: readonly string[]): void {
  for (const name of names) {
    const prefix = platformMcpPrefix(name);
    if (prefix) state.pinned.add(prefix);
  }
}

/**
 * 从 snapshot / transcript 消息里扫平台工具名（assistant tool_use、user tool_result 旁的历史调用）。
 * 进程重启后 active 可能已被 toolsRemoved，靠历史钉住才能自愈。
 */
export function seedPinsFromMessages(state: PlatformPinState, messages: readonly unknown[]): void {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    // Pi toolResult：工具名在消息顶层 toolName，不在 content
    const topName = (message as { toolName?: unknown; name?: unknown }).toolName ?? (message as { name?: unknown }).name;
    if (typeof topName === "string") seedPinsFromNames(state, [topName]);
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      const hit = parsePlatformToolNotFound(content);
      if (hit) seedPinsFromNames(state, [hit]);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const name = (part as { name?: unknown; toolName?: unknown }).name ?? (part as { toolName?: unknown }).toolName;
      if (typeof name === "string") seedPinsFromNames(state, [name]);
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        const hit = parsePlatformToolNotFound(text);
        if (hit) seedPinsFromNames(state, [hit]);
      }
    }
  }
}

/** 把同前缀平台套件并进 active（下回合声明生效）。 */
export function stickyActivatePlatformSuite(session: AgentSession, toolName: string): void {
  if (!platformMcpPrefix(toolName)) return;
  const active = session.getActiveToolNames();
  const all = session.getAllTools().map((tool) => tool.name);
  const next = expandPlatformMcpSuites([...active, toolName], all);
  if (sameNameSet(active, next)) return;
  session.setActiveToolsByName(next);
}

function sameNameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((name) => set.has(name));
}
