import { ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";

export function useUserAgentsMd(api = new DesktopApi()) {
  const { session } = useDesktop();
  const text = ref("");
  const loading = ref(false);
  const saving = ref(false);
  let loaded = false;
  let snapshot = "";
  let saveAgain = false;

  async function load(): Promise<void> {
    if (!session.value || loaded || loading.value) return;
    loading.value = true;
    try {
      text.value = await api.userAgentsMd(session.value.token, session.value.userId);
      snapshot = text.value;
      loaded = true;
    } catch (caught) {
      showToast(messageOf(caught, t("rulesLoadFailed")), "error");
    } finally {
      loading.value = false;
    }
  }

  async function commitField(): Promise<void> {
    await saveIfChanged();
  }

  async function saveIfChanged(): Promise<void> {
    if (!session.value || !loaded || loading.value) return;
    if (text.value === snapshot) return;
    if (saving.value) {
      saveAgain = true;
      return;
    }

    saving.value = true;
    try {
      do {
        saveAgain = false;
        const submitted = text.value;
        const saved = await api.saveUserAgentsMd(
          session.value.token,
          session.value.userId,
          submitted,
        );
        if (text.value === submitted) text.value = saved;
        snapshot = saved;
      } while (saveAgain || text.value !== snapshot);
      showToast(t("rulesSaved"), "success");
    } catch (caught) {
      showToast(messageOf(caught, t("rulesSaveFailed")), "error");
    } finally {
      saving.value = false;
    }
  }

  return { text, loading, saving, load, commitField };
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof DesktopApiError ? caught.message : fallback;
}
