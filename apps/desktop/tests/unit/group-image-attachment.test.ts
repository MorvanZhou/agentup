import { describe, expect, it, vi } from "vitest";

import {
  createGroupImageAttachmentAdapter,
  groupOutgoingText,
} from "../../src/pages/conversation/model/composer/group-image-attachment";
import type { DesktopApi } from "../../src/shared/api/runtime";
import { setToastOpen, toastState } from "../../src/shared/model/ui/toast";

function imageFile(): File {
  return {
    name: "cover.png",
    type: "image/png",
    size: 9,
    arrayBuffer: vi.fn(async () => {
      throw new Error("send 不应读取图片字节");
    }),
  } as unknown as File;
}

describe("group image attachment adapter", () => {
  it("stages on add and keeps the file for the composer preview", async () => {
    vi.stubGlobal("window", {
      agentUp: { filePathForStaging: () => "/tmp/source/cover.png" },
    });
    const stageGroupAttachmentFromPath = vi.fn(async () => ({
      id: "94319ddb",
      path: "ATTACHMENTS/cover_94319ddb.png",
      ref: "@ATTACHMENTS/cover_94319ddb.png",
      name: "cover.png",
      mediaType: "image/png",
    }));
    const api = { stageGroupAttachmentFromPath } as unknown as DesktopApi;
    const adapter = createGroupImageAttachmentAdapter({
      api,
      auth: () => ({ token: "tok", userId: "u1", groupId: "g-1" }),
    });
    const file = imageFile();
    const pending = await adapter.add({ file });

    expect(stageGroupAttachmentFromPath).toHaveBeenCalledWith(
      "tok",
      "u1",
      "g-1",
      expect.objectContaining({ path: "/tmp/source/cover.png", name: "cover.png" }),
    );
    expect(pending.id).toBe("ATTACHMENTS/cover_94319ddb.png");
    expect(pending.file).toBe(file);
    expect(pending.type).toBe("image");
  });

  it("does not read the file when completing a send", async () => {
    const file = imageFile();
    const adapter = createGroupImageAttachmentAdapter({
      api: {} as DesktopApi,
      auth: () => ({ token: "tok", userId: "u1", groupId: "g-1" }),
    });
    const complete = await adapter.send({
      id: "ATTACHMENTS/cover_94319ddb.png",
      type: "image",
      name: "cover.png",
      contentType: "image/png",
      file,
      status: { type: "requires-action", reason: "composer-send" },
    });

    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(complete.id).toBe("ATTACHMENTS/cover_94319ddb.png");
    expect(complete.status).toEqual({ type: "complete" });
  });

  it("toasts and rejects when the image cannot be staged", async () => {
    setToastOpen(false);
    const adapter = createGroupImageAttachmentAdapter({
      api: {} as DesktopApi,
      auth: () => ({ token: "", userId: "", groupId: "" }),
    });
    await expect(adapter.add({ file: imageFile() })).rejects.toThrow("尚未登录");
    expect(toastState.open).toBe(true);
    expect(toastState.message).toBe("尚未登录");
  });

  it("deletes the staged file when the preview is removed", async () => {
    const deleteGroupAttachment = vi.fn(async () => undefined);
    const adapter = createGroupImageAttachmentAdapter({
      api: { deleteGroupAttachment } as unknown as DesktopApi,
      auth: () => ({ token: "tok", userId: "u1", groupId: "g-1" }),
    });
    await adapter.remove({
      id: "ATTACHMENTS/cover_94319ddb.png",
      type: "image",
      name: "cover.png",
      contentType: "image/png",
      file: imageFile(),
      status: { type: "requires-action", reason: "composer-send" },
    });
    expect(deleteGroupAttachment).toHaveBeenCalledWith("tok", "u1", "g-1", "ATTACHMENTS/cover_94319ddb.png");
  });
});

describe("groupOutgoingText", () => {
  it("appends staged image refs that are not already in the text", () => {
    expect(groupOutgoingText("看看这个", ["ATTACHMENTS/cover_94319ddb.png"])).toBe(
      "看看这个 @ATTACHMENTS/cover_94319ddb.png",
    );
    expect(groupOutgoingText("", ["ATTACHMENTS/cover_94319ddb.png"])).toBe(
      "@ATTACHMENTS/cover_94319ddb.png",
    );
    expect(
      groupOutgoingText("已有 @ATTACHMENTS/cover_94319ddb.png", ["ATTACHMENTS/cover_94319ddb.png", "random"]),
    ).toBe("已有 @ATTACHMENTS/cover_94319ddb.png");
  });
});
