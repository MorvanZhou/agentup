import { describe, expect, it } from "vitest";

import {
  clampPreviewScale,
  formatPreviewScale,
  nextPreviewScale,
  wheelPreviewScale,
} from "../../src/shared/model/preview/image-preview.js";
import { svgMarkupToDataUrl } from "../../src/shared/model/preview/svg-image.js";

describe("image-preview scale helpers", () => {
  it("clamps and steps scale", () => {
    expect(clampPreviewScale(0)).toBe(0.25);
    expect(clampPreviewScale(9)).toBe(5);
    expect(nextPreviewScale(1, 1)).toBe(1.25);
    expect(nextPreviewScale(0.25, -1)).toBe(0.25);
    expect(wheelPreviewScale(1, 100)).toBe(0.75);
    expect(wheelPreviewScale(1, -100)).toBe(1.25);
    expect(formatPreviewScale(1.25)).toBe("125%");
  });
});

describe("svgMarkupToDataUrl", () => {
  it("adds xmlns and encodes svg markup", () => {
    const url = svgMarkupToDataUrl('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(decoded).toContain("<circle");
  });

  it("replaces width=100% with viewBox size for img intrinsic sizing", () => {
    const url = svgMarkupToDataUrl(
      '<svg width="100%" viewBox="4 4 360 64" xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    const decoded = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(decoded).toContain('width="360"');
    expect(decoded).toContain('height="64"');
    expect(decoded).not.toContain('width="100%"');
  });
});
