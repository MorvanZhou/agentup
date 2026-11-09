import { describe, expect, it } from "vitest";

import { deliverableFileIcon } from "../../src/pages/conversation/model/message/deliverable-icon";
import {
  deliverableFileName,
  parseAgentUpDeliverables,
  readAgentUpDeliverables,
} from "../../src/pages/conversation/model/message/message-deliverables";

describe("message-deliverables", () => {
  it("reads agentUpDeliverables from metadata.custom", () => {
    expect(
      readAgentUpDeliverables({
        custom: {
          agentUpDeliverables: {
            files: [{ path: "ARTIFACT/from-Spec/a.md", size: 12 }],
            curated: true,
          },
        },
      }),
    ).toEqual({
      files: [{ path: "ARTIFACT/from-Spec/a.md", size: 12 }],
      curated: true,
    });
  });

  it("rejects non-ARTIFACT paths and empty non-curated", () => {
    expect(
      parseAgentUpDeliverables({
        files: [{ path: "WORK/draft.txt", size: 1 }],
      }),
    ).toBeNull();
    expect(parseAgentUpDeliverables({ files: [] })).toBeNull();
    expect(parseAgentUpDeliverables({ files: [], curated: true })).toEqual({
      files: [],
      curated: true,
    });
  });

  it("deliverableFileName takes the last segment", () => {
    expect(deliverableFileName("ARTIFACT/from-Spec/report.md")).toBe("report.md");
  });

  it("deliverableFileIcon picks typed icons by extension", () => {
    expect(deliverableFileIcon("ARTIFACT/a.md")).toBeTruthy();
    expect(deliverableFileIcon("ARTIFACT/a.ts")).toBeTruthy();
    expect(deliverableFileIcon("ARTIFACT/a.zip")).toBeTruthy();
    expect(deliverableFileIcon("ARTIFACT/a.unknown")).toBeTruthy();
  });
});
