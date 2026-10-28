import { describe, expect, it } from "vitest";

import { composerRunActions } from "../../src/pages/conversation/model/composer/composer-actions";

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
