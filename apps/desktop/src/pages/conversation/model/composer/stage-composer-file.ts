import { DesktopApi } from "../../../../shared/api/runtime";
import type { StagedAttachment } from "../../../../shared/api/runtime/attachments";
import { MAX_INLINE_IMAGE_BYTES } from "./inline-image-limit";

/**
 * 把用户选中的文件 staging 到工作区。
 * 群聊图片走附件条（和一对一同一套 ImageAttachmentPreview），落盘仍走这里，
 * 这样发送时能把 `@ATTACHMENTS/...` 写进正文，成员才能读到文件。
 */
export async function stageComposerFile(input: {
  api: DesktopApi;
  token: string;
  userId: string;
  agentId: string;
  groupId?: string;
  file: File;
}): Promise<StagedAttachment> {
  const sourcePath =
    typeof window === "undefined" ? null : (window.agentUp?.filePathForStaging?.(input.file) ?? null);
  if (sourcePath) return stageFromPath(input, sourcePath);

  const tempPath = await stageInMemoryTempFile(input.file);
  if (tempPath) {
    try {
      return await stageFromPath(input, tempPath);
    } finally {
      void window.agentUp?.discardStagedTempFile?.(tempPath);
    }
  }

  if (input.file.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`附件过大（上限 ${MAX_INLINE_IMAGE_BYTES / (1024 * 1024)}MB）`);
  }
  const dataBase64 = await fileToBase64(input.file);
  const payload = {
    name: input.file.name || "file",
    mediaType: input.file.type || "application/octet-stream",
    dataBase64,
  };
  return input.groupId
    ? input.api.stageGroupAttachment(input.token, input.userId, input.groupId, payload)
    : input.api.stageAttachment(input.token, input.userId, input.agentId, payload);
}

function stageFromPath(
  input: {
    api: DesktopApi;
    token: string;
    userId: string;
    agentId: string;
    groupId?: string;
    file: File;
  },
  sourcePath: string,
): Promise<StagedAttachment> {
  const payload = {
    name: input.file.name || "file",
    mediaType: input.file.type || "application/octet-stream",
    path: sourcePath,
  };
  return input.groupId
    ? input.api.stageGroupAttachmentFromPath(input.token, input.userId, input.groupId, payload)
    : input.api.stageAttachmentFromPath(input.token, input.userId, input.agentId, payload);
}

/** 粘贴的内存文件：请主进程落临时文件（IPC 传二进制，零 base64 膨胀）。 */
async function stageInMemoryTempFile(file: File): Promise<string | null> {
  const bridge = typeof window === "undefined" ? undefined : window.agentUp;
  if (!bridge?.stageInMemoryFile) return null;
  try {
    return await bridge.stageInMemoryFile(file.name || "file", await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(""));
}
