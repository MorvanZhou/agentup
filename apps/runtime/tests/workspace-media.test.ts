import { expect, it } from "vitest";

import {
  HTML_EXTENSIONS,
  IMAGE_PREVIEW_LIMIT,
  MARKDOWN_EXTENSIONS,
  MAX_ATTACHMENT_BODY_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  TEXT_EXTENSIONS,
} from "../src/session/workspace/media.js";

it("keeps in-app preview, attachment staging, and the desktop check on one budget", () => {
  expect(IMAGE_PREVIEW_LIMIT).toBe(MAX_ATTACHMENT_BYTES);
  expect(MAX_INLINE_IMAGE_BYTES).toBe(MAX_ATTACHMENT_BYTES);
  // 15MB 的 base64 是 20MB，再留 2MB JSON 余量 = 22MB body 闸
  expect(MAX_ATTACHMENT_BODY_BYTES).toBe(22 * 1024 * 1024);
  for (const ext of [...HTML_EXTENSIONS, ...MARKDOWN_EXTENSIONS]) {
    expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
  }
});
