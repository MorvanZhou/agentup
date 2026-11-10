import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { writeClaudeApiKey } from "../src/session/external/sdk/adapters/claude-code/home.js";
import { claudeOptionsOf } from "../src/session/external/sdk/adapters/claude-code/options.js";
import { codebuddyOptionsOf } from "../src/session/external/sdk/adapters/codebuddy/options.js";
import { codexClientOptionsOf } from "../src/session/external/sdk/adapters/codex/options.js";
import { copilotSessionConfigOf } from "../src/session/external/sdk/adapters/copilot/options.js";
import { cursorCreateOptionsOf } from "../src/session/external/sdk/adapters/cursor/options.js";
import { opencodeServerConfigOf } from "../src/session/external/sdk/adapters/opencode/options.js";
import type { ExternalTurnRequest } from "../src/session/external/sdk/contract.js";
import { mergeExternalTurnMcpServers } from "../src/session/external/sdk/mcp-servers.js";
import { listExternalDriverIds } from "../src/session/external/sdk/registry.js";
import { PLAYWRIGHT_MCP_NAME } from "../src/session/mcp/playwright-platform.js";
import { platformMcpServersOf } from "../src/session/mcp/platform-mcp.js";

/**
 * 回归：Host 平台 MCP（Playwright 等）必须经 platformMcpServers 整表下发到各 SDK。
 * 曾漏挂 CodeBuddy → Scout 只能 Bash 自建 harness。
 */

const RUNTIME_SRC = path.join(import.meta.dirname, "../src");
const SDK_ADAPTERS_DIR = path.join(RUNTIME_SRC, "session/external/sdk/adapters");
const HOST_DIR = path.join(RUNTIME_SRC, "session/external/sdk/host");

/** 探针名：防 adapter 写死只认 playwright，新增平台 MCP 时仍漏合并。 */
const PLATFORM_PROBE_NAME = "agentup_platform_probe";

const PLATFORM_PROBE: Record<string, Record<string, unknown>> = {
  [PLAYWRIGHT_MCP_NAME]: {
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.46", "--headless"],
    env: { PLAYWRIGHT_BROWSERS_PATH: "/tmp/browsers" },
    exposure: "deferred",
  },
  [PLATFORM_PROBE_NAME]: {
    command: "echo",
    args: ["platform-probe"],
    env: {},
    exposure: "deferred",
  },
};

const AGENTUP_HTTP = {
  type: "http",
  url: "http://127.0.0.1:9/mcp",
  headers: { Authorization: "Bearer t" },
};

/**
 * 已支持把 platformMcpServers 并进厂商 MCP 袋的 driver。
 * 新 driver 必须进本表或下方 EXEMPT，否则 registry 覆盖测会红。
 */
const MERGING_DRIVERS = [
  "codebuddy",
  "claude-code",
  "cursor",
  "codex",
  "opencode",
  "copilot",
] as const;

/**
 * 暂不支持平台 stdio MCP 的 driver → 必须写清理由。
 * 接上后移出此处并加入 MERGING_DRIVERS + extract 矩阵。
 */
const PLATFORM_MCP_EXEMPT: Record<string, string> = {
  dsh: "cordis patch 目前只 insert HTTP agentup；stdio 平台 MCP 尚未接入",
};

type ExtractMcp = (input: ExternalTurnRequest) => Record<string, unknown>;

function baseInput(overrides: Partial<ExternalTurnRequest> = {}): ExternalTurnRequest {
  return {
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: "/tmp/agentup-user",
    templateId: "test-sdk",
    mcpServer: AGENTUP_HTTP,
    platformMcpServers: PLATFORM_PROBE,
    ...overrides,
  };
}

function expectPlatformKeysMerged(mcp: Record<string, unknown>, label: string): void {
  expect(mcp, `${label}: 应保留 agentup`).toHaveProperty("agentup");
  expect(mcp[PLAYWRIGHT_MCP_NAME], `${label}: 应合并 playwright`).toEqual(
    PLATFORM_PROBE[PLAYWRIGHT_MCP_NAME],
  );
  expect(mcp[PLATFORM_PROBE_NAME], `${label}: 应合并探针（勿写死只认 playwright）`).toEqual(
    PLATFORM_PROBE[PLATFORM_PROBE_NAME],
  );
}

const EXTRACTORS: Record<(typeof MERGING_DRIVERS)[number], ExtractMcp> = {
  codebuddy: (input) => {
    const options = codebuddyOptionsOf(input);
    return (options.mcpServers ?? {}) as Record<string, unknown>;
  },
  "claude-code": (input) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pw-claude-"));
    writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
    const options = claudeOptionsOf({
      ...input,
      userDataRoot: root,
      templateId: "claude-agent-sdk",
    });
    return (options.mcpServers ?? {}) as Record<string, unknown>;
  },
  cursor: (input) => {
    const options = cursorCreateOptionsOf(input, { apiKey: "k", localStore: {} });
    return (options.mcpServers ?? {}) as Record<string, unknown>;
  },
  codex: (input) => {
    const client = codexClientOptionsOf(input, {
      cliPath: "/fake/codex",
      codexHome: "/tmp/codex-home",
    });
    return (client.config.mcp_servers ?? {}) as Record<string, unknown>;
  },
  opencode: (input) => {
    const config = opencodeServerConfigOf(input);
    return (config.mcp ?? {}) as Record<string, unknown>;
  },
  copilot: (input) => {
    const session = copilotSessionConfigOf(input, {
      approveAll: () => ({ kind: "approve-once" as const }),
    });
    return (session.mcpServers ?? {}) as Record<string, unknown>;
  },
};

it("mergeExternalTurnMcpServers 整表合并 platform 键（含探针）", () => {
  const merged = mergeExternalTurnMcpServers(baseInput());
  expect(merged).toBeTruthy();
  expectPlatformKeysMerged(merged!, "helper");
});

it("platformMcpServersOf 至少包含 playwright，且是 Host 唯一组装口的契约", () => {
  const servers = platformMcpServersOf("/tmp/agentup-user");
  expect(Object.keys(servers)).toContain(PLAYWRIGHT_MCP_NAME);
  expect(servers[PLAYWRIGHT_MCP_NAME]).toMatchObject({
    exposure: "deferred",
    args: expect.arrayContaining(["--headless"]),
  });
});

it("Host turn-factory / stream-bridge 必须调用 platformMcpServersOf（禁止散落字面量）", () => {
  for (const file of ["turn-factory.ts", "stream-bridge.ts"]) {
    const src = fs.readFileSync(path.join(HOST_DIR, file), "utf8");
    expect(src, file).toContain("platformMcpServersOf");
    expect(src, `${file} 勿再手写 playwright: playwrightStdioConfig`).not.toMatch(
      /platformMcpServers:\s*\{\s*playwright:/,
    );
  }
});

it("registry 每个 driver 都在合并矩阵或显式豁免名单里", () => {
  const covered = new Set<string>([...MERGING_DRIVERS, ...Object.keys(PLATFORM_MCP_EXEMPT)]);
  for (const id of listExternalDriverIds()) {
    expect(
      covered.has(id),
      `新 driver「${id}」须加入 MERGING_DRIVERS（并实现平台 MCP 合并）或 PLATFORM_MCP_EXEMPT（写明理由）`,
    ).toBe(true);
  }
  for (const id of MERGING_DRIVERS) {
    expect(PLATFORM_MCP_EXEMPT[id], `${id} 不能同时在合并表与豁免表`).toBeUndefined();
  }
});

for (const driverId of MERGING_DRIVERS) {
  it(`${driverId}: 启流 options 合并 platformMcpServers 全部键（含探针）`, () => {
    const mcp = EXTRACTORS[driverId](baseInput());
    expectPlatformKeysMerged(mcp, driverId);
  });
}

it("adapters/*/options.ts：启流路径读了 mcpServer 就必须读 platformMcpServers 或走 merge helper", () => {
  const dirs = fs
    .readdirSync(SDK_ADAPTERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const driverId of dirs) {
    if (PLATFORM_MCP_EXEMPT[driverId]) continue;
    const optionsPath = path.join(SDK_ADAPTERS_DIR, driverId, "options.ts");
    if (!fs.existsSync(optionsPath)) continue;
    const src = fs.readFileSync(optionsPath, "utf8");
    // 压缩回合允许无 MCP；只锁「凡引用 mcpServer 的 options 模块须能合并平台 MCP」
    if (!src.includes("mcpServer")) continue;
    const mergesPlatform =
      src.includes("platformMcpServers") || src.includes("mergeExternalTurnMcpServers");
    expect(
      mergesPlatform,
      `${driverId}/options.ts 使用了 mcpServer 但未合并 platformMcpServers（或未调用 mergeExternalTurnMcpServers）`,
    ).toBe(true);
  }
});

it("豁免名单里的 driver 源码仍须存在，避免假豁免", () => {
  for (const driverId of Object.keys(PLATFORM_MCP_EXEMPT)) {
    expect(fs.existsSync(path.join(SDK_ADAPTERS_DIR, driverId)), driverId).toBe(true);
    expect(PLATFORM_MCP_EXEMPT[driverId]!.trim().length).toBeGreaterThan(10);
  }
});
