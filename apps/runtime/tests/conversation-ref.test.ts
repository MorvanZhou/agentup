import path from "node:path";

import { expect, it } from "vitest";

import {
  conversationKey,
  conversationSessionDir,
  groupConversation,
  hitlContextFor,
  singleConversation,
} from "../src/session/core/conversation-ref.js";

it("keeps one agent’s one-to-one, groups, and delegation as different conversations", () => {
  const single = singleConversation({ userId: "u1", agentId: "pm", visitKind: "recruited" });
  const groupA = groupConversation({ userId: "u1", groupId: "ga", holderAgentId: "pm" });
  const groupB = groupConversation({ userId: "u1", groupId: "gb", holderAgentId: "pm" });
  const child = {
    kind: "delegation" as const,
    userId: "u1",
    taskId: "task-1",
    parent: groupA,
  };
  expect(new Set([conversationKey(single), conversationKey(groupA), conversationKey(groupB), conversationKey(child)]).size).toBe(4);
  expect(hitlContextFor(single)).toEqual({ origin: "visit" });
  expect(hitlContextFor(groupA)).toEqual({ origin: "visit", groupId: "ga" });
  expect(hitlContextFor(child)).toMatchObject({ origin: "delegation", taskId: "task-1", groupId: "ga", parentAgentId: "pm" });
});

it("places each conversation in its existing session directory", () => {
  const root = "/data";
  const visitRoot = "/data/users/u1/agents/pm";
  const single = singleConversation({ userId: "u1", agentId: "pm", visitKind: "recruited" });
  const group = groupConversation({ userId: "u1", groupId: "g1", holderAgentId: "pm" });
  const child = {
    kind: "delegation" as const,
    userId: "u1",
    taskId: "task-1",
    parent: single,
  };
  expect(conversationSessionDir({ userDataRoot: root, visitRoot, conversation: single })).toBe(
    path.join(visitRoot, "sessions"),
  );
  expect(conversationSessionDir({ userDataRoot: root, visitRoot, conversation: group })).toBe(
    path.join(root, "users", "u1", ".runtime", "groups", "g1", "holders", "pm", "sessions"),
  );
  expect(conversationSessionDir({ userDataRoot: root, visitRoot, conversation: child })).toBe(
    path.join(visitRoot, ".runtime", "delegations", "task-1", "sessions"),
  );
});
