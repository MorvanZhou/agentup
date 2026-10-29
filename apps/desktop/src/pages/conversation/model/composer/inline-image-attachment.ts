import { SimpleImageAttachmentAdapter, type AttachmentAdapter } from "@assistant-ui/core";

import { showToast } from "../../../../shared/model/ui/toast";
import { t } from "../../../../shared/model/ui/ui-locale";
import { inlineImageExceedsLimit } from "./inline-image-limit";

/**
 * 一对一图片附件。界面与群聊共用 Composer 附件条；差别只在这份适配器：
 * 超 15MB 当场拒绝（发送时会打进 prompt body），通过的图仍交给 SimpleImageAttachmentAdapter。
 */
export function createInlineImageAttachmentAdapter(): AttachmentAdapter {
  const inner = new SimpleImageAttachmentAdapter();
  return {
    accept: inner.accept,
    async add(state) {
      if (inlineImageExceedsLimit(state.file)) {
        const message = t("composerImageTooLarge");
        showToast(message, "error");
        throw new Error(message);
      }
      return inner.add(state);
    },
    send(attachment, options) {
      return inner.send(attachment, options);
    },
    remove(attachment) {
      return inner.remove(attachment);
    },
  };
}
