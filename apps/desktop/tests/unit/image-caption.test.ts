import { describe, expect, it } from "vitest";

import { stripSyntheticImageCaption } from "../../src/pages/conversation/model/composer/image-caption";

const CAPTION =
  "[Image: original 5112x2314, displayed at 2000x905. Multiply coordinates by 2.56 to map to original image.]";

describe("stripSyntheticImageCaption", () => {
  it("drops the synthetic image caption and keeps the user's text", () => {
    expect(stripSyntheticImageCaption(`这个文件名是什么\n\n${CAPTION}`)).toBe("这个文件名是什么");
  });

  it("leaves ordinary text unchanged, including trailing spaces", () => {
    expect(stripSyntheticImageCaption("这个文件名是什么 ")).toBe("这个文件名是什么 ");
  });

  it("does not treat a normal bracket note as a caption", () => {
    expect(stripSyntheticImageCaption("看 [Image: cover.png] 这张")).toBe("看 [Image: cover.png] 这张");
  });
});
