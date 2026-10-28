import { expect, it } from "vitest";

import {
  DESKTOP_PULSE_ACTIVE_MS,
  DESKTOP_PULSE_HIDDEN_MS,
  DESKTOP_PULSE_IDLE_MS,
  desktopPulseIntervalMs,
  desktopPulseIsActive,
} from "../../src/app/desktop-pulse-interval";

it("uses active idle and hidden intervals", () => {
  expect(desktopPulseIntervalMs({ hidden: false, active: true })).toBe(DESKTOP_PULSE_ACTIVE_MS);
  expect(desktopPulseIntervalMs({ hidden: false, active: false })).toBe(DESKTOP_PULSE_IDLE_MS);
  expect(desktopPulseIntervalMs({ hidden: true, active: true })).toBe(DESKTOP_PULSE_HIDDEN_MS);
  expect(desktopPulseIntervalMs({ hidden: true, active: false })).toBe(DESKTOP_PULSE_HIDDEN_MS);
});

it("marks pulse active when any follow-up work exists", () => {
  const empty = {
    busyAgentIds: [] as string[],
    approvals: [] as unknown[],
    askUsers: [] as unknown[],
    shellHangs: [] as unknown[],
    runningDelegations: [] as unknown[],
    runningJobs: [] as unknown[],
    unseenDelegations: [] as unknown[],
    unseenJobs: [] as unknown[],
    groups: [] as Array<{ phase?: string; holderSpeaking?: boolean }>,
  };
  expect(desktopPulseIsActive(empty)).toBe(false);
  expect(desktopPulseIsActive({ ...empty, busyAgentIds: ["a"] })).toBe(true);
  expect(desktopPulseIsActive({ ...empty, runningJobs: [{}] })).toBe(true);
  expect(desktopPulseIsActive({ ...empty, unseenDelegations: [{}] })).toBe(true);
  expect(desktopPulseIsActive({ ...empty, groups: [{ phase: "holding" }] })).toBe(true);
  expect(desktopPulseIsActive({ ...empty, groups: [{ holderSpeaking: true }] })).toBe(true);
  expect(desktopPulseIsActive({ ...empty, groups: [{ phase: "idle" }] })).toBe(false);
});
