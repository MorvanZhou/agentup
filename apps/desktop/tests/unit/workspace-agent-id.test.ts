import { describe, expect, it } from "vitest";

import { resolveWorkspaceAgentId } from "../../src/pages/conversation/model/workspace/workspace-agent-id.js";

describe("resolveWorkspaceAgentId", () => {
  it("prefers override, then injected, then group fallback", () => {
    expect(
      resolveWorkspaceAgentId({
        override: "weather",
        injectedAgentId: "other",
        groupId: "g1",
      }),
    ).toBe("weather");
    expect(resolveWorkspaceAgentId({ injectedAgentId: "weather", groupId: "g1" })).toBe("weather");
    expect(resolveWorkspaceAgentId({ injectedAgentId: "", groupId: "g1" })).toBe("group:g1");
    expect(resolveWorkspaceAgentId({ injectedAgentId: "  ", groupId: "  " })).toBe("");
  });

  it("群聊空 inject 时回落 group:，避免 preview 鉴权失败 toast", () => {
    // 与 useOpenWorkspaceFile 一致：群消息树 injectThreadAgentId 为空串
    expect(resolveWorkspaceAgentId({ injectedAgentId: "", groupId: "dev-squad" })).toBe(
      "group:dev-squad",
    );
  });
});
