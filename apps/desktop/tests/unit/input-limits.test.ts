/**
 * @vitest-environment happy-dom
 *
 * 锁住桌面输入上限。数字写死，和后端 security 配置同一套；
 * 调高常量、拿掉 maxlength，或不再按字节截断规则，这里会红。
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import GroupCreatePanel from "../../src/pages/conversation/components/chat-main/group/GroupCreatePanel.vue";
import {
  BACKGROUND_MAX,
  clampUtf8,
  GROUP_TITLE_MAX,
  NAME_MAX,
  NICKNAME_MAX,
  REMARK_MAX,
  ROLE_MAX,
  RULES_MAX_BYTES,
  RULES_MAX_CHARS,
  SEARCH_QUERY_MAX,
} from "../../src/shared/model/input-limits.js";
import { mountView } from "./mount-view.js";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

it("桌面上限与已公布的后端数字一致", () => {
  expect(NAME_MAX).toBe(80);
  expect(ROLE_MAX).toBe(40);
  expect(BACKGROUND_MAX).toBe(300);
  expect(RULES_MAX_CHARS).toBe(5_000);
  expect(RULES_MAX_BYTES).toBe(15_000);
  expect(REMARK_MAX).toBe(40);
  expect(GROUP_TITLE_MAX).toBe(40);
  expect(NICKNAME_MAX).toBe(64);
  expect(SEARCH_QUERY_MAX).toBe(64);
});

it("规则按 UTF-8 字节截到大约 5000 个汉字", () => {
  const exact = "规".repeat(5_000);
  expect(new TextEncoder().encode(exact).byteLength).toBe(15_000);
  expect(clampUtf8(exact, RULES_MAX_BYTES)).toBe(exact);

  const over = clampUtf8("规".repeat(5_001), RULES_MAX_BYTES);
  expect(over).toBe(exact);
  expect(new TextEncoder().encode(over).byteLength).toBeLessThanOrEqual(15_000);

  const emoji = clampUtf8("😀".repeat(5_000), 15_000);
  // 😀 在 JS 里是两个 UTF-16 码元，截断后应仍是完整字符。
  expect([...emoji].length).toBe(3_750);
  expect(new TextEncoder().encode(emoji).byteLength).toBe(15_000);
});

it("编辑表单把名称、岗位、背景和规则上限绑在输入框上", () => {
  // 整表挂载后卸载会在 happy-dom 里拆 fragment 失败，所以锁模板绑定。
  const form = source("../../src/shared/components/agent-editor/AgentEditorForm.vue");
  expect(form).toContain(':maxlength="NAME_MAX"');
  expect(form).toContain(':maxlength="ROLE_MAX"');
  expect(form).toContain(':maxlength="BACKGROUND_MAX"');
  expect(form).toContain(':maxlength="RULES_MAX_CHARS"');
  expect(form).toContain("clampUtf8");
});

it("建群把群名和搜索上限绑在输入框上", () => {
  const group = mountView(GroupCreatePanel, {
    props: {
      title: "",
      agents: [
        {
          agentId: "advisor",
          name: "顾问",
          role: "岗",
          background: "",
          latestVersion: 1,
          latestDigest: "",
          localVersion: 0,
          recruited: true,
          hasAvatar: false,
          remark: "",
          recruitCount: 0,
        },
      ],
      picked: [],
      defaultHolderId: null,
    },
  });
  const title = group.querySelector("input[type=text]") as HTMLInputElement;
  const search = group.querySelector("input[type=search]") as HTMLInputElement;
  expect(title.maxLength).toBe(40);
  expect(search.maxLength).toBe(64);
});

it("备注、昵称和目录搜索仍引用同一套上限", () => {
  expect(source("../../src/pages/conversation/components/chat-main/single/ChatSettingsPanel.vue")).toContain(
    ':maxlength="REMARK_MAX"',
  );
  expect(source("../../src/pages/settings/components/sections/app-settings/AccountSettings.vue")).toContain(
    ':maxlength="NICKNAME_MAX"',
  );
  expect(source("../../src/pages/agents/AgentsPage.vue")).toContain(':maxlength="SEARCH_QUERY_MAX"');
  expect(source("../../src/pages/agents/MarketPage.vue")).toContain(':maxlength="SEARCH_QUERY_MAX"');
  expect(source("../../src/pages/settings/components/sections/my-assistant/RulesSettings.vue")).toContain(
    ':maxlength="RULES_MAX_CHARS"',
  );
  expect(source("../../src/pages/agents/AssistantPage.vue")).toContain(':maxlength="RULES_MAX_CHARS"');
  expect(source("../../src/pages/agents/AssistantPage.vue")).toContain("clampUtf8");
});
