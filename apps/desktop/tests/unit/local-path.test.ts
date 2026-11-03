import { describe, expect, it } from "vitest";

import {
  extractLocalPathCandidates,
  normalizeLocalPathCandidate,
} from "../../src/shared/model/markdown/local-path.js";

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
});
