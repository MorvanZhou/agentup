import type { InjectionKey, Ref } from "vue";
import { computed, inject, ref, type ComputedRef } from "vue";

/**
 * 工具卡是否允许按 preferOpen 自动展开。
 * 群聊主线程 / 旁路只读过程关掉，避免执行中铺开大块输出。
 */
export const toolAutoExpandKey = Symbol("toolAutoExpand") as InjectionKey<
  Ref<boolean> | ComputedRef<boolean>
>;

const defaultAllow = computed(() => true);

export function injectToolAutoExpand(): ComputedRef<boolean> {
  const value = inject(toolAutoExpandKey, defaultAllow);
  return computed(() => value.value !== false);
}

/** ToolCard：进行中且 preferOpen 时是否应自动打开；错误或禁用自动展开时否。 */
export function shouldAutoExpandToolCard(input: {
  allowAutoExpand: boolean;
  preferOpen: boolean;
  isActive: boolean;
  canExpand: boolean;
  isError: boolean;
}): boolean {
  if (!input.allowAutoExpand || input.isError) return false;
  return input.preferOpen && input.isActive && input.canExpand;
}

/** provide 用：群聊 / 旁路只读过程默认折叠工具卡。 */
export function readonlyToolAutoExpandRef(): Ref<boolean> {
  return ref(false);
}
