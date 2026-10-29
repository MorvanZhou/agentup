import type { InjectionKey, Ref } from "vue";
import { inject } from "vue";

/** 工作区「添加到对话」：把文件 / 文件夹插进 Composer 成 `@ATTACHMENTS` 芯片。 */
export type ComposerAttachApi = {
  attachWorkspaceFile: (input: {
    relativePath: string;
    absolutePath: string;
    name: string;
    kind: "file" | "dir";
  }) => Promise<void>;
};

export const composerAttachKey = Symbol("composerAttach") as InjectionKey<
  Ref<ComposerAttachApi | null>
>;

export function injectComposerAttach(): Ref<ComposerAttachApi | null> | undefined {
  return inject(composerAttachKey, undefined);
}

/** 已在 ATTACHMENTS 下的相对路径可直接插芯片，不必再复制一份。 */
export function isAttachmentsWorkspacePath(relativePath: string): boolean {
  const path = relativePath.replace(/^@/, "").trim().replace(/\/+$/, "");
  return path.startsWith("ATTACHMENTS/");
}
