import { describe, expect, it } from "vitest";

import { shouldAutoExpandToolCard } from "../../src/pages/conversation/model/thread/tool-auto-expand";

describe("shouldAutoExpandToolCard", () => {
  it("单聊进行中且 preferOpen 时自动展开", () => {
    expect(
      shouldAutoExpandToolCard({
        allowAutoExpand: true,
        preferOpen: true,
        isActive: true,
        canExpand: true,
        isError: false,
      }),
    ).toBe(true);
  });

  it("群聊 / 旁路只读过程禁止自动展开", () => {
    expect(
      shouldAutoExpandToolCard({
        allowAutoExpand: false,
        preferOpen: true,
        isActive: true,
        canExpand: true,
        isError: false,
      }),
    ).toBe(false);
  });

  it("已结束或不可展开时不自动打开", () => {
    expect(
      shouldAutoExpandToolCard({
        allowAutoExpand: true,
        preferOpen: true,
        isActive: false,
        canExpand: true,
        isError: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoExpandToolCard({
        allowAutoExpand: true,
        preferOpen: true,
        isActive: true,
        canExpand: false,
        isError: false,
      }),
    ).toBe(false);
  });

  it("错误态不自动展开", () => {
    expect(
      shouldAutoExpandToolCard({
        allowAutoExpand: true,
        preferOpen: true,
        isActive: true,
        canExpand: true,
        isError: true,
      }),
    ).toBe(false);
  });
});
