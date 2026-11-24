import { onMounted, ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { BrowserUseMode } from "../../../shared/api/runtime/settings";
import { useDesktop } from "../../../app/desktop";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";

const EXTENSION_DOCS = "https://playwright.dev/mcp/configuration/browser-extension";

export function useBrowserUseSettings(api = new DesktopApi()) {
  const { session } = useDesktop();
  const busy = ref(false);
  const mode = ref<BrowserUseMode>("profile");

  onMounted(() => void load());

  async function load(): Promise<void> {
    if (!session.value) return;
    busy.value = true;
    try {
      const next = await api.browserUseSettings(session.value.token);
      mode.value = next.mode;
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function select(next: BrowserUseMode): Promise<void> {
    if (!session.value || busy.value || mode.value === next) return;
    const previous = mode.value;
    mode.value = next;
    busy.value = true;
    try {
      const saved = await api.saveBrowserUseSettings(session.value.token, next);
      mode.value = saved.mode;
      showToast(t("browserUseSaved"), "success");
    } catch (caught) {
      mode.value = previous;
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  function openExtensionDocs(): void {
    const open = window.agentUp?.openExternal;
    if (open) {
      void open(EXTENSION_DOCS);
      return;
    }
    window.open(EXTENSION_DOCS, "_blank", "noopener,noreferrer");
  }

  return { busy, mode, select, openExtensionDocs };
}

function messageOf(caught: unknown): string {
  if (caught instanceof DesktopApiError) return caught.message;
  if (caught instanceof Error && caught.message) return caught.message;
  return t("browserUseSaveFailed");
}
