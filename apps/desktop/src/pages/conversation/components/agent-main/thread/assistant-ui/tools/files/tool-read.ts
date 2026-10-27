export type ReadImageView = {
  src: string;
  mimeType: string;
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

/** 路径后缀像图片时，摘要不带文本行号。 */
export function isImageReadPath(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXT.has(base.slice(dot).toLowerCase());
}

/** 从工具结果取出可显示的图片。结果仍是字符串时返回空。 */
export function imagesFromToolResult(result: unknown): ReadImageView[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const images = (result as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  const out: ReadImageView[] = [];
  for (const item of images) {
    if (!item || typeof item !== "object") continue;
    const mimeType = (item as { mimeType?: unknown }).mimeType;
    const data = (item as { data?: unknown }).data;
    if (typeof mimeType !== "string" || !IMAGE_MIME.has(mimeType)) continue;
    if (typeof data !== "string" || !data) continue;
    out.push({ mimeType, src: `data:${mimeType};base64,${data}` });
  }
  return out;
}

/** 图片结果附带的说明（类型、缩放）。 */
export function readImageNote(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

/** UTF-8 硬解二进制时会出现的控制字符，用来避免把乱码画进代码块。 */
export function looksLikeBinaryText(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 4000);
  let bad = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code === 0xfffd || code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) bad += 1;
    if (bad > 4) return true;
  }
  return false;
}
