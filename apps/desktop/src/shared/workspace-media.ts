/**
 * 工作区预览和附件体积的配置只在 runtime `session/workspace/media.ts`。
 * 桌面从这里转出，避免再写一份 15MB 或扩展名表。
 */
export {
  MAX_INLINE_IMAGE_BYTES,
  isHtmlWorkspacePath,
  isMarkdownWorkspacePath,
  isWorkspaceImagePath,
} from "../../../runtime/src/session/workspace/media";
