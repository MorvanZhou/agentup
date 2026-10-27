import { computed, onMounted, ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { applyTheme, readThemeMirror, writeThemeMirror } from "../../../app/theme/theme";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { ThemeMode, UiLocale } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";
import { applyUiLocale, t } from "../../../shared/model/ui/ui-locale";

export function useAppearanceSettings(api = new DesktopApi()) {
  const {
    session,
    themeMode,
    uiLocale,
    setUiLocale,
    skipEditResendConfirm,
    menuBarAvailable,
    menuBarVisible,
    setMenuBarVisible,
  } = useDesktop();
  const busy = ref(false);
  const guest = computed(() => !session.value || isGuestSession(session.value));
  const options = computed(() => [
    { id: "system" as const, label: t("themeSystem"), hint: t("themeSystemHint") },
    { id: "light" as const, label: t("themeLight"), hint: t("themeLightHint") },
    { id: "dark" as const, label: t("themeDark"), hint: t("themeDarkHint") },
  ]);

  onMounted(() => void load());

  async function load(): Promise<void> {
    if (!session.value) return;
    busy.value = true;
    try {
      if (isGuestSession(session.value)) {
        const mirrored = readThemeMirror(session.value.userId);
        if (mirrored) {
          themeMode.value = mirrored;
          applyTheme(mirrored);
        }
        return;
      }
      const prefs = await api.preferences(session.value.token);
      themeMode.value = prefs.themeMode;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(session.value.userId, prefs.themeMode);
      await applyUiLocale(prefs.uiLocale);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function select(mode: ThemeMode): Promise<void> {
    if (!session.value || busy.value || themeMode.value === mode) return;
    const previous = themeMode.value;
    themeMode.value = mode;
    applyTheme(mode);
    writeThemeMirror(session.value.userId, mode);
    if (isGuestSession(session.value)) {
      showToast(t("themeSavedLocal"), "success");
      return;
    }
    busy.value = true;
    try {
      const prefs = await api.savePreferences(session.value.token, { themeMode: mode });
      themeMode.value = prefs.themeMode;
      skipEditResendConfirm.value = prefs.skipEditResendConfirm;
      applyTheme(prefs.themeMode);
      writeThemeMirror(session.value.userId, prefs.themeMode);
      await applyUiLocale(prefs.uiLocale);
      showToast(t("themeSavedAccount"), "success");
    } catch (caught) {
      themeMode.value = previous;
      applyTheme(previous);
      writeThemeMirror(session.value.userId, previous);
      showToast(messageOf(caught), "error");
    } finally {
      busy.value = false;
    }
  }

  async function selectLocale(next: UiLocale): Promise<void> {
    if (busy.value || uiLocale.value === next) return;
    const saved = await setUiLocale(next);
    if (!saved) return;
    showToast(guest.value ? t("localeSavedLocal") : t("localeSavedAccount"), "success");
  }

  function toggleMenuBar(visible: boolean): void {
    if (busy.value || menuBarVisible.value === visible) return;
    setMenuBarVisible(visible);
    showToast(t("appearanceMenuBarSaved"), "success");
  }

  return {
    options,
    themeMode,
    uiLocale,
    guest,
    busy,
    menuBarAvailable,
    menuBarVisible,
    select,
    selectLocale,
    toggleMenuBar,
  };
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : t("themeSaveFailed");
}
