import { expect, it } from "vitest";

import { sessionProfile } from "../src/session/core/session-profile.js";

it("keeps one-to-one capabilities and opens a group holder as a fresh projection", () => {
  const services = { delegation: true, background: true };
  const interactive = sessionProfile("interactive", services);
  const holder = sessionProfile("group-holder", services);
  expect(interactive.mode).toBe("single");
  expect(interactive.session).toBe("continue");
  expect(interactive.projectRootsPrompt).toBe(true);
  expect(interactive.completeGroupTask).toBe(false);
  expect(interactive.deliverArtifacts).toBe(false);
  expect(holder.mode).toBe("group-holder");
  expect(holder.session).toBe("fresh");
  expect(holder.projectRootsPrompt).toBe(false);
  expect(holder.deliverArtifacts).toBe(false);
  expect(holder.completeGroupTask).toBe(false);
  expect(holder.delegateTool).toBe(true);
  expect(holder.backgroundTool).toBe(true);
  expect(holder.collaborationPrompt).toBe(true);
  expect(holder.summary).toBe(true);
  expect(holder.artifactPanel).toBe(true);
  expect(holder.personalSkills).toBe(true);
});

it("keeps parent-only tools off a one-to-one session when those services are absent", () => {
  const profile = sessionProfile("interactive");
  expect(profile.delegateTool).toBe(false);
  expect(profile.delegationInbox).toBe(false);
  expect(profile.collaborationPrompt).toBe(false);
  expect(profile.delegationLabels).toBe(false);
  expect(profile.backgroundTool).toBe(false);
  expect(profile.summary).toBe(true);
  expect(profile.healInterrupted).toBe(true);
  expect(profile.persistModelRef).toBe(true);
});

it("opens a delegation child as a fresh session and ignores parent services", () => {
  const profile = sessionProfile("delegation", { delegation: true, background: true });
  expect(profile.session).toBe("fresh");
  expect(profile.deliverArtifacts).toBe(true);
  expect(profile.completeGroupTask).toBe(false);
  expect(profile.delegateTool).toBe(false);
  expect(profile.backgroundTool).toBe(false);
  expect(profile.delegationInbox).toBe(false);
  expect(profile.summary).toBe(false);
  expect(profile.artifactPanel).toBe(false);
  expect(profile.collaborationPrompt).toBe(false);
  expect(profile.projectRootsPrompt).toBe(false);
  expect(profile.personalSkills).toBe(false);
  expect(profile.personalMcp).toBe(false);
  expect(profile.healInterrupted).toBe(false);
  expect(profile.persistModelRef).toBe(false);
  expect(profile.delegationLabels).toBe(false);
});
