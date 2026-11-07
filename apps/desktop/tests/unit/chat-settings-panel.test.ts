/**
 * @vitest-environment happy-dom
 */
import { AuiConfig, AuiProvider } from "@assistant-ui/vue";
import { ExternalThread } from "@assistant-ui/core/store";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";

import { desktopKey } from "../../src/app/desktop.js";
import ChatSettingsPanel from "../../src/pages/conversation/components/chat-main/single/ChatSettingsPanel.vue";
import {
  threadActionsKey,
  type ThreadActions,
} from "../../src/pages/conversation/model/thread/thread-actions.js";
import {
  threadExtrasKey,
  type ThreadExtras,
} from "../../src/pages/conversation/model/thread/thread-extras.js";
import { mountView } from "./mount-view.js";

const extras: ThreadExtras = {
  personal: false,
  kind: "recruited",
  name: "莫烦",
  role: "博主",
  remark: "小莫",
  background: "",
  recruited: true,
  syncedVersion: "1",
  busy: false,
  modelConfigured: true,
  modelLoaded: true,
};

const actions: ThreadActions = {
  clearContext: async () => undefined,
  clearHistory: async () => undefined,
  clearing: false,
  clearingHistory: false,
  setRemark: async () => undefined,
  dismiss: async () => undefined,
  stopTurn: async () => undefined,
  enqueueFollowUp: async () => undefined,
  steerTurn: async () => false,
};

function mount(props: { token: string; userId: string; agentId: string }): HTMLElement {
  // 对话页里面板包在 AuiProvider 下，并注入线程动作；这里只补这两样，不挂整页。
  const Host = defineComponent({
    name: "ChatSettingsPanelHost",
    setup() {
      const config = AuiConfig({
        thread: ExternalThread({
          messages: [],
          isRunning: false,
          isSendDisabled: true,
          onNew: () => undefined,
        }),
      });
      return () =>
        h(AuiProvider, { config, extends: null }, () =>
          h(ChatSettingsPanel, {
            token: props.token,
            userId: props.userId,
            agentId: props.agentId,
            class: "pane-fill",
          }),
        );
    },
  });
  return mountView(Host, {
    provide: [
      [
        desktopKey,
        {
          conversations: computed(() => [
            { agentId: "other", name: "测试员", remark: "阿测" },
          ]),
        },
      ],
      [threadExtrasKey, ref(extras)],
      [threadActionsKey, ref(actions)],
    ],
  });
}

function root(host: HTMLElement): HTMLElement {
  const node = host.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error("设置面板没有根节点");
  return node;
}

it("把侧栏传来的 class 落到抽屉上，并画出审批数据", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      command: "once",
      tools: [{ tool_name: "fs", kind: "mcp_server", label: "文件系统", scope: "session" }],
      delegation: {
        anyone: "once",
        targets: [{ agent_id: "other", scope: "session" }],
      },
    }),
  );
  try {
    const host = mount({ token: "tok", userId: "u1", agentId: "ag1" });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("文件系统");
    });
    expect(host.textContent).toContain("阿测");
    expect(root(host).classList.contains("pane-fill")).toBe(true);
    expect(host.querySelector('[aria-label="关闭对话设置"]')).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("缺身份时不拉审批，class 仍落在抽屉上", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({});
  });
  try {
    const host = mount({ token: "", userId: "", agentId: "" });
    await nextTick();
    expect(calls).toEqual([]);
    expect(host.textContent).not.toContain("文件系统");
    expect(root(host).classList.contains("pane-fill")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
