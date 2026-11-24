import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  COMPUTER_MCP_NAME,
  COMPUTER_MCP_PACKAGE,
  COMPUTER_MCP_VERSION,
  computerCliPath,
  computerInstallDir,
  computerMcpEntry,
  computerMcpLaunchPath,
  computerStdioConfig,
  ensureComputerUseInstalled,
  injectComputerUseMcp,
  isComputerUseInstalled,
  resetComputerUseInstallForTests,
} from "../src/session/mcp/computer-platform.js";

afterEach(() => {
  resetComputerUseInstallForTests();
});

it("computer 安装目录在 userData/runtime/open-computer-use，不走系统 npx", () => {
  const root = "/tmp/agentup-user";
  expect(computerInstallDir(root)).toBe(
    path.join(root, "runtime", "open-computer-use"),
  );
  expect(computerCliPath(root)).toBe(
    path.join(
      root,
      "runtime",
      "open-computer-use",
      "node_modules",
      "open-computer-use",
      "bin",
      "open-computer-use",
    ),
  );
  expect(COMPUTER_MCP_PACKAGE).toBe(`open-computer-use@${COMPUTER_MCP_VERSION}`);
});

it("computer stdio 经启动器 + userDataRoot，不用 npx", () => {
  const root = "/tmp/agentup-user";
  const stdio = computerStdioConfig(root);
  expect(stdio.exposure).toBe("deferred");
  expect(stdio.command).toBe(process.execPath);
  expect(stdio.args).toEqual([computerMcpLaunchPath(), root]);
  expect(stdio.args[0]).toMatch(/computer-mcp-launch\.js$/);
  expect(stdio.args.join(" ")).not.toContain("npx");
  expect(stdio.env).toEqual({});
});

it("injectComputerUseMcp 强制平台条目覆盖同名用户 server", () => {
  const next = injectComputerUseMcp(
    {
      servers: [
        {
          name: COMPUTER_MCP_NAME,
          source: "user",
          scope: "global" as const,
          config: { command: "echo", args: [], exposure: "direct" as const },
        },
      ],
      errors: [],
    },
    "/tmp/agentup-user",
  );
  expect(next.servers).toHaveLength(1);
  expect(next.servers[0]?.name).toBe(COMPUTER_MCP_NAME);
  expect(next.servers[0]?.source).toBe("agentup:platform");
  expect(next.servers[0]?.config).toMatchObject({
    exposure: "deferred",
    command: process.execPath,
  });
  const args = next.servers[0]?.config && "args" in next.servers[0].config
    ? next.servers[0].config.args
    : undefined;
  expect(args).toEqual([computerMcpLaunchPath(), "/tmp/agentup-user"]);
  expect(computerMcpEntry("/tmp/agentup-user").name).toBe(COMPUTER_MCP_NAME);
});

it("ensureComputerUseInstalled 把钉版装进 runtime 并写 ready 标记", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-computer-install-"));
  try {
    expect(isComputerUseInstalled(root)).toBe(false);
    await ensureComputerUseInstalled(root);
    expect(isComputerUseInstalled(root)).toBe(true);
    expect(fs.existsSync(computerCliPath(root))).toBe(true);
    expect(
      fs.readFileSync(path.join(computerInstallDir(root), ".agentup-ready"), "utf8").trim(),
    ).toBe(COMPUTER_MCP_VERSION);
    // 二次调用不重装（目录 mtime 可不变；至少仍 ready）
    const before = fs.statSync(computerInstallDir(root)).mtimeMs;
    await ensureComputerUseInstalled(root);
    expect(fs.statSync(computerInstallDir(root)).mtimeMs).toBe(before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
