import { ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/toast";
import { insertAttachmentReference } from "../model/attachment-ref";
import { stagedPathsToRemove } from "../model/composer-staged-files";

const IMAGE_MIME = /^(image\/(png|jpeg|gif|webp))$/i;

export function isImageFile(file: File): boolean {
  if (IMAGE_MIME.test(file.type)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

/** 非图片附件：选/拖/贴瞬间 staging 落盘，并在光标处插入 `@ATTACHMENTS/...` 芯片。 */
export function useComposerFiles(options: {
  agentId: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  composerText: Ref<string>;
  cursor: Ref<number>;
  setText: (text: string, cursor?: number) => void;
  api?: DesktopApi;
}) {
  const api = options.api ?? new DesktopApi();
  const busy = ref(false);
  /** 本次会话已 staging、仍可能被正文引用的路径。 */
  const stagedPaths = ref(new Set<string>());

  watch(
    () => options.composerText.value,
    (text, prev) => {
      // 发送后输入框清空：历史仍引用这些文件，不能当「取消附件」删盘。
      if (!text.trim()) {
        stagedPaths.value = new Set();
        return;
      }
      for (const path of stagedPathsToRemove(prev ?? "", text, stagedPaths.value)) {
        stagedPaths.value.delete(path);
        void deleteRemote(path);
      }
    },
  );

  async function stageAndInsertFiles(files: readonly File[]): Promise<void> {
    const list = files.filter((file) => !isImageFile(file));
    if (list.length === 0) return;
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!token || !userId || !agentId) {
      showToast("尚未登录", "error");
      return;
    }
    busy.value = true;
    try {
      let text = options.composerText.value;
      let cursor = options.cursor.value;
      for (const file of list) {
        const dataBase64 = await fileToBase64(file);
        const staged = await api.stageAttachment(token, userId, agentId, {
          name: file.name || "file",
          mediaType: file.type || "application/octet-stream",
          dataBase64,
        });
        stagedPaths.value.add(staged.path);
        const next = insertAttachmentReference(text, cursor, cursor, staged.path);
        text = next.text;
        cursor = next.cursor;
      }
      options.setText(text, cursor);
    } catch (error) {
      showToast(error instanceof DesktopApiError ? error.message : "附件上传失败", "error");
    } finally {
      busy.value = false;
    }
  }

  async function removeFileRef(path: string): Promise<void> {
    const text = options.composerText.value;
    const token = `@${path}`;
    const index = text.indexOf(token);
    if (index < 0) {
      stagedPaths.value.delete(path);
      void deleteRemote(path);
      return;
    }
    const before = text.slice(0, index);
    let after = text.slice(index + token.length);
    // 吃掉插入时补的后置空格
    if (after.startsWith(" ")) after = after.slice(1);
    const leadTrim = before.endsWith(" ") && (after.length === 0 || /^\s/.test(after));
    const nextText = (leadTrim ? before.slice(0, -1) : before) + after;
    const nextCursor = leadTrim ? before.length - 1 : before.length;
    options.setText(nextText, Math.max(0, nextCursor));
    stagedPaths.value.delete(path);
    void deleteRemote(path);
  }

  async function deleteRemote(path: string): Promise<void> {
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!token || !userId || !agentId) return;
    try {
      await api.deleteStagedAttachment(token, userId, agentId, path);
    } catch {
      /* 已发送后文件可能仍被历史引用；删除失败静默 */
    }
  }

  return { busy, stageAndInsertFiles, removeFileRef, isImageFile };
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
