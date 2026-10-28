import type { AssistantMessage, Context } from "@earendil-works/pi-ai";

export const VISION_CAPTION_TIMEOUT_MS = 60_000;

const OMIT_NOTE = "[Current model does not support images. The image will be omitted from this request.]";

const DEFAULT_QUESTION =
  "Describe this image for a coding agent. Include visible text, layout, errors, and anything needed to act on the file. Be concise.";

export type VisionCatalogModel = {
  id: string;
  provider: string;
  input: readonly ("text" | "image")[];
};

export type DescribeReadImage = (input: {
  data: string;
  mimeType: string;
  question?: string;
  signal?: AbortSignal;
}) => Promise<string>;

type CaptionMessage = Pick<AssistantMessage, "stopReason" | "content">;

/** 没标 input、或标了 image，都按能直接看图处理（与 Pi 的省略说明一致）。 */
export function modelAcceptsImages(model: { input?: readonly string[] } | null | undefined): boolean {
  if (!model?.input) return true;
  return model.input.includes("image");
}

/** 同一 provider 里、不是当前模型、且 input 含 image 的第一个目录项。 */
export function pickVisionModel<T extends VisionCatalogModel>(
  models: readonly T[],
  current: { id: string; provider: string },
): T | undefined {
  return models.find(
    (item) => item.provider === current.provider && item.id !== current.id && item.input.includes("image"),
  );
}

/** 用识图结果换掉 Pi 的省略说明；没有那句时把描述接在后面。 */
export function replaceImageOmitNote(text: string, description: string): string {
  const caption = description.trim();
  if (!caption) return text;
  if (text.includes(OMIT_NOTE)) return text.replace(OMIT_NOTE, caption);
  return `${text}\n${caption}`;
}

export function applyImageCaption<
  T extends { content: Array<{ type: string; text?: string }>; structuredContent?: unknown },
>(result: T, description: string): T {
  let changed = false;
  let note = "";
  const content = result.content.map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") return block;
    const text = replaceImageOmitNote(block.text, description);
    if (text === block.text) return block;
    changed = true;
    note = text;
    return { ...block, text };
  });
  if (!changed) return result;
  const structured = result.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured) || !("note" in structured)) {
    return { ...result, content };
  }
  return { ...result, content, structuredContent: { ...structured, note } };
}

export function imagePayload(
  content: ReadonlyArray<{ type?: string; data?: unknown; mimeType?: unknown }>,
): { data: string; mimeType: string } | undefined {
  const block = content.find((part) => part.type === "image");
  if (!block || typeof block.data !== "string" || !block.data || typeof block.mimeType !== "string") return undefined;
  return { data: block.data, mimeType: block.mimeType };
}

export async function describeImageWithRegistry<T extends VisionCatalogModel>(input: {
  models: readonly T[];
  complete: (
    model: T,
    context: Context,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<CaptionMessage>;
  current: { id: string; provider: string };
  image: { data: string; mimeType: string };
  question?: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const vision = pickVisionModel(input.models, input.current);
  if (!vision) return undefined;
  const timeout = AbortSignal.timeout(VISION_CAPTION_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  try {
    const asked = input.question?.trim() || DEFAULT_QUESTION;
    const message = await input.complete(
      vision,
      {
        messages: [
          {
            role: "user",
            timestamp: Date.now(),
            content: [
              { type: "text", text: asked },
              { type: "image", data: input.image.data, mimeType: input.image.mimeType },
            ],
          },
        ],
      },
      { timeoutMs: VISION_CAPTION_TIMEOUT_MS, signal },
    );
    if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}
