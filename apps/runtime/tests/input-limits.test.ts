/** 本机名称与私人助理规则的上限。数字写死，和后端同一套。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { UserResourceError, writeUserAgentsMd } from "../src/local/assistant/user-resources.js";
import {
  AgentIdentityError,
  BACKGROUND_MAX,
  NAME_MAX,
  ROLE_MAX,
  normalizeAgentBackground,
  normalizeAgentName,
  normalizeAgentRole,
} from "../src/local/agents/identity.js";

it("名片长度与已公布的后端数字一致", () => {
  expect(NAME_MAX).toBe(80);
  expect(ROLE_MAX).toBe(40);
  expect(BACKGROUND_MAX).toBe(300);
  expect(normalizeAgentName("名".repeat(80))).toBe("名".repeat(80));
  expect(normalizeAgentRole("岗".repeat(40))).toBe("岗".repeat(40));
  expect(normalizeAgentBackground("背".repeat(300))).toBe("背".repeat(300));
  expect(() => normalizeAgentName("名".repeat(81))).toThrow(AgentIdentityError);
  expect(() => normalizeAgentRole("岗".repeat(41))).toThrow(AgentIdentityError);
  expect(() => normalizeAgentBackground("背".repeat(301))).toThrow(AgentIdentityError);
});

it("私人助理规则停在 5000 个汉字", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-rules-cap-"));
  const exact = "规".repeat(5_000);
  expect(Buffer.byteLength(exact, "utf8")).toBe(15_000);
  expect(writeUserAgentsMd(data, "patient", exact)).toContain("规");
  expect(() => writeUserAgentsMd(data, "patient", "规".repeat(5_001))).toThrow(UserResourceError);
});
