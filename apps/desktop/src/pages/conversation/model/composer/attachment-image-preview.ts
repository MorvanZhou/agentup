/**
 * 已发送气泡里的图片附件缩略：按扩展名识别，经 runtime `GET .../workspace/file` 取 dataURL。
 * Composer 里的图片不走这里，而是和一对一一样进附件条（本地 File 的 blob URL）。
 * binary / 超限 / 读取失败一律回落原文件芯片（null），不额外报错。
 */

import { isWorkspaceImagePath } from "../../../../shared/workspace-media";

/** 附件相对路径是否可当图片预览。只看扩展名，避免对每个附件都发请求。 */
export function isImageAttachmentPath(relativePath: string): boolean {
  return isWorkspaceImagePath(relativePath);
}

/** 测试可注入的最小 API 形状（DesktopApi.readWorkspaceFile 同签名）。 */
type WorkspaceFileReader = {
  readWorkspaceFile(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
  ): Promise<
    | { path: string; kind: "image"; size: number; mediaType: string; dataBase64: string }
    | { path: string; kind: "binary" | "too-large" | "text"; size: number; media?: "text" | "image"; text?: string }
  >;
};

/**
 * 缓存 key 用 path：staged 路径内含 8 位随机 id（`ATTACHMENTS/<name>_<id>.<ext>`），
 * 跨线程天然不撞。`inFlight` 去重并发请求；`resolved` 供气泡重渲时同步取。
 */
const inFlight = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string | null>();

/** 供测试清空缓存。 */
export function clearAttachmentImagePreviewCache(): void {
  inFlight.clear();
  resolved.clear();
}

/** 取附件缩略 dataURL；不可预览/失败返回 null。同 path 只请求一次。 */
export function loadAttachmentImagePreview(input: {
  api: WorkspaceFileReader;
  token: string;
  userId: string;
  agentId: string;
  personal: boolean;
  path: string;
}): Promise<string | null> {
  const hit = inFlight.get(input.path);
  if (hit) return hit;
  const task = (async () => {
    try {
      const file = await input.api.readWorkspaceFile(
        input.token,
        input.userId,
        input.agentId,
        input.personal,
        input.path,
      );
      const url = file.kind === "image" ? `data:${file.mediaType};base64,${file.dataBase64}` : null;
      resolved.set(input.path, url);
      return url;
    } catch {
      resolved.set(input.path, null);
      return null;
    }
  })();
  inFlight.set(input.path, task);
  return task;
}

/** 同步取已解析的缩略图。未加载 / 失败一律 null。 */
export function getCachedAttachmentImagePreview(path: string): string | null {
  return resolved.get(path) ?? null;
}
