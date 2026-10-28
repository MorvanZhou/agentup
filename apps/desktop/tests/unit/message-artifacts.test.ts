import { describe, expect, it } from "vitest";

import type { UIMessage } from "ai";

import {
  ARTIFACT_PAGE_SIZE,
  attachConfirmedArtifactsToMessages,
  confirmedArtifactsPanel,
  delegationWorkspaceAgentId,
  formatArtifactCountBadge,
  paginateArtifacts,
  readAgentUpArtifacts,
} from "../../src/pages/conversation/model/message/message-artifacts";
import { buildLatestAssistantByproducts } from "../../src/pages/conversation/model/message/message-byproducts";

describe("message-artifacts", () => {
  it("reads agentUpArtifacts from metadata.custom", () => {
    expect(
      readAgentUpArtifacts({
        custom: {
          agentUpArtifacts: {
            files: [{ path: "ARTIFACT/report.md", kind: "added", size: 12 }],
            truncated: true,
          },
        },
      }),
    ).toEqual({
      files: [{ path: "ARTIFACT/report.md", kind: "added", size: 12 }],
      truncated: true,
    });
  });

  it("rejects non-ARTIFACT paths", () => {
    expect(
      readAgentUpArtifacts({
        custom: {
          agentUpArtifacts: {
            files: [{ path: "WORK/draft.txt", kind: "added", size: 1 }],
          },
        },
      }),
    ).toBeNull();
  });

  it("paginates with load-more semantics", () => {
    const files = Array.from({ length: ARTIFACT_PAGE_SIZE + 2 }, (_, index) => ({
      path: `ARTIFACT/f${index}.txt`,
      kind: "added" as const,
      size: index,
    }));
    expect(paginateArtifacts(files, ARTIFACT_PAGE_SIZE)).toEqual({
      items: files.slice(0, ARTIFACT_PAGE_SIZE),
      hasMore: true,
    });
    expect(paginateArtifacts(files, files.length).hasMore).toBe(false);
  });

  it("formatArtifactCountBadge", () => {
    expect(formatArtifactCountBadge(1)).toBe("1");
    expect(formatArtifactCountBadge(9)).toBe("9");
    expect(formatArtifactCountBadge(99)).toBe("9+");
  });

  // 群 complete_group_task / 单聊 deliver_artifacts：确认清单投影成面板差分。
  it("projects confirmed task paths into an ARTIFACT-only panel", () => {
    expect(
      confirmedArtifactsPanel([
        { path: "ARTIFACT/from-Cody-t1/index.html", size: 208 },
        { path: "WORK/from-Cody-t1/scratch.js", size: 10 },
        { path: "ARTIFACT/from-Cody-t1/DELIVERY.md", size: 40 },
      ]),
    ).toEqual({
      files: [
        { path: "ARTIFACT/from-Cody-t1/index.html", kind: "added", size: 208 },
        { path: "ARTIFACT/from-Cody-t1/DELIVERY.md", kind: "added", size: 40 },
      ],
    });
    expect(confirmedArtifactsPanel([{ path: "WORK/only.txt", size: 1 }])).toBeNull();
    expect(confirmedArtifactsPanel([])).toBeNull();
  });

  it("attaches confirmed artifacts onto the latest assistant without clobbering existing panels", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "done", state: "done" }],
      },
    ] as UIMessage[];

    const attached = attachConfirmedArtifactsToMessages(messages, [
      { path: "ARTIFACT/demo/index.html", size: 12 },
    ]);
    expect(readAgentUpArtifacts(attached[1]?.metadata)).toEqual({
      files: [{ path: "ARTIFACT/demo/index.html", kind: "added", size: 12 }],
    });
    expect(buildLatestAssistantByproducts(attached, false)?.tabs.map((tab) => tab.id)).toContain(
      "artifacts",
    );

    const kept = attachConfirmedArtifactsToMessages(attached, [
      { path: "ARTIFACT/other.md", size: 1 },
    ]);
    expect(readAgentUpArtifacts(kept[1]?.metadata)?.files[0]?.path).toBe(
      "ARTIFACT/demo/index.html",
    );
  });

  it("routes group task previews to the shared group workspace", () => {
    expect(
      delegationWorkspaceAgentId({ groupId: "nM3xyWhS", toAgentId: "6HhyiCvG" }),
    ).toBe("group:nM3xyWhS");
    expect(delegationWorkspaceAgentId({ toAgentId: "6HhyiCvG" })).toBe("6HhyiCvG");
  });
});
