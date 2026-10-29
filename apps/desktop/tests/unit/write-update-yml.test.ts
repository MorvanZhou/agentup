import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  serializeUpdateInfo,
  writeUpdateYml,
} = require("../../electron/write-update-yml.cjs") as {
  serializeUpdateInfo: (info: {
    version: string;
    files: Array<{ url: string; sha512: string; size: number }>;
    releaseDate?: string;
  }) => string;
  writeUpdateYml: (opts: {
    version: string;
    outFile: string;
    entries: Array<{ url: string; filePath: string }>;
    releaseDate?: string;
  }) => { outFile: string; info: { files: Array<{ url: string; sha512: string; size: number }> } };
};

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("write-update-yml", () => {
  it("序列化字段对齐 electron-updater（zip 作 path/sha512）", () => {
    const body = serializeUpdateInfo({
      version: "0.1.8",
      releaseDate: "2026-10-29T04:00:00.000Z",
      files: [
        { url: "AgentUp-arm64-mac.zip", sha512: "AAA", size: 10 },
        { url: "AgentUp-arm64.dmg", sha512: "BBB", size: 20 },
      ],
    });
    expect(body).toBe(
      [
        "version: 0.1.8",
        "files:",
        "  - url: AgentUp-arm64-mac.zip",
        "    sha512: AAA",
        "    size: 10",
        "  - url: AgentUp-arm64.dmg",
        "    sha512: BBB",
        "    size: 20",
        "path: AgentUp-arm64-mac.zip",
        "sha512: AAA",
        "releaseDate: '2026-10-29T04:00:00.000Z'",
        "",
      ].join("\n"),
    );
  });

  it("按文件内容写出 sha512 base64", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentup-update-yml-"));
    temps.push(dir);
    const zipPath = join(dir, "a.zip");
    const payload = Buffer.from("agentup-update-fixture");
    writeFileSync(zipPath, payload);
    const outFile = join(dir, "latest-mac.yml");
    writeUpdateYml({
      version: "1.2.3",
      outFile,
      releaseDate: "2026-01-02T03:04:05.000Z",
      entries: [{ url: "AgentUp-arm64-mac.zip", filePath: zipPath }],
    });
    const expected = createHash("sha512").update(payload).digest("base64");
    const text = readFileSync(outFile, "utf8");
    expect(text).toContain(`sha512: ${expected}`);
    expect(text).toContain(`size: ${payload.length}`);
    expect(text).toContain("version: 1.2.3");
  });
});
