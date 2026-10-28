import type { UIMessage } from "ai";
import { expect, it } from "vitest";

import { buildDelegationOuterTabs } from "../../src/pages/conversation/model/group/delegation-bubble-tabs";
import { attachConfirmedArtifactsToMessages } from "../../src/pages/conversation/model/message/message-artifacts";
import {
  buildAssistantByproducts,
  buildLatestAssistantByproducts,
} from "../../src/pages/conversation/model/message/message-byproducts";

it("opens process first and does not render the card handoff summary", () => {
  const state = buildDelegationOuterTabs({
    brief: "做登录页",
    canOpenProcess: true,
    byproducts: null,
  });
  expect(state.tabs.map((tab) => tab.id)).toEqual(["process", "brief"]);
  expect(state.showTabBar).toBe(true);
  expect(state.defaultTabId).toBe("process");
});

it("promotes loaded history products to the same outer tab level", () => {
  const byproducts = buildAssistantByproducts({
    parts: [
      { type: "text", text: "过程" },
      { type: "tool-call", toolName: "bash" },
      { type: "text", text: "history 总结" },
    ],
    metadata: {
      custom: {
        agentUpSummary: { textPartIndex: 1 },
        agentUpArtifacts: { files: [{ path: "ARTIFACT/login.html", kind: "added", size: 1 }] },
      },
    },
    streaming: false,
  });
  const state = buildDelegationOuterTabs({
    brief: "做登录页",
    canOpenProcess: true,
    byproducts,
  });
  expect(state.tabs.map((tab) => tab.id)).toEqual(["summary", "artifacts", "process", "brief"]);
  expect(state.showTabBar).toBe(true);
  expect(state.defaultTabId).toBe("process");
  expect(state.tabs.find((tab) => tab.id === "artifacts")?.badge).toBe("1");
});

it("hides the tab bar when only the brief is on the card", () => {
  const state = buildDelegationOuterTabs({
    brief: "做登录页",
    canOpenProcess: false,
    byproducts: null,
  });
  expect(state.tabs.map((tab) => tab.id)).toEqual(["brief"]);
  expect(state.showTabBar).toBe(false);
  expect(state.defaultTabId).toBe("brief");
});

it("opens a lone process tab when the card has no copy but can be loaded", () => {
  const state = buildDelegationOuterTabs({
    brief: "",
    canOpenProcess: true,
    byproducts: null,
  });
  expect(state.tabs.map((tab) => tab.id)).toEqual(["process"]);
  expect(state.showTabBar).toBe(false);
  expect(state.defaultTabId).toBe("process");
});

it("keeps a queued card with no copy as phase only", () => {
  const state = buildDelegationOuterTabs({
    brief: "",
    canOpenProcess: false,
    byproducts: null,
  });
  expect(state.tabs).toEqual([]);
  expect(state.showTabBar).toBe(false);
  expect(state.defaultTabId).toBeNull();
});

it("keeps subagent products at the outer level", () => {
  const parts = [
    { type: "text", text: "先看" },
    {
      type: "tool-call",
      toolName: "delegate_to_agent",
      toolCallId: "c1",
      args: { agent_id: "weather", brief: "查天气" },
      result: "Delegation completed.\ntask_id: task-1\nagent: 天气 (weather)\nresult:\n晴",
    },
    { type: "text", text: "汇总" },
  ];
  const byproducts = buildAssistantByproducts({
    parts,
    metadata: { custom: { agentUpSummary: { textPartIndex: 1 } } },
    streaming: false,
  });
  const state = buildDelegationOuterTabs({
    brief: "",
    canOpenProcess: true,
    byproducts,
  });
  expect(state.tabs.map((tab) => tab.id)).toContain("subagents");
  expect(state.defaultTabId).toBe("process");
});

// 群委派 history 无 agentup-artifacts 差分时，靠 task.artifacts 投影仍要点亮产物 tab。
it("shows an artifacts tab after confirmed group paths are attached", () => {
  const history = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "demo" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "交付完成", state: "done" }],
    },
  ] as UIMessage[];
  const messages = attachConfirmedArtifactsToMessages(history, [
    { path: "ARTIFACT/from-Cody-glyZmaIi/index.html", size: 208 },
    { path: "WORK/from-Cody-glyZmaIi/tmp.js", size: 1 },
  ]);
  const state = buildDelegationOuterTabs({
    brief: "做个 demo",
    canOpenProcess: true,
    byproducts: buildLatestAssistantByproducts(messages, false),
  });
  expect(state.tabs.map((tab) => tab.id)).toEqual(["summary", "artifacts", "process", "brief"]);
  expect(state.tabs.find((tab) => tab.id === "artifacts")?.badge).toBe("1");
});
