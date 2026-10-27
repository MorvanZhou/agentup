import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { createFsGuardExtension } from "../src/session/tools/fs-guard.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

it("reads a png as an image block and a text file as text", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-read-image-"));
  fs.writeFileSync(path.join(cwd, "shot.png"), PNG);
  fs.writeFileSync(path.join(cwd, "note.txt"), "hello\n");

  let execute:
    | ((
        id: string,
        params: { path: string; offset?: number; limit?: number },
      ) => Promise<{ content: Array<{ type: string; text?: string; mimeType?: string; data?: string }> }>)
    | undefined;
  await createFsGuardExtension(cwd, () => [cwd])({
    registerTool(tool: { name: string; execute: NonNullable<typeof execute> }) {
      if (tool.name === "read") execute = tool.execute;
    },
  } as unknown as ExtensionAPI);

  const image = await execute!("call-img", { path: "shot.png", offset: 150, limit: 60 });
  const textBlock = image.content.find((part) => part.type === "text");
  const imageBlock = image.content.find((part) => part.type === "image");
  expect(textBlock?.text).toMatch(/Read image file \[image\/png\]/);
  expect(imageBlock).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(imageBlock?.data && imageBlock.data.length > 0).toBe(true);
  expect(textBlock?.text).not.toContain("\u0000");

  const text = await execute!("call-txt", { path: "note.txt" });
  expect(text.content).toEqual([{ type: "text", text: "hello\n" }]);
});
