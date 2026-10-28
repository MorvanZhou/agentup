import fs from "node:fs";
import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";

import { Type } from "@earendil-works/pi-ai";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type ExtensionFactory,
  type ExtensionToolContext,
  type FindOperations,
} from "@earendil-works/pi-coding-agent";

import { assertInsideAnyRoot, ProjectRootsError } from "../workspace/project-roots.js";
import {
  applyImageCaption,
  describeImageWithRegistry,
  imagePayload,
  modelAcceptsImages,
  type DescribeReadImage,
} from "./read-image.js";

/**
 * 用 allowedRoots 覆盖 Pi 内置 read/write/edit/grep/find/ls。
 * getAllowedRoots 每次工具调用再取，便于 UI 挂载后无需重开会话。
 */
export function createFsGuardExtension(
  cwd: string,
  getAllowedRoots: () => string[],
  options?: { isReadOnly?: (absolutePath: string) => boolean; describeImage?: DescribeReadImage },
): ExtensionFactory {
  return async (pi) => {
    const guard = (absolutePath: string, allowMissing = false) => {
      try {
        assertInsideAnyRoot(absolutePath, getAllowedRoots(), { allowMissing });
      } catch (error) {
        if (error instanceof ProjectRootsError) throw new Error(error.message);
        throw error;
      }
    };
    const guardWrite = (absolutePath: string, allowMissing = false) => {
      guard(absolutePath, allowMissing);
      if (options?.isReadOnly?.(absolutePath)) throw new Error("该目录只读");
    };

    pi.registerTool(
      withImageCaption(
        createReadToolDefinition(cwd, {
          operations: {
            readFile: async (absolutePath) => {
              guard(absolutePath);
              return fsReadFile(absolutePath);
            },
            access: async (absolutePath) => {
              guard(absolutePath);
              await fsAccess(absolutePath, constants.R_OK);
            },
            detectImageMimeType: async (absolutePath) => {
              guard(absolutePath);
              return detectSupportedImageMimeTypeFromFile(absolutePath);
            },
          },
        }),
        options?.describeImage,
      ),
    );

    pi.registerTool(
      createWriteToolDefinition(cwd, {
        operations: {
          writeFile: async (absolutePath, content) => {
            guardWrite(absolutePath, true);
            await fsWriteFile(absolutePath, content, "utf8");
          },
          mkdir: async (dir) => {
            guardWrite(dir, true);
            await fsMkdir(dir, { recursive: true });
          },
        },
      }),
    );

    pi.registerTool(
      createEditToolDefinition(cwd, {
        operations: {
          readFile: async (absolutePath) => {
            guard(absolutePath);
            return fsReadFile(absolutePath);
          },
          writeFile: async (absolutePath, content) => {
            guardWrite(absolutePath);
            await fsWriteFile(absolutePath, content, "utf8");
          },
          access: async (absolutePath) => {
            guard(absolutePath);
            await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
          },
        },
      }),
    );

    pi.registerTool(
      createGrepToolDefinition(cwd, {
        operations: {
          isDirectory: async (absolutePath) => {
            guard(absolutePath);
            return fs.statSync(absolutePath).isDirectory();
          },
          readFile: async (absolutePath) => {
            guard(absolutePath);
            return fsReadFile(absolutePath, "utf8");
          },
        },
      }),
    );

    // 只包 exists 且不提供 glob，Pi 仍走默认 fd 实现（见 find.js：customOps?.glob 才改道）。
    pi.registerTool(
      createFindToolDefinition(cwd, {
        operations: {
          exists: (absolutePath) => {
            guard(absolutePath);
            return fs.existsSync(absolutePath);
          },
        } as FindOperations,
      }),
    );

    pi.registerTool(
      createLsToolDefinition(cwd, {
        operations: {
          exists: (absolutePath) => {
            guard(absolutePath);
            return fs.existsSync(absolutePath);
          },
          stat: (absolutePath) => {
            guard(absolutePath);
            return fs.statSync(absolutePath);
          },
          readdir: (absolutePath) => {
            guard(absolutePath);
            return fs.readdirSync(absolutePath);
          },
        },
      }),
    );
  };
}

const IMAGE_READ_GUIDELINE =
  "When the current model cannot view images, read still accepts image files and returns a text description; pass question to focus it. Image bytes are not sent to you.";

function imageReadParameters() {
  return Type.Object({
    path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
    question: Type.Optional(
      Type.String({
        description:
          "For image files when the current model cannot view images: what to look for. Ignored for text files and for models that accept images.",
      }),
    ),
  });
}

function withImageCaption(
  tool: ReturnType<typeof createReadToolDefinition>,
  describeImage?: DescribeReadImage,
): ReturnType<typeof createReadToolDefinition> {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    parameters: imageReadParameters() as typeof tool.parameters,
    description: `${tool.description} When the current model accepts images, image files are returned as attachments. When it does not, you receive a text description from another vision-capable model on the same provider instead of the image bytes; pass question to focus that description. Text files ignore question.`,
    promptGuidelines: [...(tool.promptGuidelines ?? []), IMAGE_READ_GUIDELINE],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await execute(toolCallId, params, signal, onUpdate, ctx);
      const image = imagePayload(result.content);
      if (!image || modelAcceptsImages(ctx?.model)) return result;
      const question = readQuestion(params);
      const description = await captionImage(image, question, signal, ctx, describeImage);
      if (!description) return result;
      return applyImageCaption(result, description);
    },
  };
}

function readQuestion(params: object): string | undefined {
  if (!("question" in params)) return undefined;
  const question = params.question;
  return typeof question === "string" ? question : undefined;
}

async function captionImage(
  image: { data: string; mimeType: string },
  question: string | undefined,
  signal: AbortSignal | undefined,
  ctx: ExtensionToolContext | undefined,
  describeImage: DescribeReadImage | undefined,
): Promise<string | undefined> {
  try {
    if (describeImage) {
      const text = (await describeImage({ ...image, question, signal })).trim();
      return text || undefined;
    }
    if (!ctx?.model || !ctx.modelRegistry) return undefined;
    return await describeImageWithRegistry({
      models: ctx.modelRegistry.getModelsOfType("chat", ctx.model.provider),
      complete: (model, context, options) => ctx.modelRegistry.complete(model, context, options),
      current: ctx.model,
      image,
      question,
      signal,
    });
  } catch {
    return undefined;
  }
}
