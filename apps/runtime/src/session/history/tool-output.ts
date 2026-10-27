export type ToolImagePayload = {
  mimeType: string;
  data: string;
};

export type ToolOutputWithImages = {
  text: string;
  images: ToolImagePayload[];
};

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

/**
 * 工具结果投影到 UI。
 * 纯文本保持字符串；带图片块时保留 base64，供 Read 展开显示。
 */
export function projectToolOutput(value: unknown): string | ToolOutputWithImages {
  if (typeof value === "string") return value;
  const blocks = contentBlocks(value);
  if (!blocks) return JSON.stringify(value);
  const images: ToolImagePayload[] = [];
  const texts: string[] = [];
  for (const part of blocks) {
    if (!part || typeof part !== "object") continue;
    const record = part as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      texts.push(record.text);
      continue;
    }
    if (
      record.type === "image" &&
      typeof record.mimeType === "string" &&
      IMAGE_MIME.has(record.mimeType) &&
      typeof record.data === "string" &&
      record.data
    ) {
      images.push({ mimeType: record.mimeType, data: record.data });
    }
  }
  const text = texts.join("");
  if (images.length === 0) return text;
  return { text, images };
}

/** 只要说明文字（错误、流式中间结果）。图片字节不进错误串。 */
export function projectToolText(value: unknown): string {
  const output = projectToolOutput(value);
  return typeof output === "string" ? output : output.text;
}

function contentBlocks(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || !("content" in value)) return null;
  const content = (value as { content: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return null;
}
