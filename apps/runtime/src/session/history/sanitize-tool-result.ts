/**
 * 工具结果进会话账本 / 重拼 prompt 前去掉媒体与超大载荷。
 * 典型坑：CodeBuddy ViewImage 把 data:image/...;base64 整段当字符串落盘，
 * 下一轮 transcriptToPrompt 再喂回厂商 → 直接顶满 context（如 100k）。
 *
 * 覆盖形态：
 * - data: URL（image / audio / video / application）
 * - OpenAI 系 image_url 块、Pi image 块
 * - 偶发超长纯文本（Read/Bash 吐二进制转义等）
 */

/** 单条工具结果写入上下文的字符上限（约 20k token 粗估）。 */
export const MAX_TOOL_RESULT_CONTEXT_CHARS = 80_000;

export const OMITTED_MEDIA_NOTE = "[媒体/二进制内容已省略，不写入后续上下文]";

const DATA_URL_RE =
  /data:(?:image|audio|video|application)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi;

export function sanitizeToolResultText(text: string): string {
  if (!text) return text;
  // 先认整段 image_url JSON（ViewImage），再剥嵌在叙述里的 data: URL
  if (looksLikeImageUrlJson(text)) return OMITTED_MEDIA_NOTE;
  let out = text.replace(DATA_URL_RE, OMITTED_MEDIA_NOTE);
  if (out.length > MAX_TOOL_RESULT_CONTEXT_CHARS) {
    const original = out.length;
    out = `${out.slice(0, MAX_TOOL_RESULT_CONTEXT_CHARS)}\n…(已截断，原 ${original} 字符)`;
  }
  return out;
}

/**
 * 任意工具 result → 可安全落盘 / 进 flatten 的形态。
 * 保留可读文本；媒体块改成短说明。
 */
export function sanitizeToolResultForContext(result: unknown): unknown {
  if (result == null) return result;
  if (typeof result === "string") return sanitizeToolResultText(result);
  if (Array.isArray(result)) return sanitizeContentBlocks(result);
  if (typeof result === "object") {
    const row = result as Record<string, unknown>;
    if ("content" in row) {
      const content = row.content;
      if (typeof content === "string") {
        return { ...row, content: sanitizeToolResultText(content) };
      }
      if (Array.isArray(content)) {
        return { ...row, content: sanitizeContentBlocks(content) };
      }
    }
    // 普通 JSON 工具结果（MCP 列表等）原样保留；勿 JSON.stringify 改变类型
    return result;
  }
  return sanitizeToolResultText(String(result));
}

function sanitizeContentBlocks(blocks: unknown[]): unknown[] {
  const out: unknown[] = [];
  let omitted = false;
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      out.push(block);
      continue;
    }
    const row = block as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";
    if (type === "image" || type === "image_url" || type === "input_image") {
      omitted = true;
      continue;
    }
    if (type === "text" && typeof row.text === "string") {
      out.push({ ...row, text: sanitizeToolResultText(row.text) });
      continue;
    }
    // 未知块：若自带 data / base64 字段则丢弃
    if (typeof row.data === "string" && row.data.length > 500 && looksLikeBase64(row.data)) {
      omitted = true;
      continue;
    }
    if (
      row.image_url &&
      typeof row.image_url === "object" &&
      typeof (row.image_url as { url?: unknown }).url === "string"
    ) {
      omitted = true;
      continue;
    }
    out.push(block);
  }
  if (omitted) {
    out.push({ type: "text", text: OMITTED_MEDIA_NOTE });
  }
  return out;
}

function looksLikeImageUrlJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
  if (!/image_url|"type"\s*:\s*"image"/i.test(trimmed)) return false;
  if (!/data:image\/|base64,/i.test(trimmed)) return false;
  return true;
}

function looksLikeBase64(value: string): boolean {
  const sample = value.replace(/\s/g, "").slice(0, 200);
  return /^[A-Za-z0-9+/]+=*$/.test(sample) && value.replace(/\s/g, "").length >= 500;
}
