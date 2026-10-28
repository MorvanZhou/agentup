import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { createFsGuardExtension } from "../src/session/tools/fs-guard.js";
import { describeImageWithRegistry, pickVisionModel } from "../src/session/tools/read-image.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const OMIT_NOTE = "[Current model does not support images. The image will be omitted from this request.]";

type ReadContent = { type: string; text?: string; mimeType?: string; data?: string };
type ReadParams = { path: string; offset?: number; limit?: number; question?: string };
type ReadModel = { id: string; provider: string; input: Array<"text" | "image"> };
type DescribeImage = (input: {
  data: string;
  mimeType: string;
  question?: string;
  signal?: AbortSignal;
}) => Promise<string>;

const textModel: ReadModel = { id: "glm-5.3", provider: "volcengine-ark", input: ["text"] };
const visionModel: ReadModel = { id: "kimi-k2.6", provider: "volcengine-ark", input: ["text", "image"] };

async function loadRead(options?: { describeImage?: DescribeImage }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-read-image-"));
  fs.writeFileSync(path.join(cwd, "shot.png"), PNG);
  fs.writeFileSync(path.join(cwd, "note.txt"), "hello\n");
  let execute:
    | ((
        id: string,
        params: ReadParams,
        signal?: AbortSignal,
        onUpdate?: undefined,
        ctx?: { model?: ReadModel },
      ) => Promise<{ content: ReadContent[] }>)
    | undefined;
  let parameters: { properties?: Record<string, unknown> } | undefined;
  await createFsGuardExtension(cwd, () => [cwd], options)({
    registerTool(tool: {
      name: string;
      execute: NonNullable<typeof execute>;
      parameters: { properties?: Record<string, unknown> };
    }) {
      if (tool.name !== "read") return;
      execute = tool.execute;
      parameters = tool.parameters;
    },
  } as unknown as ExtensionAPI);
  return {
    execute: execute!,
    parameters: parameters!,
  };
}

function textOf(content: ReadContent[]): string {
  return content.find((part) => part.type === "text")?.text ?? "";
}

it("reads a png as an image block and a text file as text", async () => {
  const { execute } = await loadRead();

  const image = await execute("call-img", { path: "shot.png", offset: 150, limit: 60 });
  const textBlock = image.content.find((part) => part.type === "text");
  const imageBlock = image.content.find((part) => part.type === "image");
  expect(textBlock?.text).toMatch(/Read image file \[image\/png\]/);
  expect(imageBlock).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(imageBlock?.data && imageBlock.data.length > 0).toBe(true);
  expect(textBlock?.text).not.toContain("\u0000");
  expect(textBlock?.text).not.toContain(OMIT_NOTE);

  const text = await execute("call-txt", { path: "note.txt" });
  expect(text.content).toEqual([{ type: "text", text: "hello\n" }]);
});

it("replaces the omit note with a caption for text-only models and keeps the image block", async () => {
  const seen: Array<{ mimeType: string; question?: string; data: string }> = [];
  const { execute, parameters } = await loadRead({
    describeImage: async (input) => {
      seen.push(input);
      return "a one-pixel png";
    },
  });
  expect(parameters.properties?.question).toBeTruthy();

  const image = await execute(
    "call-img",
    { path: "shot.png", question: "what is in the file?" },
    undefined,
    undefined,
    { model: textModel },
  );
  const note = textOf(image.content);
  expect(note).toMatch(/Read image file \[image\/png\]/);
  expect(note).toContain("a one-pixel png");
  expect(note).not.toContain(OMIT_NOTE);
  expect(image.content.find((part) => part.type === "image")).toMatchObject({
    type: "image",
    mimeType: "image/png",
  });
  expect(seen).toEqual([
    expect.objectContaining({ mimeType: "image/png", question: "what is in the file?" }),
  ]);
  expect(seen[0]?.data.length).toBeGreaterThan(0);
});

it("keeps the omit note when a text-only model has no captioner", async () => {
  const { execute } = await loadRead();
  const image = await execute("call-img", { path: "shot.png" }, undefined, undefined, { model: textModel });
  expect(textOf(image.content)).toContain(OMIT_NOTE);
  expect(image.content.find((part) => part.type === "image")?.mimeType).toBe("image/png");
});

it("does not caption when the current model accepts images", async () => {
  let called = false;
  const { execute } = await loadRead({
    describeImage: async () => {
      called = true;
      return "should not be used";
    },
  });
  const image = await execute("call-img", { path: "shot.png", question: "color?" }, undefined, undefined, {
    model: visionModel,
  });
  expect(called).toBe(false);
  expect(textOf(image.content)).toMatch(/Read image file \[image\/png\]/);
  expect(textOf(image.content)).not.toContain("should not be used");
  expect(textOf(image.content)).not.toContain(OMIT_NOTE);
});

it("leaves text files unchanged when question is set on a text-only model", async () => {
  let called = false;
  const { execute } = await loadRead({
    describeImage: async () => {
      called = true;
      return "caption";
    },
  });
  const text = await execute("call-txt", { path: "note.txt", question: "summarize" }, undefined, undefined, {
    model: textModel,
  });
  expect(called).toBe(false);
  expect(text.content).toEqual([{ type: "text", text: "hello\n" }]);
});

it("keeps the omit note when captioning throws", async () => {
  const { execute } = await loadRead({
    describeImage: async () => {
      throw new Error("vision down");
    },
  });
  const image = await execute("call-img", { path: "shot.png" }, undefined, undefined, { model: textModel });
  expect(textOf(image.content)).toContain(OMIT_NOTE);
  expect(image.content.some((part) => part.type === "image")).toBe(true);
});

it("picks another image-capable model on the same provider", () => {
  const models = [
    { id: "glm-5.3", provider: "volcengine-ark", input: ["text"] as const },
    { id: "kimi-k2.7-code", provider: "volcengine-ark", input: ["text", "image"] as const },
    { id: "kimi-k2.6", provider: "other", input: ["text", "image"] as const },
    { id: "minimax-m3", provider: "volcengine-ark", input: ["text", "image"] as const },
  ];
  expect(pickVisionModel(models, { id: "glm-5.3", provider: "volcengine-ark" })?.id).toBe("kimi-k2.7-code");
  expect(pickVisionModel(models, { id: "kimi-k2.7-code", provider: "volcengine-ark" })?.id).toBe("minimax-m3");
  expect(pickVisionModel(models, { id: "text-only", provider: "lonely" })).toBeUndefined();
});

it("captions with the picked model and treats a failed call as no description", async () => {
  const models = [
    { id: "glm-5.3", provider: "volcengine-ark", input: ["text"] as const },
    { id: "kimi-k2.7-code", provider: "volcengine-ark", input: ["text", "image"] as const },
  ];
  const described = await describeImageWithRegistry({
    models,
    current: models[0]!,
    image: { data: "abc", mimeType: "image/png" },
    question: "any text?",
    complete: async (model, context, options) => {
      expect(model.id).toBe("kimi-k2.7-code");
      expect(options?.timeoutMs).toBe(60_000);
      const content = context.messages[0]?.content;
      expect(Array.isArray(content)).toBe(true);
      if (!Array.isArray(content)) return { stopReason: "error", content: [] };
      expect(content).toEqual([
        { type: "text", text: "any text?" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ]);
      return { stopReason: "stop", content: [{ type: "text", text: "hello sign" }] };
    },
  });
  expect(described).toBe("hello sign");

  const failed = await describeImageWithRegistry({
    models,
    current: models[0]!,
    image: { data: "abc", mimeType: "image/png" },
    complete: async () => {
      throw new Error("no access");
    },
  });
  expect(failed).toBeUndefined();

  const missing = await describeImageWithRegistry({
    models: [models[0]!],
    current: models[0]!,
    image: { data: "abc", mimeType: "image/png" },
    complete: async () => ({ stopReason: "stop", content: [{ type: "text", text: "unused" }] }),
  });
  expect(missing).toBeUndefined();

  const errored = await describeImageWithRegistry({
    models,
    current: models[0]!,
    image: { data: "abc", mimeType: "image/png" },
    complete: async () => ({ stopReason: "error", content: [{ type: "text", text: "nope" }] }),
  });
  expect(errored).toBeUndefined();

  const overview = await describeImageWithRegistry({
    models,
    current: models[0]!,
    image: { data: "abc", mimeType: "image/png" },
    complete: async (_model, context) => {
      const content = context.messages[0]?.content;
      const text = Array.isArray(content) ? content.find((part) => part.type === "text") : undefined;
      expect(text && text.type === "text" ? text.text : "").toMatch(/coding agent/i);
      return { stopReason: "stop", content: [{ type: "text", text: "overview" }] };
    },
  });
  expect(overview).toBe("overview");
});
