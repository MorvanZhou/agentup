import { describe, expect, it } from "vitest";

import {
  composerRunActions,
  composerUsesFollowUpQueue,
} from "../../src/pages/conversation/model/composer/composer-actions";

describe("composerUsesFollowUpQueue", () => {
  it("单聊 SDK 才入队；群聊即使模型是 SDK 也不走 followUp", () => {
    expect(composerUsesFollowUpQueue({ followUp: true })).toBe(true);
    expect(composerUsesFollowUpQueue({ followUp: false })).toBe(false);
    expect(composerUsesFollowUpQueue({ followUp: true, groupId: "g1" })).toBe(false);
    expect(composerUsesFollowUpQueue({ followUp: false, groupId: "g1" })).toBe(false);
  });
});

describe("composerRunActions", () => {
  it("shows only stop while a reply is streaming and the composer is empty", () => {
    expect(
      composerRunActions({
        streaming: true,
        stopVisible: true,
        hasText: false,
        inputDisabled: false,
        steerBlocked: false,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });

  it("shows only send when the composer has text during a stream", () => {
    expect(
      composerRunActions({
        streaming: true,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: false,
      }),
    ).toEqual({ stop: false, send: true, interrupt: true });
  });

  it("sends when nothing is running", () => {
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: false,
        hasText: true,
        inputDisabled: false,
        steerBlocked: false,
      }),
    ).toEqual({ stop: false, send: true, interrupt: false });
  });

  it("does not send a new turn during ask-user, approval, or wake", () => {
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: true,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });

  it("shows only stop while a group subtask is running, the holder is idle, and the composer is empty", () => {
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: false,
        inputDisabled: false,
        steerBlocked: false,
        tasksBusy: true,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });

  it("shows only send while a group subtask is running and the composer has text", () => {
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: false,
        tasksBusy: true,
      }),
    ).toEqual({ stop: false, send: true, interrupt: false });
  });

  it("消费轮（wake）中 SDK 接入仍可入队：有字→发，空→停", () => {
    // 第二轮是 runtime 旁路 wake 轮：assistant-ui 线程没在跑（streaming=false），
    // 但 SDK 接入下发送仍是「进 followUp 队列」语义，不该被 steerBlocked 封死。
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: true,
        queueWhileBusy: true,
      }),
    ).toEqual({ stop: false, send: true, interrupt: false });
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: false,
        inputDisabled: false,
        steerBlocked: true,
        queueWhileBusy: true,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });

  it("queueWhileBusy 不抢流式中的 interrupt 语义，也不松动 AskUser/审批", () => {
    expect(
      composerRunActions({
        streaming: true,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: false,
        queueWhileBusy: true,
      }),
    ).toEqual({ stop: false, send: true, interrupt: true });
    // 非 SDK 接入（queueWhileBusy=false）的 wake 保持原样：只停不发
    expect(
      composerRunActions({
        streaming: false,
        stopVisible: true,
        hasText: true,
        inputDisabled: false,
        steerBlocked: true,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });

  it("does not send when the composer cannot accept input", () => {
    expect(
      composerRunActions({
        streaming: true,
        stopVisible: true,
        hasText: true,
        inputDisabled: true,
        steerBlocked: false,
      }),
    ).toEqual({ stop: true, send: false, interrupt: false });
  });
});
