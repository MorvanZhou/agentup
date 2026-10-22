import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  diffArtifactSnapshots,
  parseArtifactsEntryData,
  snapshotArtifactDir,
} from "../src/session/workspace/artifact-diff.js";

function tempCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-artifact-"));
  fs.mkdirSync(path.join(root, "ARTIFACT"), { recursive: true });
  return root;
}

it("snapshotArtifactDir walks nested files and skips symlinks", () => {
  const cwd = tempCwd();
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "a.txt"), "hello");
  fs.mkdirSync(path.join(cwd, "ARTIFACT", "sub"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "sub", "b.md"), "world");
  fs.symlinkSync(path.join(cwd, "ARTIFACT", "a.txt"), path.join(cwd, "ARTIFACT", "link.txt"));

  const snap = snapshotArtifactDir(cwd);
  expect([...snap.keys()].sort()).toEqual(["ARTIFACT/a.txt", "ARTIFACT/sub/b.md"]);
  expect(snap.get("ARTIFACT/a.txt")?.size).toBe(5);
});

it("diffArtifactSnapshots detects added modified deleted", () => {
  const before = new Map([
    ["ARTIFACT/keep.txt", { path: "ARTIFACT/keep.txt", size: 1, mtimeMs: 10 }],
    ["ARTIFACT/old.txt", { path: "ARTIFACT/old.txt", size: 2, mtimeMs: 20 }],
    ["ARTIFACT/touch.txt", { path: "ARTIFACT/touch.txt", size: 3, mtimeMs: 30 }],
  ]);
  const after = new Map([
    ["ARTIFACT/keep.txt", { path: "ARTIFACT/keep.txt", size: 1, mtimeMs: 10 }],
    ["ARTIFACT/touch.txt", { path: "ARTIFACT/touch.txt", size: 4, mtimeMs: 40 }],
    ["ARTIFACT/new.txt", { path: "ARTIFACT/new.txt", size: 5, mtimeMs: 50 }],
  ]);

  expect(diffArtifactSnapshots(before, after)).toEqual({
    files: [
      { path: "ARTIFACT/new.txt", kind: "added", size: 5 },
      { path: "ARTIFACT/touch.txt", kind: "modified", size: 4 },
      { path: "ARTIFACT/old.txt", kind: "deleted" },
    ],
  });
});

it("diffArtifactSnapshots truncates over limit", () => {
  const before = new Map<string, { path: string; size: number; mtimeMs: number }>();
  const after = new Map<string, { path: string; size: number; mtimeMs: number }>();
  for (let index = 0; index < 5; index += 1) {
    const filePath = `ARTIFACT/f${index}.txt`;
    after.set(filePath, { path: filePath, size: index, mtimeMs: index });
  }
  const diff = diffArtifactSnapshots(before, after, 2);
  expect(diff.files).toHaveLength(2);
  expect(diff.truncated).toBe(true);
});

it("parseArtifactsEntryData validates ARTIFACT paths", () => {
  expect(
    parseArtifactsEntryData({
      files: [
        { path: "ARTIFACT/a.txt", kind: "added", size: 1 },
        { path: "WORK/x.txt", kind: "added", size: 1 },
        { path: "ARTIFACT/b.txt", kind: "nope" },
      ],
    }),
  ).toEqual({
    files: [{ path: "ARTIFACT/a.txt", kind: "added", size: 1 }],
  });
  expect(parseArtifactsEntryData({ files: [] })).toBeUndefined();
});
