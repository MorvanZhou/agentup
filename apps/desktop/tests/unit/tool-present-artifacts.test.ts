import { expect, it } from "vitest";

import { presentArtifactsView } from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/session/tool-present-artifacts.js";

it("present_artifacts 抽出 action、结果路径与清空态", () => {
  expect(
    presentArtifactsView(
      { action: "set", paths: ["brief.md"] },
      "Deliverables grid now has 1 file(s) (action=set):\n- ARTIFACT/brief.md",
    ),
  ).toEqual({
    action: "set",
    paths: ["ARTIFACT/brief.md"],
    error: "",
    cleared: false,
  });

  expect(
    presentArtifactsView(
      { action: "set", paths: [] },
      "Deliverables grid cleared (action=set).",
    ),
  ).toEqual({
    action: "set",
    paths: [],
    error: "",
    cleared: true,
  });

  expect(
    presentArtifactsView(
      { action: "add", paths: ["a.md", "b.md"] },
      "",
    ),
  ).toEqual({
    action: "add",
    paths: ["a.md", "b.md"],
    error: "",
    cleared: false,
  });
});

it("present_artifacts 结果 Error 行进 error，不把死链当成功路径", () => {
  expect(
    presentArtifactsView(
      { action: "set", paths: ["brief-incredibox-like.md"] },
      "Error: missing ARTIFACT file: ARTIFACT/brief-incredibox-like.md",
    ),
  ).toEqual({
    action: "set",
    paths: ["brief-incredibox-like.md"],
    error: "missing ARTIFACT file: ARTIFACT/brief-incredibox-like.md",
    cleared: false,
  });
});
