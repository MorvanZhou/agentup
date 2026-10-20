import type { Session } from "./runtime";
import { t } from "./ui-locale";

/** 本机游客固定身份；无 backend 账号，token 仅用于本机 runtime Bearer 占位。 */
export const GUEST_USER_ID = "guest";
export const GUEST_TOKEN = "guest";
/** 持久化占位；界面展示用 sessionDisplayNickname。 */
export const GUEST_NICKNAME = "guest";

export const GUEST_SESSION: Session = {
  kind: "guest",
  userId: GUEST_USER_ID,
  email: "",
  nickname: GUEST_NICKNAME,
  token: GUEST_TOKEN,
};

export function isGuestSession(session: Session | null | undefined): boolean {
  return session?.kind === "guest" || session?.userId === GUEST_USER_ID;
}

export function isAccountSession(session: Session | null | undefined): boolean {
  return Boolean(session && !isGuestSession(session));
}

/** 游客昵称随界面语言；正式账号用 session.nickname。 */
export function sessionDisplayNickname(session: Session | null | undefined): string {
  if (!session) return "";
  if (isGuestSession(session)) return t("guestNickname");
  return session.nickname;
}
