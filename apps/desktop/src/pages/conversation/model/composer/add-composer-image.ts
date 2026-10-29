/**
 * 输入框和编辑区加入图片的唯一入口。
 * 超限、落盘、失败提示都在当前线程的附件适配器里，这里不区分一对一还是群聊。
 * 适配器抛错时吞掉 rejection，避免未处理的 Promise；提示已经由适配器发出。
 */
export function addComposerImage(
  addAttachment: (file: File) => Promise<unknown>,
  image: File,
): void {
  void Promise.resolve(addAttachment(image)).catch(() => undefined);
}
