/**
 * inline 图片在拖入 / 粘贴 / 选择时先拦一层。
 * 上限来自 runtime `INLINE_FILE_BYTES`，与附件落盘、应用内预览是同一个数。
 */
import { MAX_INLINE_IMAGE_BYTES } from "../../../../shared/workspace-media";

export { MAX_INLINE_IMAGE_BYTES };

export function inlineImageExceedsLimit(file: { size: number }): boolean {
  return file.size > MAX_INLINE_IMAGE_BYTES;
}
