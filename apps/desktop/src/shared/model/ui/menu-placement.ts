/** 下拉相对触发器的开合方向与可视限高（视口内，避免贴底憋屈） */

export type MenuPlacementSide = "below" | "above";

export type MenuPlacement = {
  placement: MenuPlacementSide;
  /** 菜单可用最大高度（px），已扣间隙与边距 */
  maxHeightPx: number;
};

export type ResolveMenuPlacementInput = {
  triggerTop: number;
  triggerBottom: number;
  viewportHeight: number;
  /** 触发器与菜单间距，默认 4（约 mt-1） */
  gap?: number;
  /** 距视口边缘留白，默认 8 */
  edgePadding?: number;
  /** 偏好上限，默认 256（约 max-h-64） */
  preferredMaxHeight?: number;
};

const DEFAULT_GAP = 4;
const DEFAULT_EDGE = 8;
const DEFAULT_PREFERRED_MAX = 256;

/**
 * 下方能放下偏好高度，或下方不比上方更窄 → 往下开；否则翻到上面。
 * maxHeight = min(偏好上限, 该侧可用高度)。
 */
export function resolveMenuPlacement(input: ResolveMenuPlacementInput): MenuPlacement {
  const gap = input.gap ?? DEFAULT_GAP;
  const edge = input.edgePadding ?? DEFAULT_EDGE;
  const preferred = input.preferredMaxHeight ?? DEFAULT_PREFERRED_MAX;

  const spaceBelow = Math.max(0, input.viewportHeight - input.triggerBottom - gap - edge);
  const spaceAbove = Math.max(0, input.triggerTop - gap - edge);

  const placement: MenuPlacementSide =
    spaceBelow >= preferred || spaceBelow >= spaceAbove ? "below" : "above";

  const available = placement === "below" ? spaceBelow : spaceAbove;
  return { placement, maxHeightPx: Math.min(preferred, available) };
}
