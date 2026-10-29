import type { AttachmentAdapter } from "@assistant-ui/core";

import { DesktopApi } from "../../../../shared/api/runtime";
import { showToast } from "../../../../shared/model/ui/toast";
import { stageComposerFile } from "./stage-composer-file";

/**
 * 群聊图片附件：渲染走 assistant-ui 附件条（与一对一 ComposerPrimitiveAttachments 相同），
 * add 时落盘到群共享工作区。id 用 staged 相对路径，发送时再拼进正文。
 * send 不读文件字节：群消息靠 `@ATTACHMENTS/...` 引用，不把图打成 base64。
 */
export function createGroupImageAttachmentAdapter(options: {
  api: DesktopApi;
  auth: () => { token: string; userId: string; groupId: string };
}): AttachmentAdapter {
  return {
    accept: "image/*,.png,.jpg,.jpeg,.gif,.webp",
    async add({ file }) {
      try {
        const { token, userId, groupId } = options.auth();
        if (!token || !userId || !groupId) throw new Error("尚未登录");
        const staged = await stageComposerFile({
          api: options.api,
          token,
          userId,
          agentId: "",
          groupId,
          file,
        });
        return {
          id: staged.path,
          type: "image",
          name: file.name,
          contentType: file.type || staged.mediaType,
          file,
          status: { type: "requires-action" as const, reason: "composer-send" as const },
        };
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "附件上传失败";
        showToast(message, "error");
        throw error;
      }
    },
    async send(attachment) {
      return {
        id: attachment.id,
        type: "image",
        name: attachment.name,
        contentType: attachment.contentType,
        status: { type: "complete" },
        content: [{ type: "image", image: "" }],
      };
    },
    async remove(attachment) {
      if (!attachment.id.startsWith("ATTACHMENTS/")) return;
      const { token, userId, groupId } = options.auth();
      if (!token || !userId || !groupId) return;
      await options.api.deleteGroupAttachment(token, userId, groupId, attachment.id);
    },
  };
}

/**
 * 群发送只转发正文。附件条里的图片不在输入框芯片中，这里把 staged 路径补进发出去的文本。
 * 正文里已经有的引用不重复追加。
 */
export function groupOutgoingText(text: string, attachmentIds: readonly string[]): string {
  const body = text.trim();
  const refs = attachmentIds
    .filter((id) => id.startsWith("ATTACHMENTS/") && !body.includes(`@${id}`))
    .map((id) => `@${id}`);
  if (refs.length === 0) return body;
  if (!body) return refs.join(" ");
  return `${body} ${refs.join(" ")}`;
}
