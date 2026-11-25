/**
 * L3 回归：Windows Desktop 上 Agent 执行命令 / 平台 MCP 不得弹可见 cmd。
 *
 * 用户坑：对话里跑工具时弹出 cmd/conhost 黑框。
 * 真机闪窗靠进程快照验证；本文件锁住「会直接导致弹窗」的 spawn 契约，
 * 回退成 npx.cmd / shell:true / windowsHide:false 时必须红。
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: object) => {
      spawnMock(command, args, options);
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { on: () => void; end: () => void };
        pid: number;
        signalCode: null;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { on: () => {}, end: () => {} };
      child.pid = 4242;
      child.signalCode = null;
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("ok\n"));
        child.emit("close", 0);
      });
      return child as unknown as ReturnType<typeof actual.spawn>;
    },
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getShellConfig: () => ({ shell: "C:\\Git\\bin\\bash.exe", args: ["-c"] }),
    getPowerShellConfig: () => ({
      shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
    }),
  };
});

const { createIdleAwareShellOperations } = await import(
  "../src/session/hitl/shell-hang/operations.js"
);
const { shouldWindowsHideChild } = await import("../src/session/windows-hide.js");
const { platformMcpServersOf } = await import("../src/session/mcp/platform-mcp.js");
const { BROWSER_MCP_NAME } = await import("../src/session/mcp/browser-platform.js");
const { PLAYWRIGHT_MCP_NAME } = await import("../src/session/mcp/playwright-platform.js");
const { COMPUTER_MCP_NAME } = await import("../src/session/mcp/computer-platform.js");

const originalPlatform = process.platform;
const originalStdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const savedHiddenConsole = process.env.AGENTUP_HIDDEN_CONSOLE;

beforeEach(() => {
  spawnMock.mockClear();
  delete process.env.AGENTUP_HIDDEN_CONSOLE;
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  // GUI 宿主：无 TTY → shouldWindowsHideChild 必须为 true
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    enumerable: true,
    get: () => false,
  });
});

afterEach(() => {
  Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  if (originalStdoutDescriptor) {
    Object.defineProperty(process.stdout, "isTTY", originalStdoutDescriptor);
  } else {
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
  if (savedHiddenConsole === undefined) delete process.env.AGENTUP_HIDDEN_CONSOLE;
  else process.env.AGENTUP_HIDDEN_CONSOLE = savedHiddenConsole;
});

it("Windows GUI 宿主上 bash tool spawn 必须 windowsHide（否则弹黑框）", async () => {
  expect(
    shouldWindowsHideChild({ platform: "win32", stdoutIsTTY: false, env: {} }),
  ).toBe(true);

  const ops = createIdleAwareShellOperations({
    shell: "bash",
    idleMs: 60_000,
    onIdlePark: () => "unused",
  });
  await ops.exec("echo ok", process.cwd(), {
    onData: () => {},
    signal: undefined,
  });

  expect(spawnMock).toHaveBeenCalled();
  const options = spawnMock.mock.calls[0]?.[2] as {
    windowsHide?: boolean;
    detached?: boolean;
    shell?: boolean;
  };
  expect(options.windowsHide, "bash 必须 CREATE_NO_WINDOW").toBe(true);
  expect(options.detached, "Win32 勿 detached 另开控制台").toBe(false);
  expect(options.shell, "禁止 shell:true 经 cmd.exe").not.toBe(true);
});

it("Windows GUI 宿主上 powershell tool spawn 必须 windowsHide", async () => {
  const ops = createIdleAwareShellOperations({
    shell: "powershell",
    idleMs: 60_000,
    onIdlePark: () => "unused",
  });
  await ops.exec("Write-Output ok", process.cwd(), {
    onData: () => {},
    signal: undefined,
  });

  expect(spawnMock).toHaveBeenCalled();
  const options = spawnMock.mock.calls[0]?.[2] as { windowsHide?: boolean; shell?: boolean };
  expect(options.windowsHide).toBe(true);
  expect(options.shell).not.toBe(true);
});

it("平台 playwright/browser/computer 不得配置 npx.cmd，且经 execPath + launch", () => {
  const servers = platformMcpServersOf("/tmp/agentup-silent-spawn");
  for (const name of [PLAYWRIGHT_MCP_NAME, BROWSER_MCP_NAME, COMPUTER_MCP_NAME]) {
    const entry = servers[name];
    expect(entry, name).toBeTruthy();
    expect(String(entry?.command).toLowerCase(), `${name} 勿用 npx.cmd`).not.toMatch(/npx\.cmd$/);
    expect(entry?.command, `${name} 须用当前 Node/Electron`).toBe(process.execPath);
    const blob = JSON.stringify(entry);
    expect(blob.toLowerCase(), `${name} 配置勿再写 npx.cmd`).not.toContain("npx.cmd");
  }

  const playwrightArgs = servers[PLAYWRIGHT_MCP_NAME]?.args ?? [];
  expect(playwrightArgs[0]).toMatch(/playwright-mcp-launch\.js$/);

  const browserArgs = servers[BROWSER_MCP_NAME]?.args ?? [];
  expect(String(browserArgs[0])).toContain("mcp-bridge.mjs");
  const upstream = JSON.parse(
    String(servers[BROWSER_MCP_NAME]?.env?.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON ?? "[]"),
  ) as string[];
  expect(upstream[0]).toMatch(/playwright-mcp-launch\.js$/);
  expect(upstream.join(" ").toLowerCase()).not.toContain("npx");
});

it("computer-mcp-launch 直 spawn 原生 exe 且 windowsHide（避开上游 false）", () => {
  const launch = path.join(
    import.meta.dirname,
    "../src/session/mcp/computer-mcp-launch.ts",
  );
  const src = fs.readFileSync(launch, "utf8");
  expect(src).toContain("computerNativeExecutablePath");
  expect(src).toMatch(/windowsHide:\s*true/);
  expect(src).not.toMatch(/spawn\(process\.execPath,\s*\[cli/);
});

it("mcp-bridge 源码禁止 shell:true（Win 会经 cmd 弹窗）", () => {
  const bridge = path.join(
    import.meta.dirname,
    "../src/session/mcp/browser-theater/mcp-bridge.mjs",
  );
  // 去掉注释再扫，避免「禁止 shell:true」说明文字误伤
  const code = fs
    .readFileSync(bridge, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  expect(code).not.toMatch(/shell\s*:\s*true/);
  expect(code).not.toMatch(/shell\s*:\s*process\.platform\s*===\s*["']win32["']/);
  expect(code.toLowerCase()).not.toContain("npx.cmd");
});
