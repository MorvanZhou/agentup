import { describe, expect, it } from "vitest";

import {
  extractLocalPathCandidates,
  injectLocalPathMarkdownLinks,
  localPathChipLabel,
  normalizeLocalPathCandidate,
} from "../../src/shared/model/markdown/local-path.js";
import { workspacePackagePathCandidates } from "../../src/pages/conversation/model/workspace/workspace-path-resolve.js";

describe("extractLocalPathCandidates", () => {
  it("picks relative paths with extension and ./ prefix", () => {
    expect(extractLocalPathCandidates("见 src/foo.ts 与 ./docs/a.md")).toEqual([
      "src/foo.ts",
      "./docs/a.md",
    ]);
  });

  it("picks posix and windows absolute paths and file://", () => {
    const hits = extractLocalPathCandidates(
      "开 /Users/me/proj/a.md 或 C:\\Users\\me\\a.txt 以及 file:///tmp/x.png",
    );
    expect(hits).toContain("/Users/me/proj/a.md");
    expect(hits).toContain("C:\\Users\\me\\a.txt");
    expect(hits).toContain("file:///tmp/x.png");
  });

  it("picks path-only inline code and markdown hrefs", () => {
    expect(extractLocalPathCandidates("看 `ARTIFACT/out.md` 与 [x](./note.md)")).toEqual([
      "ARTIFACT/out.md",
      "./note.md",
    ]);
  });

  it("skips urls, bare words, and/or, versions, and fenced code", () => {
    const text = [
      "https://example.com/a.md and/or 1.2.3 word",
      "```",
      "src/secret.ts",
      "```",
      "ok",
    ].join("\n");
    expect(extractLocalPathCandidates(text)).toEqual([]);
  });

  it("skips bare file:// protocol mentions (inline code or prose)", () => {
    expect(extractLocalPathCandidates("无头 Chrome 以 `file://` 直接打开")).toEqual([]);
    expect(extractLocalPathCandidates("协议是 file:// 不是路径")).toEqual([]);
    expect(extractLocalPathCandidates("空壳 file:/// 也不算")).toEqual([]);
  });

  it("picks file:// + path after Chinese punctuation boundaries", () => {
    const hits = extractLocalPathCandidates(
      "## 验证证据（Chrome headless，file:///Users/me/a/index.html）",
    );
    expect(hits).toContain("file:///Users/me/a/index.html");
    expect(
      extractLocalPathCandidates("双击 WORK/from-cody/index.html（file:// 直接打开）"),
    ).toContain("WORK/from-cody/index.html");
  });

  it("picks file:// relative package paths (two slashes, no host)", () => {
    expect(extractLocalPathCandidates("`file://WORK/a/index.html`")).toContain(
      "file://WORK/a/index.html",
    );
    expect(
      extractLocalPathCandidates("打开 file://css/style.css 验收"),
    ).toContain("file://css/style.css");
  });

  it("dedupes and caps at 32", () => {
    const many = Array.from({ length: 40 }, (_, i) => `dir/f${i}.ts`).join(" ");
    expect(extractLocalPathCandidates(many)).toHaveLength(32);
    expect(extractLocalPathCandidates("a/b.ts a/b.ts")).toEqual(["a/b.ts"]);
  });
});

describe("normalizeLocalPathCandidate", () => {
  it("strips file:// and ./ and unifies slashes for relative", () => {
    expect(normalizeLocalPathCandidate("file:///tmp/a.md")).toEqual({
      kind: "absolute",
      path: "/tmp/a.md",
    });
    expect(normalizeLocalPathCandidate("./src/a.ts")).toEqual({
      kind: "relative",
      path: "src/a.ts",
    });
    expect(normalizeLocalPathCandidate("src\\b.ts")).toEqual({
      kind: "relative",
      path: "src/b.ts",
    });
  });

  it("treats file://WORK/... as relative (勿把首段当 URL host 吞掉)", () => {
    expect(normalizeLocalPathCandidate("file://WORK/a/index.html")).toEqual({
      kind: "relative",
      path: "WORK/a/index.html",
    });
    expect(normalizeLocalPathCandidate("file://css/style.css")).toEqual({
      kind: "relative",
      path: "css/style.css",
    });
  });

  it("rejects bare file:// / file:/// (URL pathname 会落成 /，勿当根目录链)", () => {
    expect(normalizeLocalPathCandidate("file://")).toBeNull();
    expect(normalizeLocalPathCandidate("file:///")).toBeNull();
  });
});

describe("localPathChipLabel", () => {
  it("uses basename for chip visible text", () => {
    expect(localPathChipLabel({ kind: "relative", path: "css/style.css" })).toBe("style.css");
    expect(localPathChipLabel({ kind: "absolute", path: "/tmp/a/index.html" })).toBe("index.html");
  });
});

describe("injectLocalPathMarkdownLinks", () => {
  it("chips with basename label and keeps full path in href", () => {
    const injected = injectLocalPathMarkdownLinks("见 css/style.css");
    expect(injected).toContain("[style.css](agentup-local:relative:css%2Fstyle.css)");
  });
});

describe("workspacePackagePathCandidates", () => {
  it("expands package-relative paths under WORK/ARTIFACT children", () => {
    expect(
      workspacePackagePathCandidates("css/style.css", [
        { root: "ARTIFACT", children: ["from-Cody-oYG8EFQY"] },
        { root: "WORK", children: ["from-cody-beatbox"] },
      ]),
    ).toEqual([
      "ARTIFACT/from-Cody-oYG8EFQY/css/style.css",
      "WORK/from-cody-beatbox/css/style.css",
    ]);
  });

  it("skips already workspace-rooted paths", () => {
    expect(
      workspacePackagePathCandidates("WORK/from-cody/css/style.css", [
        { root: "WORK", children: ["from-cody"] },
      ]),
    ).toEqual([]);
  });
});
