import { afterEach, expect, it } from "vitest";

import {
  detectHostEnvironment,
  formatEnvironmentPrompt,
  resetHostEnvironmentCache,
  resolveCommandShell,
  spawnArgsForCommand,
} from "../src/session/environment.js";
import { buildSessionPlan } from "../src/session/plan.js";

afterEach(() => {
  resetHostEnvironmentCache();
});

const model = {
  providerId: "ollama",
  templateId: "ollama",
  modelId: "qwen",
  apiKey: "k",
  baseUrl: "http://127.0.0.1:11434/v1",
  kind: "ollama" as const,
};

function visitRoot() {
  return "/tmp/agentup-env-visit";
}

it("on unix prefers bash only", () => {
  const env = detectHostEnvironment({
    platform: "darwin",
    arch: "arm64",
    osVersion: "Darwin 24.0",
    bashAvailable: true,
    powershellAvailable: false,
  });
  expect(env.commandTool).toBe("bash");
  expect(env.shellTools).toEqual(["bash"]);
  expect(env.powershellAvailable).toBe(false);
});

it("on windows prefers powershell and optionally keeps bash", () => {
  const withBash = detectHostEnvironment({
    platform: "win32",
    arch: "x64",
    osVersion: "Windows_NT 10.0",
    bashAvailable: true,
    powershellAvailable: true,
    powershellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  });
  expect(withBash.commandTool).toBe("powershell");
  expect(withBash.shellTools).toEqual(["powershell", "bash"]);
  expect(withBash.shellLabel).toContain("pwsh");

  const noBash = detectHostEnvironment({
    platform: "win32",
    arch: "x64",
    osVersion: "Windows_NT 10.0",
    bashAvailable: false,
    powershellAvailable: true,
  });
  expect(noBash.shellTools).toEqual(["powershell"]);
});

it("injects environment block that matches command tool", () => {
  const env = detectHostEnvironment({
    platform: "win32",
    arch: "x64",
    osVersion: "Windows_NT 10.0",
    bashAvailable: true,
    powershellAvailable: true,
  });
  const text = formatEnvironmentPrompt(env, "C:\\Users\\a\\cwd");
  expect(text).toContain("# Environment");
  expect(text).toContain("Platform: win32");
  expect(text).toContain("Command tool: powershell");
  expect(text).toContain("Also available: `bash`");
  expect(text).toContain("Working directory: C:/Users/a/cwd");
});

it("session plan whitelist follows detected shell tools", () => {
  const win = buildSessionPlan(
    {
      userId: "u",
      agentId: "a",
      root: visitRoot(),
      packageVersion: 1,
      packageDigest: "d",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    model,
    {
      detect: {
        platform: "win32",
        bashAvailable: false,
        powershellAvailable: true,
      },
    },
  );
  expect(win.environment.commandTool).toBe("powershell");
  expect(win.tools).toContain("powershell");
  expect(win.tools).not.toContain("bash");
  // shell 插在 edit 与 get_local_time 之间；get_local_time 再接 web_search
  const edit = win.tools.indexOf("edit");
  const ps = win.tools.indexOf("powershell");
  const clock = win.tools.indexOf("get_local_time");
  const web = win.tools.indexOf("web_search");
  expect(ps).toBe(edit + 1);
  expect(clock).toBe(ps + 1);
  expect(web).toBe(clock + 1);

  const unix = buildSessionPlan(
    {
      userId: "u",
      agentId: "a",
      root: visitRoot(),
      packageVersion: 1,
      packageDigest: "d",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    model,
    {
      detect: {
        platform: "linux",
        bashAvailable: true,
        powershellAvailable: false,
      },
    },
  );
  expect(unix.tools).toContain("bash");
  expect(unix.tools).not.toContain("powershell");
});

it("resolves powershell spawn args on win32", () => {
  if (process.platform === "win32") {
    const config = resolveCommandShell("powershell", "win32");
    expect(config.args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
    ]);
    const spawned = spawnArgsForCommand("Get-Location", "powershell");
    expect(spawned.args.at(-1)).toBe("Get-Location");
  } else {
    expect(() => resolveCommandShell("powershell", "darwin")).toThrow(/only available on Windows/);
  }
});

it("resolves bash -c spawn on unix", () => {
  if (process.platform === "win32") return;
  const spawned = spawnArgsForCommand("echo hi", "bash");
  expect(spawned.args).toContain("-c");
  expect(spawned.args.at(-1)).toBe("echo hi");
  expect(spawned.stdinCommand).toBeUndefined();
});
