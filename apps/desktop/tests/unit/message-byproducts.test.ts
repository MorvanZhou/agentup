import { describe, expect, it } from "vitest";

import {
  formatArtifactCountBadge,
} from "../../src/pages/conversation/model/message/message-artifacts";
import {
  buildAssistantByproducts,
  readAgentUpSummary,
  resolveSummaryPartIndex,
} from "../../src/pages/conversation/model/message/message-byproducts";

describe("message-byproducts", () => {
  it("reads agentUpSummary from metadata.custom", () => {
    expect(
      readAgentUpSummary({ custom: { agentUpSummary: { textPartIndex: 1, textPartId: "t1" } } }),
    ).toEqual({ textPartIndex: 1, textPartId: "t1" });
  });

  it("streaming defaults to process without summary tab", () => {
    const state = buildAssistantByproducts({
      parts: [{ type: "text", text: "中间" }],
      metadata: { custom: { agentUpSummary: { textPartIndex: 0 } } },
      streaming: true,
    });
    expect(state.tabs.map((tab) => tab.id)).toEqual(["process"]);
    expect(state.showTabBar).toBe(false);
    expect(state.defaultTabId).toBe("process");
  });

  it("after settle promotes summary and keeps process when extras exist", () => {
    const parts = [
      { type: "text", text: "先说" },
      { type: "tool-call", toolName: "bash", result: "ok" },
      { type: "text", text: "总结" },
    ];
    const state = buildAssistantByproducts({
      parts,
      metadata: { custom: { agentUpSummary: { textPartIndex: 1 } } },
      streaming: false,
    });
    expect(state.summaryPartIndex).toBe(2);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["summary", "process"]);
    expect(state.showTabBar).toBe(true);
    expect(state.defaultTabId).toBe("summary");
  });

  it("shows artifacts tab with count badge after settle", () => {
    const state = buildAssistantByproducts({
      parts: [{ type: "text", text: "完成" }],
      metadata: {
        custom: {
          agentUpSummary: { textPartIndex: 0 },
          agentUpArtifacts: {
            files: [
              { path: "ARTIFACT/a.txt", kind: "added", size: 1 },
              { path: "ARTIFACT/b.txt", kind: "modified", size: 2 },
            ],
          },
        },
      },
      streaming: false,
    });
    expect(state.tabs.map((tab) => tab.id)).toEqual(["summary", "artifacts"]);
    expect(state.tabs.find((tab) => tab.id === "artifacts")?.badge).toBe("2");
    expect(state.artifacts?.files).toHaveLength(2);
  });

  it("formatArtifactCountBadge caps at 9+", () => {
    expect(formatArtifactCountBadge(0)).toBe("");
    expect(formatArtifactCountBadge(9)).toBe("9");
    expect(formatArtifactCountBadge(10)).toBe("9+");
  });

  it("hides tab bar for summary-only replies", () => {
    const state = buildAssistantByproducts({
      parts: [{ type: "text", text: "你好" }],
      metadata: { custom: { agentUpSummary: { textPartIndex: 0 } } },
      streaming: false,
    });
    expect(state.tabs.map((tab) => tab.id)).toEqual(["summary"]);
    expect(state.showTabBar).toBe(false);
  });

  it("falls back to last text when metadata has no summary", () => {
    const state = buildAssistantByproducts({
      parts: [
        { type: "text", text: "中间" },
        { type: "tool-call", toolName: "bash", result: "ok" },
        { type: "text", text: "总结" },
      ],
      metadata: { custom: { agentUpCreatedAt: "2026-10-13T00:00:00.000Z" } },
      streaming: false,
    });
    expect(state.summary?.textPartIndex).toBe(1);
    expect(state.summaryPartIndex).toBe(2);
    expect(state.tabs.map((tab) => tab.id)).toContain("summary");
    expect(state.defaultTabId).toBe("summary");
  });

  it("resolveSummaryPartIndex prefers textPartId then ordinal", () => {
    const parts = [
      { type: "text", text: "a", id: "t0" },
      { type: "text", text: "b", id: "t1" },
    ];
    expect(resolveSummaryPartIndex(parts, { textPartIndex: 0, textPartId: "t1" })).toBe(1);
    expect(resolveSummaryPartIndex(parts, { textPartIndex: 1 })).toBe(1);
  });
});
