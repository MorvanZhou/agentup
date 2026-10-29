import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES } from "../../../runtime/src/session/workspace/media";
import {
  MAX_INLINE_IMAGE_BYTES,
  inlineImageExceedsLimit,
} from "../../src/pages/conversation/model/composer/inline-image-limit";

describe("inline image limit", () => {
  it("uses the runtime inline file budget", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBe(MAX_ATTACHMENT_BYTES);
  });

  it("flags images over the 15MB runtime attachment limit", () => {
    // inline 图片随 prompt body 走 base64，超过 runtime 15MB 上限时发送必失败：
    // 必须在拖入/粘贴那一刻拦下，而不是等用户点发送。
    expect(inlineImageExceedsLimit({ size: MAX_INLINE_IMAGE_BYTES + 1 })).toBe(true);
  });

  it("allows images at or below the limit", () => {
    expect(inlineImageExceedsLimit({ size: 0 })).toBe(false);
    expect(inlineImageExceedsLimit({ size: 2 * 1024 * 1024 })).toBe(false);
    expect(inlineImageExceedsLimit({ size: MAX_INLINE_IMAGE_BYTES })).toBe(false);
  });
});
