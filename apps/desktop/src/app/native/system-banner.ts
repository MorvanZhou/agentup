import type { AttentionSnapshot } from "../../shared/api/runtime/chat";
import { t, tf } from "../../shared/model/ui/ui-locale";

/** 横幅点进去要打开的会话。 */
export type BannerSurface = { kind: "agent" | "group"; id: string };

export type HitlBannerKind = "approval" | "ask" | "shell";

export type HitlBannerItem = {
  key: string;
  kind: HitlBannerKind;
  target: BannerSurface;
  askedByName?: string;
};

/**
 * 横幅正文只占一行（标题另占一行，一共两行）。
 * 中文等宽字符按 2、ASCII 按 1，约等于 macOS 横幅正文一行能放下的宽度。
 */
const BODY_LINE_WIDTH = 40;

/** 窗口正聚焦且前台就是这条会话时不弹，避免挡住正在看的内容。 */
export function suppressBecauseViewing(
  windowFocused: boolean,
  viewing: BannerSurface | null,
  target: BannerSurface,
): boolean {
  if (!windowFocused || !viewing) return false;
  return viewing.kind === target.kind && viewing.id === target.id;
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0x00ff ? 1 : 2;
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** 压成一行，放不下时以省略号结尾。 */
export function clipBannerBody(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (textWidth(flat) <= BODY_LINE_WIDTH) return flat;
  const ellipsis = "…";
  let width = charWidth(ellipsis);
  let out = "";
  for (const ch of flat) {
    const next = width + charWidth(ch);
    if (next > BODY_LINE_WIDTH) break;
    out += ch;
    width = next;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

export function replyBannerCopy(name: string, preview: string): { title: string; body: string } {
  const title = name.trim() || t("navMessages");
  return { title, body: clipBannerBody(preview) || t("osBannerReply") };
}

export function hitlBannerCopy(name: string, item: HitlBannerItem): { title: string; body: string } {
  const title = name.trim() || t("navMessages");
  const asked = item.askedByName?.trim() ?? "";
  let body = t("sideAwaitApproval");
  if (item.kind === "ask") body = asked ? tf("sideAwaitChildAsk", { name: asked }) : t("sideAwaitAsk");
  else if (item.kind === "shell") body = t("osBannerShell");
  else if (asked) body = tf("sideAwaitChildApproval", { name: asked });
  return { title, body: clipBannerBody(body) };
}

function bannerTarget(agentId: string, groupId?: string): BannerSurface {
  const group = groupId?.trim() ?? "";
  if (group) return { kind: "group", id: group };
  return { kind: "agent", id: agentId };
}

function hitlItem(
  kind: HitlBannerKind,
  item: { id: string; agentId: string; groupId?: string; askedByName?: string },
): HitlBannerItem | null {
  const id = item.id.trim();
  const agentId = item.agentId.trim();
  if (!id || !agentId) return null;
  const asked = item.askedByName?.trim();
  return {
    key: `${kind}:${id}`,
    kind,
    target: bannerTarget(agentId, item.groupId),
    askedByName: asked || undefined,
  };
}

/** 从一帧 attention 抽出可点的待处理事项，顺序：批准、提问、命令空闲。 */
export function hitlBannerItems(snap: AttentionSnapshot): HitlBannerItem[] {
  const items: HitlBannerItem[] = [];
  for (const item of snap.approvals) {
    const next = hitlItem("approval", item);
    if (next) items.push(next);
  }
  for (const item of snap.askUsers) {
    const next = hitlItem("ask", item);
    if (next) items.push(next);
  }
  for (const item of snap.shellHangs) {
    const next = hitlItem("shell", item);
    if (next) items.push(next);
  }
  return items;
}

/**
 * known 为 null 表示冷启动第一帧：只记住，不弹。
 * 之后同一 id 再出现不重复；新 id 才进入 fresh。
 */
export function freshHitlBanners(
  known: ReadonlySet<string> | null,
  snap: AttentionSnapshot,
): { known: Set<string>; fresh: HitlBannerItem[] } {
  const items = hitlBannerItems(snap);
  if (known === null) {
    return { known: new Set(items.map((item) => item.key)), fresh: [] };
  }
  const next = new Set(known);
  const fresh: HitlBannerItem[] = [];
  for (const item of items) {
    if (next.has(item.key)) continue;
    next.add(item.key);
    fresh.push(item);
  }
  return { known: next, fresh };
}

/** 渲染进程收到的点击目标；非法 kind / 空 id 丢掉。 */
export function readBannerSurface(value: unknown): BannerSurface | null {
  if (!value || typeof value !== "object") return null;
  const kind = (value as { kind?: unknown }).kind;
  const id = (value as { id?: unknown }).id;
  if ((kind !== "agent" && kind !== "group") || typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return { kind, id: trimmed };
}
