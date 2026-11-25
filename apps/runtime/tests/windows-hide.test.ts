import { expect, it } from "vitest";

import { shouldWindowsHideChild } from "../src/session/windows-hide.js";

it("non-Windows never hides via windowsHide flag", () => {
  expect(shouldWindowsHideChild({ platform: "darwin", stdoutIsTTY: false })).toBe(false);
  expect(shouldWindowsHideChild({ platform: "linux", stdoutIsTTY: true })).toBe(false);
});

it("Windows without console hides children", () => {
  expect(
    shouldWindowsHideChild({
      platform: "win32",
      env: {},
      stdoutIsTTY: false,
    }),
  ).toBe(true);
});

it("Windows with TTY or AGENTUP_HIDDEN_CONSOLE does not CREATE_NO_WINDOW", () => {
  expect(
    shouldWindowsHideChild({
      platform: "win32",
      env: {},
      stdoutIsTTY: true,
    }),
  ).toBe(false);
  expect(
    shouldWindowsHideChild({
      platform: "win32",
      env: { AGENTUP_HIDDEN_CONSOLE: "1" },
      stdoutIsTTY: false,
    }),
  ).toBe(false);
});
