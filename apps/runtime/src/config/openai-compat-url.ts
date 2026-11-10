/**
 * 用户常从文档粘贴完整 chat URL（…/v1/chat/completions）。
 * 运行时会再拼 /chat/completions 或 /models，这里先归一成 OpenAI 兼容 root（…/v1）。
 */
export function toOpenAiCompatRoot(url: string): string {
  let value = url.trim().replace(/\/+$/, "");
  value = value.replace(/\/chat\/completions$/i, "");
  value = value.replace(/\/completions$/i, "");
  value = value.replace(/\/models$/i, "");
  return value.replace(/\/+$/, "");
}
