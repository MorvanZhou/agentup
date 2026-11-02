import type { PendingAttachment } from "@assistant-ui/core";
import { describe, expect, it } from "vitest";

import { createInlineImageAttachmentAdapter } from "../../src/pages/conversation/model/composer/inline-image-attachment";
import { MAX_INLINE_IMAGE_BYTES } from "../../src/pages/conversation/model/composer/inline-image-limit";
import { setToastOpen, toastState } from "../../src/shared/model/ui/toast";

/** add 的声明同时允许异步生成器；限额内应直接得到待发送附件。 */
function asPending(
  value: PendingAttachment | AsyncGenerator<PendingAttachment, void>,
): PendingAttachment {
  if (typeof value !== "object" || value === null || Symbol.asyncIterator in value) {
    throw new Error("expected a pending attachment");
  }
  return value;
}

function image(size: number): File {
  return { name: "shot.png", type: "image/png", size } as File;
}

describe("inline image attachment adapter", () => {
  it("rejects an oversized image before it can be sent inline", async () => {
    setToastOpen(false);
    const adapter = createInlineImageAttachmentAdapter();
    await expect(adapter.add({ file: image(MAX_INLINE_IMAGE_BYTES + 1) })).rejects.toThrow(/15MB/);
    expect(toastState.open).toBe(true);
    expect(toastState.tone).toBe("error");
  });

  it("accepts an image within the limit onto the composer strip", async () => {
    const adapter = createInlineImageAttachmentAdapter();
    const file = image(1024);
    const pending = asPending(await adapter.add({ file }));
    expect(pending.type).toBe("image");
    expect(pending.file).toBe(file);
    expect(pending.status.type).toBe("requires-action");
  });
});
