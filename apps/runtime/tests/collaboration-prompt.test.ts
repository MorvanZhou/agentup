import { expect, it } from "vitest";

import {
  formatCollaborationPrompt,
  formatGroupCollaborationPrompt,
  formatGroupRosterPrompt,
} from "../src/session/delegation/collaboration-prompt.js";
import { formatDelegationPrompt } from "../src/session/delegation/run.js";

it("describes coordinator role, ask-user routing, and no takeover", () => {
  const text = formatCollaborationPrompt();
  expect(text).toContain("AgentUp Collaboration");
  expect(text).toContain("Do only work that fits your own role");
  expect(text).toContain("call them and coordinate");
  expect(text).toContain("agent_search");
  expect(text).toContain("Call agent_search");
  expect(text).toContain("not a search");
  expect(text).toContain("ask the user who should do it");
  expect(text).toContain("Do not silently self-serve");
  expect(text).toContain("do not invent product/design defaults");

  expect(text).toContain("Never take over the specialist's work");
  expect(text).toContain("delegate_to_agent");
  expect(text).toContain("wait=false");
  expect(text).toContain("~20s");
  expect(text).toContain("Do not default to sync");
  expect(text).toContain("check_delegation");
  expect(text).toContain("tasks=");
  expect(text).toContain("bg_run");
  expect(text).toContain("Before delegate_to_agent");
  expect(text).toContain("Active delegations");
  expect(text).toContain("Do not re-delegate");
  expect(text).toContain("steer_delegation");
  expect(text).toContain("resolve_delegation_update");
  expect(text).toContain("Do not cancel_delegation just to re-delegate");
  expect(text).not.toContain("skip trivial work you can do yourself");
  expect(text).not.toContain("synthesize results; do not dump");
  expect(text).toContain("deliver_artifacts");
  expect(text).toContain("absolute paths");
  expect(text).toContain("their own ARTIFACT/");
  expect(text).toContain("ARTIFACT/from-");
  expect(text).toContain("do not ask them to copy");
});

it("tells a group holder to delegate only to the listed room members", () => {
  const text = formatGroupCollaborationPrompt();
  expect(text).toContain("AgentUp Group");
  expect(text).toContain("delegate_to_agent");
  expect(text).toContain("steer_delegation");
  expect(text).toContain("several async tasks");
  expect(text).toContain("keep");
  expect(text).not.toContain("One task at a time");
  expect(text).toContain("complete_group_task");
  expect(text).toContain("WORK/from-");
  expect(text).toContain("ARTIFACT/from-");
  expect(text).toContain("task_id");
  expect(text).not.toContain("deliver_artifacts");
  expect(text).not.toContain("their own ARTIFACT/");
  expect(text).not.toContain("agent_search");
  expect(text).not.toContain("tasks=");
  expect(text).not.toContain("not a search");
  // 群内委派只有异步：拿 task_id 结束回合，交回后由群唤醒。
  expect(text).toContain("always async");
  expect(text).toContain("Finish your turn");
  expect(text).not.toContain("wait=true");
});

it("lists every other group member and omits the speaker and long instructions", () => {
  const text = formatGroupRosterPrompt({
    selfAgentId: "pm",
    members: [
      { agentId: "pm", name: "产品经理" },
      { agentId: "dev", name: "开发" },
      { agentId: "design", name: "设计师" },
    ],
    cards: [
      {
        agentId: "dev",
        name: "开发",
        role: "工程师",
        background: "写代码",
        remark: "",
        systemText: "SECRET-SYSTEM-BODY",
        agentsText: "SECRET-AGENTS-BODY",
      },
    ],
  });
  expect(text).toContain("agent_id: dev");
  expect(text).toContain("工程师");
  expect(text).toContain("写代码");
  expect(text).toContain("设计师 (agent_id: design)");
  expect(text).not.toContain("agent_id: pm");
  expect(text).not.toContain("SECRET-SYSTEM-BODY");
  expect(text).not.toContain("SECRET-AGENTS-BODY");
});

it("tells a group specialist to write in the shared workspace for that task", () => {
  const text = formatDelegationPrompt("做迷宫", true, "Ab12Cd34", "QA");
  expect(text).toContain("WORK/from-QA-Ab12Cd34/");
  expect(text).toContain("ARTIFACT/from-QA-Ab12Cd34/");
  expect(text).toContain("complete_group_task");
  expect(text).not.toContain("deliver_artifacts");
  const preamble = text.slice(0, text.indexOf("## Task"));
  expect(preamble).not.toMatch(/[\u4e00-\u9fff]/);
});

it("tells the specialist in English to write only in their cwd and ignore caller paths", () => {
  const text = formatDelegationPrompt("做迷宫");
  expect(text).toContain("## Task\n做迷宫");
  expect(text).toContain("WORK/");
  expect(text).toContain("ARTIFACT/");
  expect(text).toContain("deliver_artifacts");
  expect(text).toContain("absolute path");
  expect(text).toContain("ignore that location");
  expect(text).toContain("shell");
  const preamble = text.slice(0, text.indexOf("## Task"));
  expect(preamble).not.toMatch(/[\u4e00-\u9fff]/);
});
