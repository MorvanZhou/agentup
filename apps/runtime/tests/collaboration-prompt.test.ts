import { expect, it } from "vitest";

import { formatCollaborationPrompt } from "../src/session/delegation/collaboration-prompt.js";
import { formatDelegationPrompt } from "../src/session/delegation/run.js";

it("describes coordinator role, ask-user routing, and no takeover", () => {
  const text = formatCollaborationPrompt();
  expect(text).toContain("AgentUp Collaboration");
  expect(text).toContain("Do only work that fits your own role");
  expect(text).toContain("call them and coordinate");
  expect(text).toContain("agent_search");
  expect(text).toContain("Call agent_search");
  expect(text).toContain("not a search");
  expect(text).toContain("ask the user who should do it");
  expect(text).toContain("Do not silently self-serve");
  expect(text).toContain("do not invent product/design defaults");

  expect(text).toContain("Never take over the specialist's work");
  expect(text).toContain("delegate_to_agent");
  expect(text).toContain("wait=false");
  expect(text).toContain("~20s");
  expect(text).toContain("Do not default to sync");
  expect(text).toContain("check_delegation");
  expect(text).toContain("tasks=");
  expect(text).toContain("bg_run");
  expect(text).toContain("Before delegate_to_agent");
  expect(text).toContain("Active delegations");
  expect(text).toContain("Do not re-delegate");
  expect(text).toContain("steer_delegation");
  expect(text).toContain("resolve_delegation_update");
  expect(text).toContain("Do not cancel_delegation just to re-delegate");
  expect(text).not.toContain("skip trivial work you can do yourself");
  expect(text).not.toContain("synthesize results; do not dump");
  expect(text).toContain("deliver_artifacts");
  expect(text).toContain("absolute paths");
  expect(text).toContain("their own ARTIFACT/");
  expect(text).toContain("ARTIFACT/from-");
  expect(text).toContain("do not ask them to copy");
});

it("tells the specialist in English to write only in their cwd and ignore caller paths", () => {
  const text = formatDelegationPrompt("做迷宫");
  expect(text).toContain("## Task\n做迷宫");
  expect(text).toContain("WORK/");
  expect(text).toContain("ARTIFACT/");
  expect(text).toContain("deliver_artifacts");
  expect(text).toContain("absolute path");
  expect(text).toContain("ignore that location");
  expect(text).toContain("shell");
  const preamble = text.slice(0, text.indexOf("## Task"));
  expect(preamble).not.toMatch(/[\u4e00-\u9fff]/);
});
