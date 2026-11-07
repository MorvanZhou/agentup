/** 与 backend `core/limits.py` 对齐。改上限先改后端常量，再改这里。 */

export const NAME_MAX = 80;
export const ROLE_MAX = 40;
export const BACKGROUND_MAX = 300;
/** 与 backend `RULES_MAX_CHARS` / `RULES_MAX_BYTES` 对齐：约 5000 个汉字。 */
export const RULES_MAX_CHARS = 5_000;
export const RULES_MAX_BYTES = RULES_MAX_CHARS * 3;
export const REMARK_MAX = 40;
export const GROUP_TITLE_MAX = 40;
/** 与 backend TEAM_MEMBER_* / 建群人数对齐。 */
export const TEAM_MEMBER_MIN = 2;
export const TEAM_MEMBER_MAX = 6;
export const NICKNAME_MAX = 64;
export const SEARCH_QUERY_MAX = 64;

/** maxlength 只数字符；中文会在字符未满时先顶满字节。 */
export function clampUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let end = 0;
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).byteLength;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return value.slice(0, end);
}
