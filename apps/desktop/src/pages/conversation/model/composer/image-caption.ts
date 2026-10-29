/**
 * 识图管线有时会把图片尺寸说明写进用户原文，例如
 * `[Image: original 5112x2314, displayed at 2000x905. Multiply coordinates by 2.56 to map to original image.]`。
 * 真正的图在 message attachment 里，这段不应出现在气泡或编辑框。
 */
const syntheticImageCaption = () =>
  /\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]/g;

export function stripSyntheticImageCaption(text: string): string {
  if (!text.includes("[Image: original ")) return text;
  const stripped = text.replace(syntheticImageCaption(), "");
  if (stripped === text) return text;
  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}
