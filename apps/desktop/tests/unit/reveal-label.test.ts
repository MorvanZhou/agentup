import { describe, expect, it } from "vitest";

import { revealInFolderLabel } from "../../src/shared/model/ui/reveal-in-folder.js";

describe("revealInFolderLabel", () => {
  it("maps platform to localized label", () => {
    expect(revealInFolderLabel("darwin")).toBe("在 Finder 中显示");
    expect(revealInFolderLabel("win32")).toBe("在资源管理器中显示");
    expect(revealInFolderLabel("linux")).toBe("在文件管理器中显示");
    expect(revealInFolderLabel("freebsd")).toBe("在文件管理器中显示");
  });
});
