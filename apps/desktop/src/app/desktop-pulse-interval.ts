/** 有 busy / HITL / running fleets / 非 idle 群时用短间隔。 */
export const DESKTOP_PULSE_ACTIVE_MS = 2_500;
/** 空闲时拉长，减少无意义请求。 */
export const DESKTOP_PULSE_IDLE_MS = 12_000;
/** 窗口不可见时再降频；回到前台会立刻补一拍。 */
export const DESKTOP_PULSE_HIDDEN_MS = 30_000;

export type DesktopPulseActivity = {
  hidden: boolean;
  /** attention busy / HITL，或 running 委托/作业，或群非 idle。 */
  active: boolean;
};

/** 根据可见性与是否有待跟进工作选择下一拍间隔。 */
export function desktopPulseIntervalMs(input: DesktopPulseActivity): number {
  if (input.hidden) return DESKTOP_PULSE_HIDDEN_MS;
  return input.active ? DESKTOP_PULSE_ACTIVE_MS : DESKTOP_PULSE_IDLE_MS;
}

/** pulse 载荷是否需要保持高频对齐。 */
export function desktopPulseIsActive(input: {
  busyAgentIds: readonly string[];
  approvals: readonly unknown[];
  askUsers: readonly unknown[];
  shellHangs: readonly unknown[];
  runningDelegations: readonly unknown[];
  runningJobs: readonly unknown[];
  unseenDelegations: readonly unknown[];
  unseenJobs: readonly unknown[];
  groups: ReadonlyArray<{ phase?: string; holderSpeaking?: boolean }>;
}): boolean {
  if (input.busyAgentIds.length > 0) return true;
  if (input.approvals.length > 0) return true;
  if (input.askUsers.length > 0) return true;
  if (input.shellHangs.length > 0) return true;
  if (input.runningDelegations.length > 0) return true;
  if (input.runningJobs.length > 0) return true;
  if (input.unseenDelegations.length > 0) return true;
  if (input.unseenJobs.length > 0) return true;
  return input.groups.some(
    (room) => room.holderSpeaking === true || (room.phase != null && room.phase !== "idle"),
  );
}
