import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import type { Visit } from "../src/package/sync.js";
import {
  MAX_AGENTS_MD_CHARS,
  buildExternalAgentContext,
  composeSystemAppend,
  readAgentsMd,
  readPersona,
} from "../src/session/external/context.js";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ext-ctx-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 造一个 visit：`<root>/.runtime/AGENTS.md`、`<root>/cwd/.pi/SYSTEM.md`、一个技能。 */
function visit(): Visit {
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  return {
    userId: "guest",
    agentId: "a1",
    kind: "agent",
    root,
    packageDigest: "d1",
  } as unknown as Visit;
}

function writeAgentsMd(text: string): void {
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, ".runtime", "AGENTS.md"), text);
}

it("拼接块含身份、工作规则、技能清单与目录", () => {
  const current = visit();
  fs.writeFileSync(path.join(current.root, "cwd", ".pi", "SYSTEM.md"), "你是 Weaty，气象员。");
  writeAgentsMd("- 先查实时数据\n- 不要编造");
  const mounted = path.join(root, "mounted");
  fs.mkdirSync(mounted, { recursive: true });

  const context = buildExternalAgentContext({
    visit: current,
    cwd: path.join(current.root, "cwd"),
    agentName: "Weaty",
    projectRoots: [mounted],
    skills: [{ name: "check-weather", description: "查询城市天气" }],
    skillsProjectRel: ".codebuddy/skills",
  });

  expect(context.systemAppend).toContain("Weaty");
  expect(context.systemAppend).toContain("你是 Weaty，气象员。");
  expect(context.systemAppend).toContain("先查实时数据");
  expect(context.systemAppend).toContain("check-weather: 查询城市天气");
  expect(context.systemAppend).toContain(".codebuddy/skills/<name>/SKILL.md");
  expect(context.systemAppend).toContain("do not call `mcp__agentup__skill_*`");
  expect(context.systemAppend).toContain(path.join(current.root, "cwd"));
  expect(context.systemAppend).toContain(mounted);
});

it("边界声明写明没有 AgentUp 的工具", () => {
  const append = composeSystemAppend({
    persona: "x",
    agentsMd: "",
    skills: [],
    cwd: "/tmp/cwd",
    additionalDirs: [],
  });
  expect(append).toContain("You do not have AgentUp's built-in read / write / bash tools");
  expect(append).toContain("this turn's MCP");
  expect(append).toContain("Skills do not go through MCP");
  expect(append).toContain("require user approval first");
});

it("append 含中立 Environment（无 Pi 工具名、无冻结时刻）", () => {
  const append = composeSystemAppend({
    persona: "",
    agentsMd: "",
    skills: [],
    cwd: "/tmp/cwd",
    additionalDirs: [],
  });
  expect(append).toContain("## Environment");
  expect(append).toContain("Platform:");
  expect(append).toContain("Working directory: /tmp/cwd");
  expect(append).not.toContain("Command tool:");
  expect(append).not.toContain("get_local_time");
  // 不注入「当前时刻」类冻结时钟文案
  expect(append).not.toMatch(/Current (local )?(date|time)/i);
  expect(append).not.toContain("当前时刻");
});

it("append 含 MCP 协作规则（含 agent_search），不写裸 Pi 工具名", () => {
  const append = composeSystemAppend({
    persona: "",
    agentsMd: "",
    skills: [],
    cwd: "/tmp/cwd",
    additionalDirs: [],
  });
  expect(append).toContain("## AgentUp Collaboration");
  expect(append).toContain("mcp__agentup__agent_search");
  expect(append).toContain("mcp__agentup__delegate_to_agent");
  expect(append).toContain("mcp__agentup__check_delegation");
  expect(append).toContain("mcp__agentup__cancel_delegation");
  expect(append).toContain("mcp__agentup__steer_delegation");
  expect(append).toContain("mcp__agentup__resolve_delegation_update");
  expect(append).toContain("mcp__agentup__deliver_artifacts");
  expect(append).toContain("Do not use Bash kill");
  expect(append).not.toContain("Call agent_search");
  expect(append).not.toContain("delegate_to_agent (tool approval");
  // 裸 Pi 确认工具名不应出现在 SDK Collaboration
  expect(append).not.toContain("with deliver_artifacts");
});

it("append 含 AgentUp Preview 指引（MCP 全名，无 Pi bg_run）", () => {
  const append = composeSystemAppend({
    persona: "",
    agentsMd: "",
    skills: [],
    cwd: "/tmp/cwd",
    additionalDirs: [],
  });
  expect(append).toContain("## AgentUp Preview");
  expect(append).toContain("mcp__agentup__present_preview");
  expect(append).toContain("Playwright MCP");
  expect(append).toContain("mcp__playwright__browser_");
  expect(append).toContain("do not invent a local Playwright/Bash harness");
  expect(append).toContain("load/search the platform `playwright` MCP");
  expect(append).not.toContain("bg_run");
  // 指引只用 MCP 全名，不出现裸 Pi 工具调用说法
  expect(append).not.toContain("call `present_preview`");
  expect(append).not.toContain("call present_preview");
});

it("群执掌 append 注入 Group 契约与成员 agent_id，不走单聊 agent_search", () => {
  const roster = [
    "# Group members",
    "",
    "These are the only other people in this room. mcp__agentup__delegate_to_agent may use only these agent_ids.",
    "",
    "- Cody (agent_id: 6HhyiCvG)",
    "- Scout (agent_id: iVUb9Wry)",
  ].join("\n");
  const append = composeSystemAppend({
    persona: "",
    agentsMd: "",
    skills: [],
    cwd: "/tmp/cwd",
    additionalDirs: [],
    groupRoster: roster,
  });
  expect(append).toContain("## AgentUp Group");
  expect(append).toContain("# Group members");
  expect(append).toContain("agent_id: 6HhyiCvG");
  expect(append).toContain("agent_id: iVUb9Wry");
  expect(append).toContain("not the display name");
  expect(append).toContain("Do not call `mcp__agentup__agent_search` in a group room");
  expect(append).toContain("mcp__agentup__delegate_to_agent");
  expect(append).toContain("mcp__agentup__complete_group_task");
  expect(append).not.toContain("## AgentUp Collaboration");
  // 单聊才强调的「先搜花名册」不应出现在群协议标题段
  expect(append).not.toMatch(/## AgentUp Collaboration[\s\S]*agent_search/);
  expect(append).not.toContain("with complete_group_task");
});

it("additionalDirs 不含 cwd 自身，也不含不存在的目录", () => {
  const current = visit();
  const cwd = path.join(current.root, "cwd");
  const real = path.join(root, "real-mount");
  fs.mkdirSync(real, { recursive: true });

  const context = buildExternalAgentContext({
    visit: current,
    cwd,
    projectRoots: [real, path.join(root, "不存在的目录")],
  });
  // 内部走 realpath（macOS /var → /private/var），断言也用 realpath
  expect(context.additionalDirs).toEqual([fs.realpathSync(real)]);
});

it("群 workspace 在目录列表里标明：相对 WORK/ARTIFACT 解析到共享根而非私人 cwd", () => {
  const current = visit();
  const cwd = path.join(current.root, "cwd");
  const groupRoot = path.join(root, "group-workspace");
  fs.mkdirSync(groupRoot, { recursive: true });
  const context = buildExternalAgentContext({
    visit: current,
    cwd,
    groupWorkspaceRoot: groupRoot,
  });
  expect(context.systemAppend).toContain("private Working directory");
  expect(context.systemAppend).toMatch(/shared group workspace[\s\S]*WORK\/\.\.\. and ARTIFACT\/\.\.\./);
  expect(context.systemAppend).toContain(fs.realpathSync(groupRoot).replace(/\\/g, "/"));
});

it(`AGENTS.md 超长按 ${MAX_AGENTS_MD_CHARS} 截断`, () => {
  const current = visit();
  writeAgentsMd("规".repeat(MAX_AGENTS_MD_CHARS + 500));
  expect(readAgentsMd(current.root).length).toBe(MAX_AGENTS_MD_CHARS + 500);
  const context = buildExternalAgentContext({ visit: current, cwd: path.join(current.root, "cwd") });
  expect(context.systemAppend).toContain("(truncated)");
  // 协作 / Environment / Preview（含 Playwright MCP 指引）会占额外预算；只锁「AGENTS 截断后不失控」
  expect(context.systemAppend.length).toBeLessThan(MAX_AGENTS_MD_CHARS + 4_000);
});

it("文件缺失不报错：人设与规则都为空也能拼出边界块", () => {
  const current = visit();
  expect(readPersona(current, path.join(current.root, "cwd"))).toBe("");
  expect(readAgentsMd(current.root)).toBe("");
  const context = buildExternalAgentContext({ visit: current, cwd: path.join(current.root, "cwd") });
  expect(context.systemAppend).toContain("Directories you may read and write");
  expect(context.additionalDirs).toEqual([]);
});

it("私人助理的人设从 .runtime/SYSTEM.md 读", () => {
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, ".runtime", "SYSTEM.md"), "你是小A。");
  const personal = { userId: "guest", agentId: "personal-assistant", kind: "personal", root } as unknown as Visit;
  expect(readPersona(personal, cwd)).toContain("你是小A。");
});
