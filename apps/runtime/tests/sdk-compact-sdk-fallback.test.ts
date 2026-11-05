import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FILE_VERSION } from "../src/config/provider/constants.js";
import { persist } from "../src/config/provider/store.js";
import { claudeCompactOptionsOf } from "../src/session/external/sdk/adapters/claude-code/options.js";
import type { ExternalCompactRequest, ExternalDriver } from "../src/session/external/sdk/contract.js";
import {
  createSdkCompactSummarize,
  pickSdkCompactTarget,
} from "../src/session/external/sdk/host/compact-sdk.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-compact-sdk-"));
  roots.push(root);
  return root;
}

describe("claudeCompactOptionsOf", () => {
  it("不挂 MCP / additionalDirs，工具恒 deny，system 为压缩器", () => {
    const root = tempRoot();
    const abortController = new AbortController();
    const input: ExternalCompactRequest = {
      prompt: "请摘要",
      cwd: root,
      abortController,
      userDataRoot: root,
      templateId: "claude-agent-sdk",
      modelId: "claude-sonnet-4",
    };
    const options = claudeCompactOptionsOf(input);
    expect(options.cwd).toBe(root);
    expect(options.mcpServers).toBeUndefined();
    expect(options.additionalDirectories).toBeUndefined();
    expect(options.systemPrompt).toEqual(expect.stringContaining("压缩"));
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(1);
    expect(options.persistSession).toBe(false);
  });

  it("canUseTool 拒绝任意工具", async () => {
    const root = tempRoot();
    const options = claudeCompactOptionsOf({
      prompt: "x",
      cwd: root,
      abortController: new AbortController(),
      userDataRoot: root,
      templateId: "claude-agent-sdk",
    });
    const canUseTool = options.canUseTool as (name: string) => Promise<{ behavior: string }>;
    await expect(canUseTool("Bash")).resolves.toMatchObject({ behavior: "deny" });
    await expect(canUseTool("AskUserQuestion")).resolves.toMatchObject({ behavior: "deny" });
  });
});

describe("createSdkCompactSummarize", () => {
  it("无 prefer 时不回落；有 SDK prefer 时锚定该 template", () => {
    const root = tempRoot();
    expect(pickSdkCompactTarget(root)).toBeNull();
    expect(createSdkCompactSummarize({ userDataRoot: root })).toBeUndefined();
    expect(
      pickSdkCompactTarget(root, {
        providerId: "codebuddy",
        templateId: "codebuddy-sdk",
        modelId: "m1",
        apiKey: "x",
        kind: "agent-sdk",
      }),
    ).toMatchObject({ templateId: "codebuddy-sdk", modelId: "m1" });
  });

  it("支持 compact 的 driver 会截窗后调用 compactSummarize，并用临时 cwd", async () => {
    const root = tempRoot();
    persist(root, {
      version: FILE_VERSION,
      connections: [],
      enabledModels: [{ templateId: "claude-agent-sdk", modelId: "claude-sonnet-4" }],
      activeModel: { templateId: "claude-agent-sdk", modelId: "claude-sonnet-4" },
      agentSdks: [
        {
          templateId: "claude-agent-sdk",
          state: "ready",
          models: [{ id: "claude-sonnet-4", name: "Sonnet" }],
        },
      ],
    });

    const prefer = {
      providerId: "claude-agent-sdk",
      templateId: "claude-agent-sdk",
      modelId: "claude-sonnet-4",
      apiKey: "placeholder",
      kind: "agent-sdk" as const,
      contextWindow: 200_000,
    };

    const seenCwds: string[] = [];
    const compactSummarize = vi.fn(async (req: ExternalCompactRequest) => {
      seenCwds.push(req.cwd);
      expect(fs.existsSync(req.cwd)).toBe(true);
      expect(req.prompt).toContain("压缩上下文");
      expect(req.prompt).toContain("用户：hello");
      return "  摘要正文  ";
    });

    const fakeDriver = {
      capabilities: {
        driverId: "claude-code",
        systemPromptMode: "append",
        askUserToolNames: [],
        compactSummarize: true,
      },
      compactSummarize,
    } as unknown as ExternalDriver;

    const summarize = createSdkCompactSummarize(
      { userDataRoot: root, prefer },
      {
        getExternalDriver: () => fakeDriver,
        driverIdOfTemplate: () => "claude-code",
        installedCliPathFor: () => null,
      },
    );
    expect(summarize).toBeTypeOf("function");
    const out = await summarize!("用户：hello\n助手：world");
    expect(out).toBe("摘要正文");
    expect(compactSummarize).toHaveBeenCalledOnce();
    expect(seenCwds).toHaveLength(1);
    expect(fs.existsSync(seenCwds[0]!)).toBe(false);
  });
});
