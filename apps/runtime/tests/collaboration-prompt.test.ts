import { expect, it } from "vitest";

import { formatCollaborationPrompt } from "../src/session/delegation/collaboration-prompt.js";

it("describes collaboration bias and discovery tools", () => {
  const text = formatCollaborationPrompt();
  expect(text).toContain("AgentUp Collaboration");
  expect(text).toContain("collaboration workspace");
  expect(text).toContain("agent_search");
  expect(text).toContain("before answering alone");
  expect(text).toContain("delegate_to_agent");
  expect(text).toContain("wait=false");
  expect(text).toContain("~20s");
  expect(text).toContain("Do not default to sync");
  expect(text).toContain("check_delegation");
  expect(text).toContain("tasks=");
  expect(text).toContain("bg_run");
});
