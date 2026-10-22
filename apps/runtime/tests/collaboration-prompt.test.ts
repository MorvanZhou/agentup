import { expect, it } from "vitest";

import { formatCollaborationPrompt } from "../src/session/delegation/collaboration-prompt.js";

it("describes collaboration bias and discovery tools", () => {
  const text = formatCollaborationPrompt();
  expect(text).toContain("AgentUp Collaboration");
  expect(text).toContain("list_recruited_agents");
  expect(text).toContain("delegate_to_agent");
  expect(text).toContain("Relevant recruited agents");
});
