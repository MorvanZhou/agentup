import { customAlphabet } from "nanoid";

/**
 * 与 backend `domain.util._short_id` 同一契约：
 * - 库：nanoid（TS 用 npm `nanoid`，Python 用 `nanoid`）
 * - 字母表：62 位大小写字母和数字（无 `_`/`-`，方便做路径段）
 * - 长度：8（约 47 bit；撞号靠调用方按命名空间重试）
 *
 * user_id / agent_id / group_id / delegation task_id 都走这套。
 */
export const SHORT_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHORT_ID_SIZE = 8;

const generate = customAlphabet(SHORT_ID_ALPHABET, SHORT_ID_SIZE);

export function shortId(): string {
  return generate();
}
