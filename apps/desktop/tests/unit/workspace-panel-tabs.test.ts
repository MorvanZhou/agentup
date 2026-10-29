// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

// 群聊项目挂载：面板会向 runtime 请求目录列表，测试里换成假 API
vi.mock("../../src/shared/api/runtime", () => ({
  DesktopApi: class {
    listWorkspace = vi.fn(async () => ({ path: "ARTIFACT", entries: [] }));
    listProjectRoots = vi.fn(async () => [] as string[]);
    addProjectRoot = vi.fn(async () => [] as string[]);
    removeProjectRoot = vi.fn(async () => [] as string[]);
  },
  DesktopApiError: class extends Error {},
  runtimeBaseUrl: () => "http://127.0.0.1:1",
}));

import WorkspacePanel from "../../src/pages/conversation/components/chat-main/single/workspace/WorkspacePanel.vue";
import { mountView } from "./mount-view.js";

function tabLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll("nav button")].map((button) =>
    (button.textContent ?? "").trim(),
  );
}

it("群聊工作区显示项目 Tab（与一对一一致）", () => {
  const host = mountView(WorkspacePanel, {
    props: {
      token: "token",
      userId: "u1",
      agentId: "group:ab12cd34",
      personal: false,
      generation: 0,
      group: true,
    },
  });
  const tabs = tabLabels(host);
  expect(tabs).toHaveLength(3);
  expect(tabs[2]).toContain("挂载目录");
});

it("一对一工作区项目 Tab 仍在（旧路径不被群改动破坏）", () => {
  const host = mountView(WorkspacePanel, {
    props: {
      token: "token",
      userId: "u1",
      agentId: "tax-advisor",
      personal: false,
      generation: 0,
    },
  });
  const tabs = tabLabels(host);
  expect(tabs).toHaveLength(3);
  expect(tabs[2]).toContain("挂载目录");
});
