import { expect, it } from "vitest";

import {
  skillAddConflict,
  upsertPendingSkill,
  visibleInstalledSkills,
  type PendingSkill,
} from "../../src/shared/model/skills/pending-skill";

it("detects conflict with installed and pending skill names", () => {
  const pending: PendingSkill[] = [{ path: "/tmp/a.zip", name: "weather" }];
  expect(skillAddConflict("notes", ["notes"], pending)).toBe("installed");
  expect(skillAddConflict("weather", ["notes"], pending)).toBe("pending");
  expect(skillAddConflict("fresh", ["notes"], pending)).toBe(null);
});

it("upserts pending skill by name and hides overlapping installed rows", () => {
  const first: PendingSkill[] = [{ path: "/tmp/old.zip", name: "weather" }];
  const next = upsertPendingSkill(first, { path: "/tmp/new.zip", name: "weather" });
  expect(next).toEqual([{ path: "/tmp/new.zip", name: "weather" }]);
  expect(visibleInstalledSkills(["weather", "notes"], next)).toEqual(["notes"]);
});
