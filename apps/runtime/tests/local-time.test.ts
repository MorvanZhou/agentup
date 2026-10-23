import { expect, it } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { requiresApproval } from "../src/session/hitl/approval/tools.js";
import {
  GET_LOCAL_TIME_TOOL,
  createLocalTimeExtension,
  formatLocalTime,
  readLocalTime,
} from "../src/session/tools/index.js";

it("reads local wall clock with IANA timezone and weekday", () => {
  const info = readLocalTime(new Date("2026-03-23T07:58:12.345Z"), "Asia/Shanghai");
  expect(info).toEqual({
    isoLocal: "2026-03-23T15:58:12+08:00",
    utc: "2026-03-23T07:58:12.345Z",
    timeZone: "Asia/Shanghai",
    offset: "+08:00",
    weekday: "Monday",
    epochMs: Date.parse("2026-03-23T07:58:12.345Z"),
  });
  expect(formatLocalTime(info)).toBe(
    "Local time: 2026-03-23T15:58:12+08:00 (Asia/Shanghai, Monday)",
  );
});

it("falls back to host timezone when none is forced", () => {
  const info = readLocalTime(new Date("2026-06-15T12:00:00.000Z"));
  expect(info.timeZone.length).toBeGreaterThan(0);
  expect(info.isoLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect(info.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  expect(info.utc).toBe("2026-06-15T12:00:00.000Z");
});

it("does not require approval and registers a read-only tool", () => {
  expect(requiresApproval(GET_LOCAL_TIME_TOOL)).toBe(false);

  let registered: { name: string; annotations?: { readOnlyHint?: boolean } } | undefined;
  createLocalTimeExtension()({
    on() {},
    registerTool(tool: { name: string; annotations?: { readOnlyHint?: boolean } }) {
      registered = tool;
    },
  } as unknown as ExtensionAPI);

  expect(registered?.name).toBe(GET_LOCAL_TIME_TOOL);
  expect(registered?.annotations?.readOnlyHint).toBe(true);
});
