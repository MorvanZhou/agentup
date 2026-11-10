import { expect, it } from "vitest";

import { RIGHT_PANE_SHELL_CLASS } from "../../src/pages/conversation/components/chat-main/shared/right-pane-shell.js";

it("anchors the resize handle on the pane edge above the thread column", () => {
  // 桌面端须 relative：static 时 absolute 拖条会锚到整行左缘，边界拖不动
  expect(RIGHT_PANE_SHELL_CLASS).toContain("min-[730px]:relative");
  expect(RIGHT_PANE_SHELL_CLASS).not.toContain("min-[730px]:static");
  // 须高于 ChatPane sideOpen 时对话列的 z-30，否则把手半幅被盖住
  expect(RIGHT_PANE_SHELL_CLASS).toContain("z-40");
});
