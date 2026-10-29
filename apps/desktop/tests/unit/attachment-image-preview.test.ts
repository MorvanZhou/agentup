// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAttachmentImagePreviewCache,
  getCachedAttachmentImagePreview,
  isImageAttachmentPath,
  loadAttachmentImagePreview,
} from "../../src/pages/conversation/model/composer/attachment-image-preview";
import { createFileChipDom } from "../../src/pages/conversation/model/composer/file-chip-dom";
import FileChip from "../../src/pages/conversation/components/chat-main/shared/thread/composer/chips/FileChip.vue";
import { mountView } from "./mount-view";

describe("attachment image preview", () => {
  beforeEach(() => {
    clearAttachmentImagePreviewCache();
  });

  it("flags image paths by extension only", () => {
    expect(isImageAttachmentPath("ATTACHMENTS/photo_94319ddb.png")).toBe(true);
    expect(isImageAttachmentPath("ATTACHMENTS/pic_a1b2c3d4.jpeg")).toBe(true);
    expect(isImageAttachmentPath("ATTACHMENTS/shot_11223344.gif")).toBe(true);
    expect(isImageAttachmentPath("ATTACHMENTS/card_55667788.webp")).toBe(true);
    expect(isImageAttachmentPath("ATTACHMENTS/note_11223344.txt")).toBe(false);
    expect(isImageAttachmentPath("ATTACHMENTS/report_11223344.docx")).toBe(false);
  });

  it("loads image attachments as data URLs", async () => {
    const api = {
      readWorkspaceFile: async () => ({
        path: "ATTACHMENTS/photo_94319ddb.png",
        kind: "image" as const,
        size: 9,
        mediaType: "image/png",
        dataBase64: "x9m=",
      }),
    };
    const url = await loadAttachmentImagePreview({
      api,
      token: "t",
      userId: "u",
      agentId: "group:g1",
      personal: false,
      path: "ATTACHMENTS/photo_94319ddb.png",
    });
    expect(url).toBe("data:image/png;base64,x9m=");
  });

  it("returns null for binary, oversized, and failed reads", async () => {
    const binary = await loadAttachmentImagePreview({
      api: { readWorkspaceFile: async () => ({ path: "p", kind: "binary", size: 9 }) },
      token: "t",
      userId: "u",
      agentId: "a",
      personal: false,
      path: "ATTACHMENTS/x.png",
    });
    expect(binary).toBeNull();

    const tooLarge = await loadAttachmentImagePreview({
      api: {
        readWorkspaceFile: async () => ({ path: "p", kind: "too-large", size: 9, media: "image" as const }),
      },
      token: "t",
      userId: "u",
      agentId: "a",
      personal: false,
      path: "ATTACHMENTS/y.png",
    });
    expect(tooLarge).toBeNull();

    const failed = await loadAttachmentImagePreview({
      api: {
        readWorkspaceFile: async () => {
          throw new Error("offline");
        },
      },
      token: "t",
      userId: "u",
      agentId: "a",
      personal: false,
      path: "ATTACHMENTS/z.png",
    });
    expect(failed).toBeNull();
  });

  it("caches per path so repeated renders do not re-fetch", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: "p",
      kind: "image" as const,
      size: 9,
      mediaType: "image/png",
      dataBase64: "aGk=",
    }));
    const api = { readWorkspaceFile };
    const input = {
      api,
      token: "t",
      userId: "u",
      agentId: "group:g1",
      personal: false,
      path: "ATTACHMENTS/photo_94319ddb.png",
    };
    await loadAttachmentImagePreview(input);
    await loadAttachmentImagePreview(input);
    expect(readWorkspaceFile).toHaveBeenCalledTimes(1);

    // staged path 自带 8 位随机 id，不同附件路径互不共享
    await loadAttachmentImagePreview({ ...input, path: "ATTACHMENTS/photo_11223344.png" });
    expect(readWorkspaceFile).toHaveBeenCalledTimes(2);
  });

  it("exposes loaded previews synchronously for chip rendering", async () => {
    expect(getCachedAttachmentImagePreview("ATTACHMENTS/cover_94319ddb.png")).toBeNull();
    const api = {
      readWorkspaceFile: async () => ({
        path: "p",
        kind: "image" as const,
        size: 9,
        mediaType: "image/png",
        dataBase64: "aGk=",
      }),
    };
    await loadAttachmentImagePreview({
      api,
      token: "t",
      userId: "u",
      agentId: "group:g1",
      personal: false,
      path: "ATTACHMENTS/cover_94319ddb.png",
    });
    expect(getCachedAttachmentImagePreview("ATTACHMENTS/cover_94319ddb.png")).toBe(
      "data:image/png;base64,aGk=",
    );

    // 读取失败（binary 等）也会写 null：芯片同步查到 null 即保持文件图标
    await loadAttachmentImagePreview({
      api: { readWorkspaceFile: async () => ({ path: "p", kind: "binary", size: 9 }) },
      token: "t",
      userId: "u",
      agentId: "group:g1",
      personal: false,
      path: "ATTACHMENTS/cover_11223344.png",
    });
    expect(getCachedAttachmentImagePreview("ATTACHMENTS/cover_11223344.png")).toBeNull();
  });
});

describe("FileChip image thumbnail", () => {
  it("renders a thumbnail when an image data URL is provided", () => {
    const host = mountView(FileChip, {
      props: {
        name: "photo.png",
        path: "ATTACHMENTS/photo_94319ddb.png",
        variant: "on-primary",
        layout: "row",
        image: "data:image/png;base64,aGk=",
      },
    });
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,aGk=");
  });

  it("keeps the file icon when no image is provided", () => {
    const host = mountView(FileChip, {
      props: { name: "note.txt", path: "ATTACHMENTS/note_94319ddb.txt", variant: "on-primary", layout: "row" },
    });
    expect(host.querySelector("img")).toBeNull();
  });
});

describe("composer file chip dom", () => {
  it("renders a label chip without an image and wires the remove handler", () => {
    let removed = "";
    const chip = createFileChipDom("ATTACHMENTS/cover_94319ddb.png", "cover.png", {
      onRemove: (path) => {
        removed = path;
      },
    });
    expect(chip.querySelector("img")).toBeNull();
    const remove = chip.querySelector("button");
    remove?.dispatchEvent(new MouseEvent("mousedown"));
    expect(removed).toBe("ATTACHMENTS/cover_94319ddb.png");
  });
});
