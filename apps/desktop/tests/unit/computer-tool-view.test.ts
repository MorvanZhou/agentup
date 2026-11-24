import { expect, it } from "vitest";

import {
  computerAppStateSummary,
  computerAxCollapsedNote,
  computerClickMarker,
  computerClickSummary,
  computerToolDetail,
  computerToolTitle,
  resolveComputerToolName,
} from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/computer/computer-tool-view.js";

it("只认 mcp__computer__*，不认裸名 click / browser", () => {
  expect(resolveComputerToolName("mcp__computer__click")).toBe("click");
  expect(resolveComputerToolName("mcp__computer__get_app_state")).toBe("get_app_state");
  expect(resolveComputerToolName("mcp__computer__list_apps")).toBe("list_apps");
  expect(resolveComputerToolName("mcp__computer__type_text")).toBe("type_text");
  expect(resolveComputerToolName("click")).toBeNull();
  expect(resolveComputerToolName("get_app_state")).toBeNull();
  expect(resolveComputerToolName("mcp__browser__browser_click")).toBeNull();
  expect(resolveComputerToolName("mcp__playwright__browser_click")).toBeNull();
});

it("Click 摘要优先 element_index / 应用名", () => {
  expect(computerClickSummary({ app: "Calculator", element_index: 14 })).toBe(
    "Calculator · #14",
  );
  expect(computerClickSummary({ element_index: "45" })).toBe("#45");
  expect(computerClickSummary({ x: 100, y: 200, app: "TextEdit" })).toBe(
    "TextEdit · (100, 200)",
  );
  expect(
    computerClickSummary({}, { text: "Error: Accessibility permission denied" }),
  ).toContain("Accessibility permission denied");
});

it("App state 摘要只要应用名，不吞整段 AX", () => {
  expect(computerAppStateSummary({ app: "Calculator" })).toBe("Calculator");
  const ax = `App: Calculator\n${"#1 Button Clear\n".repeat(80)}`;
  expect(computerAppStateSummary({}, { text: ax })).toBe("Calculator");
  expect(computerAppStateSummary({}, { text: ax }).length).toBeLessThan(40);
});

it("无图时 AX 正文折叠成短说明", () => {
  const ax = `Window Title\n${"role=button name=Seven ".repeat(40)}`;
  const note = computerAxCollapsedNote({ text: ax }, 160);
  expect(note.length).toBeLessThanOrEqual(160);
  expect(note.endsWith("…")).toBe(true);
  expect(computerAxCollapsedNote({ text: "Error: Screen Recording denied" })).toContain(
    "Screen Recording denied",
  );
});

it("标题与 detail 分流", () => {
  expect(computerToolTitle("get_app_state")).toBe("App state");
  expect(computerToolTitle("type_text")).toBe("Type");
  expect(computerToolTitle("press_key")).toBe("Press key");
  expect(computerToolDetail("type_text", { app: "TextEdit", text: "hello" })).toContain(
    "hello",
  );
  expect(computerToolDetail("press_key", { app: "TextEdit", key: "Return" })).toContain(
    "Return",
  );
  expect(computerToolDetail("list_apps", {})).toBe("");
});

it("有像素时抽出准星比例；仅 index 则 null", () => {
  expect(
    computerClickMarker({ x: 50, y: 100, viewportWidth: 200, viewportHeight: 200 }),
  ).toEqual({ x: 0.25, y: 0.5 });
  expect(computerClickMarker({ element_index: 14, app: "Calculator" })).toBeNull();
});
