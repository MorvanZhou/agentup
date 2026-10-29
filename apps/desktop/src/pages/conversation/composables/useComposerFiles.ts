import { ref, watch, type Ref } from "vue";

import { DesktopApi } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import {
  attachmentFolderPath,
  insertAttachmentReference,
} from "../model/composer/attachment-ref";
import { isAttachmentsWorkspacePath } from "../model/composer/composer-attach";
import { stagedPathsToRemove } from "../model/composer/composer-staged-files";
import { stageComposerFile } from "../model/composer/stage-composer-file";

const IMAGE_MIME = /^(image\/(png|jpeg|gif|webp))$/i;

export function isImageFile(file: File): boolean {
  if (IMAGE_MIME.test(file.type)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

/** 非图片附件：选/拖/贴瞬间 staging 落盘，并在光标处插入 `@ATTACHMENTS/...` 芯片。 */
export function useComposerFiles(options: {
  agentId: Ref<string>;
  groupId?: Ref<string>;
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
    // 图片不进芯片：一对一和群聊都走 Composer 附件条（ImageAttachmentPreview）。
    const list = files.filter((file) => !isImageFile(file));
    if (list.length === 0) return;
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    // 群聊附件落群共享工作区（按 groupId 归属），不需要 agentId；
    // 单聊 / 私人助理必须有归属 agent，缺了视为未登录。
    if (!token || !userId || (!agentId && !options.groupId?.value)) {
      showToast("尚未登录", "error");
      return;
    }
    busy.value = true;
    try {
      let text = options.composerText.value;
      let cursor = options.cursor.value;
      for (const file of list) {
        const staged = await stageComposerFile({
          api,
          token,
          userId,
          agentId,
          groupId: options.groupId?.value,
          file,
        });
        stagedPaths.value.add(staged.path);
        const next = insertAttachmentReference(text, cursor, cursor, staged.path);
        text = next.text;
        cursor = next.cursor;
      }
      options.setText(text, cursor);
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "附件上传失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  /**
   * 工作区文件 / 文件夹一键进 Composer：已在 ATTACHMENTS 下直接插 `@` 芯片；
   * 产物 / 挂载目录则 from-path 复制进 ATTACHMENTS 再插芯片。
   * 目录 path 带尾 `/`，FileChip 显示文件夹图标。
   */
  async function attachWorkspaceFile(input: {
    relativePath: string;
    absolutePath: string;
    name: string;
    kind: "file" | "dir";
  }): Promise<void> {
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!token || !userId || (!agentId && !options.groupId?.value)) {
      showToast("尚未登录", "error");
      return;
    }
    busy.value = true;
    try {
      let path: string;
      const relative = input.relativePath.replace(/^@/, "").trim().replace(/\/+$/, "");
      if (isAttachmentsWorkspacePath(relative)) {
        // 已是上传区：直接引用，勿再 staging，也勿在摘芯片时删原件
        path = input.kind === "dir" ? attachmentFolderPath(relative) : relative;
      } else {
        const payload = {
          name: input.name || (input.kind === "dir" ? "folder" : "file"),
          mediaType: input.kind === "dir" ? "inode/directory" : "application/octet-stream",
          path: input.absolutePath,
        };
        const staged = options.groupId?.value
          ? await api.stageGroupAttachmentFromPath(
              token,
              userId,
              options.groupId.value,
              payload,
            )
          : await api.stageAttachmentFromPath(token, userId, agentId, payload);
        path = staged.path;
        stagedPaths.value.add(path);
      }
      const text = options.composerText.value;
      const cursor = options.cursor.value;
      const next = insertAttachmentReference(text, cursor, cursor, path);
      options.setText(next.text, next.cursor);
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "附件上传失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  async function removeFileRef(path: string): Promise<void> {
    const text = options.composerText.value;
    const token = `@${path}`;
    const index = text.indexOf(token);
    // 仅本会话 staging 的副本可删盘；工作区原有 ATTACHMENTS 引用只摘芯片
    const wasStaged = stagedPaths.value.has(path);
    if (index < 0) {
      stagedPaths.value.delete(path);
      if (wasStaged) void deleteRemote(path);
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
    if (wasStaged) void deleteRemote(path);
  }

  async function deleteRemote(path: string): Promise<void> {
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!token || !userId || (!agentId && !options.groupId?.value)) return;
    try {
      if (options.groupId?.value) {
        await api.deleteGroupAttachment(token, userId, options.groupId.value, path);
      } else {
        await api.deleteStagedAttachment(token, userId, agentId, path);
      }
    } catch {
      /* 已发送后文件可能仍被历史引用；删除失败静默 */
    }
  }

  return { busy, stageAndInsertFiles, attachWorkspaceFile, removeFileRef, isImageFile };
}
