import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { formatSessionJsonl, readGroupLinesPage, readJsonlFileTail } from "../src/session/group/sessions.js";
import type { GroupLine } from "../src/session/group/types.js";

function line(id: string, text: string): GroupLine {
  return { id, at: 1, role: "user", authorId: "user", text, mentionIds: [] };
}

it("reads the newest jsonl records without parsing the file as one array", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-jsonl-"));
  const file = path.join(dir, "session.jsonl");
  const lines = [
    line("1", "最早"),
    line("2", "第二"),
    line("3", "含换行\n仍是一条"),
    line("4", "第四"),
    line("5", "最新"),
  ];
  fs.writeFileSync(file, formatSessionJsonl(lines));
  const tail = readJsonlFileTail(file, 2, 3);
  expect(tail.map((item) => item.id)).toEqual(["4", "5"]);
  expect(tail[1]?.text).toBe("最新");
  const withBreak = readJsonlFileTail(file, 3, 5);
  expect(withBreak.map((item) => item.text)).toEqual(["含换行\n仍是一条", "第四", "最新"]);
});

it("pages group lines from the newest session and does not read older files once the page is full", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-page-"));
  const older = path.join(dir, "old.jsonl");
  const newer = path.join(dir, "new.jsonl");
  fs.writeFileSync(older, "not-json\n");
  fs.writeFileSync(
    newer,
    formatSessionJsonl([line("n1", "一"), line("n2", "二"), line("n3", "三")]),
  );
  const first = readGroupLinesPage(
    [
      { id: "old", path: older },
      { id: "new", path: newer },
    ],
    { limit: 2 },
    8,
  );
  expect(first.lines.map((item) => item.id)).toEqual(["n2", "n3"]);
  expect(first.hasMore).toBe(true);

  const olderLines = [line("o1", "旧一"), line("o2", "旧二")];
  fs.writeFileSync(older, formatSessionJsonl(olderLines));
  const beforeNewest = readGroupLinesPage(
    [
      { id: "old", path: older },
      { id: "new", path: newer },
    ],
    { limit: 2, beforeId: "n2" },
  );
  expect(beforeNewest.lines.map((item) => item.id)).toEqual(["context-reset-new", "n1"]);
  expect(beforeNewest.hasMore).toBe(true);

  const rest = readGroupLinesPage(
    [
      { id: "old", path: older },
      { id: "new", path: newer },
    ],
    { limit: 10, beforeId: "context-reset-new" },
  );
  expect(rest.lines.map((item) => item.id)).toEqual(["o1", "o2"]);
  expect(rest.hasMore).toBe(false);
});
