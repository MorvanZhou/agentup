import type { ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

export interface ThreadExtras {
  personal: boolean;
  /** personal / local / recruited（市场招募含自有再招募）。 */
  kind: "personal" | "local" | "recruited" | "";
  name: string;
  /** 开发者岗位；用户不能改。 */
  role: string;
  /** 本机备注名；空表示未设置。 */
  remark: string;
  background: string;
  avatarUrl?: string;
  recruited: boolean;
  syncedVersion: string;
  busy: boolean;
  modelConfigured: boolean;
  modelLoaded: boolean;
}

export const threadExtrasKey = Symbol("threadExtras") as InjectionKey<Ref<ThreadExtras> | ComputedRef<ThreadExtras>>;

const empty: ThreadExtras = {
  personal: false,
  kind: "",
  name: "",
  role: "",
  remark: "",
  background: "",
  recruited: false,
  syncedVersion: "",
  busy: false,
  modelConfigured: false,
  modelLoaded: false,
};

export function injectThreadExtras(): ComputedRef<ThreadExtras> {
  // 显式 default：委托气泡等非完整线程树也会挂 Markdown 预览，勿再 Vue warn
  const value = inject(threadExtrasKey, undefined);
  return computed(() => value?.value ?? empty);
}
