import { computed, onMounted, ref, watch, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import type { AgentUpPreviewRecipe } from "../model/message/message-preview";
import type {
  PreviewPortConflict,
  ThreadPreviewApi,
} from "../model/thread/thread-preview";

/** thread 级预览：列配方、启停 bg、钉顶栏；端口冲突弹窗后 force 重启。 */
export function useThreadPreview(input: {
  agentId: Ref<string>;
  personal: Ref<boolean>;
  /** 群执掌 agent，启停后台 job 记在其名下。 */
  holderAgentId?: Ref<string | undefined>;
}): ThreadPreviewApi {
  const api = new DesktopApi();
  const { session } = useDesktop();
  const recipes = ref<AgentUpPreviewRecipe[]>([]);
  const headerRecipes = computed(() =>
    recipes.value.filter((item) => item.header_pinned === true),
  );
  const active = ref<AgentUpPreviewRecipe | null>(null);
  const open = ref(false);
  const busy = ref(false);
  const portConflict = ref<PreviewPortConflict | null>(null);

  async function refresh(): Promise<void> {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const agentId = input.agentId.value;
    if (!token || !userId || !agentId) {
      recipes.value = [];
      return;
    }
    try {
      recipes.value = await api.listPreviewRecipes(
        token,
        userId,
        agentId,
        input.personal.value,
      );
    } catch {
      recipes.value = [];
    }
  }

  async function runStart(recipe: AgentUpPreviewRecipe, force: boolean): Promise<void> {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const agentId = input.agentId.value;
    if (!token || !userId || !agentId || busy.value) return;
    if (agentId.startsWith("group:") && !input.holderAgentId?.value?.trim()) {
      showToast("无法启动预览：缺少群执掌者", "error");
      return;
    }
    busy.value = true;
    try {
      const result = await api.startPreviewRecipe(
        token,
        userId,
        agentId,
        input.personal.value,
        recipe.id,
        input.holderAgentId?.value,
        force,
      );
      if (result.status === "conflict") {
        portConflict.value = {
          recipe: result.recipe,
          pid: result.pid,
          preview_url: result.preview_url,
        };
        return;
      }
      portConflict.value = null;
      active.value = result.recipe;
      open.value = true;
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "启动预览失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  async function start(recipe: AgentUpPreviewRecipe): Promise<void> {
    await runStart(recipe, false);
  }

  async function confirmPortConflict(): Promise<void> {
    const pending = portConflict.value;
    if (!pending) return;
    portConflict.value = null;
    await runStart(pending.recipe, true);
  }

  function dismissPortConflict(): void {
    portConflict.value = null;
  }

  async function stop(recipe: AgentUpPreviewRecipe): Promise<void> {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const agentId = input.agentId.value;
    if (!token || !userId || !agentId || busy.value) return;
    busy.value = true;
    try {
      await api.stopPreviewRecipe(
        token,
        userId,
        agentId,
        input.personal.value,
        recipe.id,
        input.holderAgentId?.value,
      );
      if (active.value?.id === recipe.id) {
        active.value = null;
        open.value = false;
      }
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "停止预览失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  async function setHeaderPinned(
    recipe: AgentUpPreviewRecipe,
    pinned: boolean,
  ): Promise<void> {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const agentId = input.agentId.value;
    if (!token || !userId || !agentId || busy.value) return;
    busy.value = true;
    try {
      await api.pinPreviewRecipeHeader(
        token,
        userId,
        agentId,
        input.personal.value,
        recipe.id,
        pinned,
      );
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "更新顶栏失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  async function dismiss(recipe: AgentUpPreviewRecipe): Promise<void> {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    const agentId = input.agentId.value;
    if (!token || !userId || !agentId || busy.value) return;
    busy.value = true;
    try {
      await api.dismissPreviewRecipe(
        token,
        userId,
        agentId,
        input.personal.value,
        recipe.id,
        input.holderAgentId?.value,
      );
      if (active.value?.id === recipe.id) {
        active.value = null;
        open.value = false;
      }
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : "移除预览失败",
        "error",
      );
    } finally {
      busy.value = false;
    }
  }

  onMounted(() => {
    void refresh();
  });
  watch(
    () =>
      [
        input.agentId.value,
        input.personal.value,
        session.value?.userId,
        input.holderAgentId?.value,
      ] as const,
    () => {
      void refresh();
    },
  );

  return {
    recipes,
    headerRecipes,
    active,
    open,
    busy,
    portConflict,
    refresh,
    start,
    confirmPortConflict,
    dismissPortConflict,
    stop,
    setHeaderPinned,
    dismiss,
  };
}
