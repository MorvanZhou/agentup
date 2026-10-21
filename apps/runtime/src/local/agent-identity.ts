import { t, type UiLocale } from "../i18n/index.js";

/** 名片人物背景上限（字/字符）。 */
export const BACKGROUND_MAX = 300;

export class AgentIdentityError extends Error {}

/** 由姓名 / 职业 / 人物背景拼成 SYSTEM.md 正文（派生，非权威源）。 */
export function composeSystemPrompt(
  input: { name: string; role: string; background: string },
  locale: UiLocale = "zh",
): string {
  return t("identity.systemTemplate", locale, {
    name: input.name.trim(),
    role: input.role.trim(),
    background: input.background.trim(),
  }).trim();
}

/** 覆盖写入包内 SYSTEM.md（发布打包装用；表单身份为权威）。 */
export function withComposedSystemMd(
  files: Record<string, Uint8Array>,
  input: { name: string; role: string; background: string },
  locale: UiLocale = "zh",
): Record<string, Uint8Array> {
  const body = `${composeSystemPrompt(input, locale)}\n`;
  return { ...files, "SYSTEM.md": Buffer.from(body, "utf8") };
}

export function normalizeAgentName(value: string, locale: UiLocale = "zh"): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) throw new AgentIdentityError(t("identity.err.nameLength", locale));
  return name;
}

export function normalizeAgentRole(value: string, locale: UiLocale = "zh"): string {
  const role = value.trim().replace(/\s+/g, " ");
  if (!role || role.length > 40) throw new AgentIdentityError(t("identity.err.roleLength", locale));
  return role;
}

export function normalizeAgentBackground(value: string, locale: UiLocale = "zh"): string {
  const background = value.trim().replace(/\s+/g, " ");
  if (!background || background.length > BACKGROUND_MAX) {
    throw new AgentIdentityError(t("identity.err.backgroundLength", locale));
  }
  return background;
}
