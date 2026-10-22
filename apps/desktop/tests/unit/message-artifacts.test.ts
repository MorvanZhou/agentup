import { describe, expect, it } from "vitest";

import {
  ARTIFACT_PAGE_SIZE,
  formatArtifactCountBadge,
  paginateArtifacts,
  readAgentUpArtifacts,
} from "../../src/pages/conversation/model/message/message-artifacts";

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
});
