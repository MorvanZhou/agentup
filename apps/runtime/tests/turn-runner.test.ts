import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";
import { expect, it } from "vitest";

import { runObservedTurn } from "../src/session/turn/turn-runner.js";
import type { PromptSession } from "../src/session/turn/types.js";

it("projects session text and only the HITL that belongs to this turn", async () => {
  const session = fakeSession();
  const chunks: UIMessageChunk[] = [];
  const pending = runObservedTurn({
    session,
    write: (next) => chunks.push(...next),
    errorPolicy: "propagate",
    hitl: {
      accept: (request) => request.groupId === "g1",
      approvals: {
        subscribe(listener) {
          listener({
            id: "group",
            userId: "u1",
            agentId: "pm",
            groupId: "g1",
            toolCallId: "group-tool",
            toolName: "bash",
            args: { command: "ls" },
          });
          listener({
            id: "single",
            userId: "u1",
            agentId: "pm",
            toolCallId: "single-tool",
            toolName: "bash",
            args: { command: "pwd" },
          });
          return () => undefined;
        },
      },
    },
    run: async () => {
      session.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "你好" },
      } as AgentSessionEvent);
    },
  });
  const result = await pending;
  expect(result.visibleText).toBe("你好");
  expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(true);
  const approvals = chunks.filter((chunk) => chunk.type === "data-agentup-approval");
  expect(approvals).toHaveLength(1);
  expect(JSON.stringify(approvals[0])).toContain("group-tool");
  expect(JSON.stringify(approvals[0])).not.toContain("single-tool");
});

it("aborts the session from the signal and lets a prompt error finish the stream", async () => {
  const session = fakeSession();
  const chunks: UIMessageChunk[] = [];
  const signal = new AbortController();
  signal.abort();
  await runObservedTurn({
    session,
    signal: signal.signal,
    write: (next) => chunks.push(...next),
    errorPolicy: "prompt",
    run: async () => {
      throw new Error("对话失败");
    },
  });
  expect(session.aborted).toBe(true);
  expect(chunks.some((chunk) => chunk.type === "finish")).toBe(true);
});

it("marks a cancelled wake as aborted and rethrows it", async () => {
  const session = fakeSession();
  const outcome = { aborted: false };
  const error = new Error("aborted");
  error.name = "AbortError";
  await expect(
    runObservedTurn({
      session,
      write: () => undefined,
      errorPolicy: "wake",
      outcome,
      run: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(outcome.aborted).toBe(true);
});

it("propagates a group turn error without writing a second failure finish", async () => {
  const session = fakeSession();
  const chunks: UIMessageChunk[] = [];
  await expect(
    runObservedTurn({
      session,
      write: (next) => chunks.push(...next),
      errorPolicy: "propagate",
      run: async () => {
        throw new Error("模型挂了");
      },
    }),
  ).rejects.toThrow("模型挂了");
  expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
});

function fakeSession(): PromptSession & {
  emit: (event: AgentSessionEvent) => void;
  aborted: boolean;
} {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const session = {
    aborted: false,
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener: (event: AgentSessionEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt() {},
    async abort() {
      session.aborted = true;
    },
    dispose() {},
  };
  return session;
}
