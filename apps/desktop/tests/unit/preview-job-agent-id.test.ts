import { expect, it } from "vitest";

import { previewJobAgentId } from "../../src/pages/conversation/model/group/group-view";
import type { GroupRoomView } from "../../src/pages/conversation/model/group/group-view";

function room(partial: Partial<GroupRoomView> & Pick<GroupRoomView, "members">): GroupRoomView {
  return {
    id: "g1",
    title: "开发小队",
    holderId: null,
    defaultHolderId: "",
    holderSpeaking: false,
    lines: [],
    pendingDelegations: [],
    queue: [],
    taskIds: [],
    ...partial,
  } as GroupRoomView;
}

it("空闲 holderId 时回落 defaultHolderId", () => {
  expect(
    previewJobAgentId(
      room({
        holderId: null,
        defaultHolderId: "LirKF0D4",
        members: [
          { agentId: "LirKF0D4", name: "PM" },
          { agentId: "Cody", name: "Dev" },
        ],
      }),
    ),
  ).toBe("LirKF0D4");
});

it("有 live holderId 时优先用它", () => {
  expect(
    previewJobAgentId(
      room({
        holderId: "Cody",
        defaultHolderId: "LirKF0D4",
        members: [
          { agentId: "LirKF0D4", name: "PM" },
          { agentId: "Cody", name: "Dev" },
        ],
      }),
    ),
  ).toBe("Cody");
});

it("都空时回落名单首位", () => {
  expect(
    previewJobAgentId(
      room({
        holderId: null,
        defaultHolderId: "",
        members: [{ agentId: "first", name: "A" }],
      }),
    ),
  ).toBe("first");
});
