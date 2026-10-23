import { computed, onActivated, onMounted, ref, watch, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { providerConfigEpoch } from "../../../shared/model/provider-config";
import type { SessionModelOption, SessionModelState } from "../../../shared/model/runtime";
import { showToast } from "../../../shared/model/toast";
import { readUiLocale, uiLocale } from "../../../shared/model/ui-locale";

/** 当前对话 Pi session 的模型选择（Composer 下拉）。 */
export function useSessionModel(agentId: Ref<string>, api = new DesktopApi()) {
  const { session } = useDesktop();
  const state = ref<SessionModelState | null>(null);
  const busy = ref(false);
  const loaded = ref(false);

  const models = computed(() => state.value?.models ?? []);
  const current = computed(() => state.value?.current ?? null);
  const configured = computed(() => Boolean(state.value?.configured));
  const currentLabel = computed(() => {
    const ref = current.value;
    if (!ref) return "";
    const hit = models.value.find(
      (model) => model.templateId === ref.templateId && model.modelId === ref.modelId,
    );
    return hit?.name ?? ref.modelId;
  });

  async function load(): Promise<void> {
    if (!session.value || !agentId.value) return;
    busy.value = true;
    try {
      state.value = await api.sessionModel(
        session.value.token,
        agentId.value,
        session.value.userId,
        readUiLocale(),
      );
    } catch (caught) {
      showToast(caught instanceof DesktopApiError ? caught.message : "加载模型失败", "error");
    } finally {
      busy.value = false;
      loaded.value = true;
    }
  }

  async function select(model: SessionModelOption): Promise<void> {
    if (!session.value || !agentId.value || busy.value) return;
    const cur = current.value;
    if (cur && cur.templateId === model.templateId && cur.modelId === model.modelId) return;
    busy.value = true;
    try {
      state.value = await api.setSessionModel(
        session.value.token,
        agentId.value,
        session.value.userId,
        { templateId: model.templateId, modelId: model.modelId },
        readUiLocale(),
      );
    } catch (caught) {
      showToast(caught instanceof DesktopApiError ? caught.message : "切换模型失败", "error");
    } finally {
      busy.value = false;
    }
  }

  onMounted(() => void load());
  onActivated(() => void load());
  watch([agentId, () => session.value?.userId, uiLocale], () => void load());
  /** Settings 删服务商 / 启停模型后，KeepAlive 对话页也要立刻同步候选与当前项。 */
  watch(providerConfigEpoch, () => {
    if (loaded.value) void load();
  });

  return {
    state,
    models,
    current,
    currentLabel,
    configured,
    busy,
    loaded,
    load,
    select,
  };
}
