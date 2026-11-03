import { describe, expect, it } from "vitest";

import { localPathIconHtml } from "../../src/shared/model/markdown/path-icon.js";

describe("localPathIconHtml", () => {
  it("picks lucide-style icons by extension and folder trailing slash", () => {
    expect(localPathIconHtml("src/a.ts")).toContain("aui-md-path-icon");
    expect(localPathIconHtml("docs/a.md")).toContain("M10 9H8"); // FileText 特征 path
    expect(localPathIconHtml("shot.png")).toContain("circle"); // FileImage
    expect(localPathIconHtml("ARTIFACT/")).toContain("M20 20a2"); // Folder
    expect(localPathIconHtml("weird")).toContain("M15 2H6"); // File 默认
  });
});
