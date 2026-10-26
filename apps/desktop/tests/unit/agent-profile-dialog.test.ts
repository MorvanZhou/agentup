/** @vitest-environment happy-dom */
import { nextTick } from "vue";
import { expect, it } from "vitest";

import LocalAgentCard from "../../src/pages/agents/components/local/LocalAgentCard.vue";
import AgentMarketCard from "../../src/pages/agents/components/market/AgentMarketCard.vue";
import PublishedAgentCard from "../../src/pages/agents/components/owned/PublishedAgentCard.vue";
import type { AgentCard } from "../../src/shared/model/runtime/runtime.js";
import { mountView } from "./mount-view.js";

const SECRET_RULES = "NEVER_SHOW_RULES";
const SECRET_SKILL = "NEVER_SHOW_SKILL";

function agent(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    kind: "local",
    agentId: "ag_weaty",
    rules: SECRET_RULES,
    skills: [SECRET_SKILL],
    mcpServers: { NEVER_SHOW_MCP: { command: "nope" } },
    name: "Weaty",
    role: "气象顾问",
    background: "常年盯着天气图，说话短。",
    latestVersion: 1,
    latestDigest: "abc",
    localVersion: 1,
    recruited: false,
    hasAvatar: true,
    avatarUrl: "https://example.com/a.webp",
    remark: "别名不应单独成栏",
    recruitCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function clickButton(host: ParentNode, label: string): void {
  const button = [...host.querySelectorAll("button")].find((item) => {
    const aria = item.getAttribute("aria-label");
    return aria === label || item.textContent?.includes(label);
  });
  expect(button, label).toBeTruthy();
  button?.click();
}

async function openProfile(host: HTMLElement, name: string): Promise<HTMLElement> {
  clickButton(host, `查看 ${name}`);
  await nextTick();
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');
  expect(dialog).toBeTruthy();
  return dialog!;
}

it("点本机卡片展开资料，不含高级配置；点对话不展开", async () => {
  const host = mountView(LocalAgentCard, { props: { agent: agent(), busy: false } });

  clickButton(host, "去对话");
  await nextTick();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  const dialog = await openProfile(host, "Weaty");
  const header = dialog.querySelector("header");
  expect(header?.textContent).toContain("Weaty");
  expect(header?.textContent).toContain("气象顾问");
  expect(header?.textContent).not.toContain("人物背景");
  expect(header?.querySelector("img")?.className).toContain("size-20");
  expect(dialog.textContent).toContain("人物背景");
  expect(dialog.textContent).toContain("常年盯着天气图，说话短。");
  expect(dialog.textContent).not.toContain("它是干什么的");
  expect(dialog.textContent).not.toContain(SECRET_RULES);
  expect(dialog.textContent).not.toContain(SECRET_SKILL);
  expect(dialog.textContent).not.toContain("高级设置");
  expect(dialog.textContent).not.toContain("工作规则");
  expect(dialog.textContent).not.toContain("NEVER_SHOW_MCP");

  clickButton(dialog, "预览 Weaty 的头像");
  await nextTick();
  const preview = document.body.querySelector<HTMLElement>('[data-testid="image-preview"]');
  expect(preview).toBeTruthy();
  expect(preview?.querySelector('img[src="https://example.com/a.webp"]')).toBeTruthy();
  // Dialog modal 会把 body 设为 pointer-events:none；预览必须自带 auto 才能接到点击
  expect(preview!.className).toContain("pointer-events-auto");

  // 点预览遮罩只关预览，资料弹窗仍开
  preview!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  preview!.click();
  await nextTick();
  expect(document.body.querySelector('[data-testid="image-preview"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"][data-state="open"]')).toBeTruthy();
});

it("本机卡片缺职位、背景和头像时仍能打开资料", async () => {
  const host = mountView(LocalAgentCard, {
    props: {
      agent: agent({
        role: "",
        background: "  ",
        avatarUrl: undefined,
        hasAvatar: false,
        rules: undefined,
        skills: undefined,
        mcpServers: undefined,
      }),
      busy: false,
    },
  });

  const dialog = await openProfile(host, "Weaty");
  expect(dialog.textContent).toContain("Weaty");
  expect(dialog.textContent).not.toContain("它是干什么的");
  expect(dialog.textContent).not.toContain("人物背景");
  expect(dialog.querySelector("img")).toBeNull();
  expect([...dialog.querySelectorAll("button")].some((item) => item.getAttribute("aria-label") === "预览 Weaty 的头像")).toBe(
    false,
  );
});

it("点市场卡片展开资料；点招募不展开", async () => {
  const host = mountView(AgentMarketCard, {
    props: { agent: agent({ kind: "recruited", recruited: false }), busy: false, surface: "market" },
  });

  clickButton(host, "招募 Weaty");
  await nextTick();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  const dialog = await openProfile(host, "Weaty");
  expect(dialog.textContent).toContain("气象顾问");
  expect(dialog.textContent).toContain("常年盯着天气图，说话短。");
  expect(dialog.textContent).not.toContain(SECRET_RULES);
  expect(dialog.textContent).not.toContain("高级设置");
});

it("点已发布卡片展开资料；点管理不展开", async () => {
  const host = mountView(PublishedAgentCard, {
    props: { agent: agent({ kind: "owned" }), busy: false },
  });

  clickButton(host, "管理 Weaty");
  await nextTick();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  const dialog = await openProfile(host, "Weaty");
  expect(dialog.textContent).toContain("气象顾问");
  expect(dialog.textContent).toContain("常年盯着天气图，说话短。");
  expect(dialog.textContent).not.toContain(SECRET_RULES);
  expect(dialog.textContent).not.toContain("高级设置");
});

it("已发布卡片缺职位、背景和头像时仍能打开资料", async () => {
  const host = mountView(PublishedAgentCard, {
    props: {
      agent: agent({
        kind: "owned",
        role: "",
        background: "  ",
        avatarUrl: undefined,
        hasAvatar: false,
      }),
      busy: false,
    },
  });

  const dialog = await openProfile(host, "Weaty");
  expect(dialog.textContent).toContain("Weaty");
  expect(dialog.textContent).not.toContain("人物背景");
  expect(dialog.querySelector("img")).toBeNull();
});

it("市场卡片缺字段时仍能打开资料", async () => {
  const host = mountView(AgentMarketCard, {
    props: {
      agent: agent({
        kind: "recruited",
        role: "",
        background: "",
        avatarUrl: undefined,
        hasAvatar: false,
        remark: "",
        recruitCount: 0,
      }),
      busy: false,
    },
  });

  const dialog = await openProfile(host, "Weaty");
  expect(dialog.textContent).toContain("Weaty");
  expect(dialog.querySelector("img")).toBeNull();
});
