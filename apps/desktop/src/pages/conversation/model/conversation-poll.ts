import { DESKTOP_PULSE_ACTIVE_MS } from "../../../app/desktop-pulse-interval";

/**
 * 开房 getGroup 安全轮询：与 desktop-pulse 同拍。
 * 消息直播靠 turn-stream，房间字段靠 pulse 合并；这里只为 liveTurnId 兜底。
 */
export const GROUP_OPEN_RELOAD_MS = DESKTOP_PULSE_ACTIVE_MS;

/**
 * followUp 条在 busy 时的收敛间隔：与 pulse 同拍。
 * 入队成功后另有 tick 立刻刷一次，不必 1s 狂拉。
 */
export const FOLLOW_UP_POLL_MS = DESKTOP_PULSE_ACTIVE_MS;

export type GroupOpenReloadRoom = {
  holderSpeaking?: boolean;
};

/**
 * 是否还需要对开房做 getGroup 轮询。
 * 仅发言中需要：liveTurnId 不在 pulse 里，断线/切轮靠它对齐。
 * 纯 task / pending 委托已由 pulse.groups 合并，不必再叠一路 1s 请求。
 */
export function groupOpenNeedsReloadPoll(room: GroupOpenReloadRoom | null | undefined): boolean {
  return room?.holderSpeaking === true;
}
