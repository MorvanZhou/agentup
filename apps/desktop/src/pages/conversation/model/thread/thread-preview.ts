import { inject, provide, type InjectionKey, type Ref } from "vue";

import type { AgentUpPreviewRecipe } from "../message/message-preview";

/** 端口被其它进程占用：弹窗确认后再 force 启动。 */
export type PreviewPortConflict = {
  recipe: AgentUpPreviewRecipe;
  pid: number;
  preview_url: string;
};

export type ThreadPreviewApi = {
  recipes: Ref<AgentUpPreviewRecipe[]>;
  /** 顶栏仅展示 header_pinned 的配方。 */
  headerRecipes: Ref<AgentUpPreviewRecipe[]>;
  active: Ref<AgentUpPreviewRecipe | null>;
  open: Ref<boolean>;
  busy: Ref<boolean>;
  /** 启动冲突待确认；null 表示无弹窗。 */
  portConflict: Ref<PreviewPortConflict | null>;
  refresh: () => Promise<void>;
  start: (recipe: AgentUpPreviewRecipe) => Promise<void>;
  /** 人确认后：杀掉占用进程并启动。 */
  confirmPortConflict: () => Promise<void>;
  dismissPortConflict: () => void;
  stop: (recipe: AgentUpPreviewRecipe) => Promise<void>;
  /** 气泡脚：钉到 / 取消顶栏常驻。 */
  setHeaderPinned: (recipe: AgentUpPreviewRecipe, pinned: boolean) => Promise<void>;
  /** 顶栏叉掉：删 workspace.json 配方并停 job。 */
  dismiss: (recipe: AgentUpPreviewRecipe) => Promise<void>;
};

const KEY: InjectionKey<ThreadPreviewApi> = Symbol("agentup.thread-preview");

export function provideThreadPreview(api: ThreadPreviewApi): void {
  provide(KEY, api);
}

export function injectThreadPreview(): ThreadPreviewApi | null {
  return inject(KEY, null);
}
