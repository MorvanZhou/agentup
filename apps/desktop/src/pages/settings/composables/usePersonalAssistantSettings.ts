import { ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { compressAvatarFile } from "../../../shared/model/compress-avatar";
import { showToast } from "../../../shared/model/toast";
import { readUiLocale, t } from "../../../shared/model/ui-locale";

type Snapshot = {
  name: string;
  role: string;
  background: string;
  avatarUrl?: string;
};

export function usePersonalAssistantSettings(api = new DesktopApi()) {
  const desktop = useDesktop();
  const name = ref("");
  const role = ref("");
  const background = ref("");
  const avatarUrl = ref<string>();
  const avatarChange = ref<string>();
  const loading = ref(false);
  const saving = ref(false);
  let loaded = false;
  let snapshot: Snapshot = { name: "", role: "", background: "" };
  let saveAgain = false;

  async function load(force = false): Promise<void> {
    if (!desktop.session.value || loading.value || (loaded && !force)) return;
    loading.value = true;
    try {
      const profile = await api.personalAssistantProfile(
        desktop.session.value.token,
        desktop.session.value.userId,
        readUiLocale(),
      );
      name.value = profile.name;
      role.value = profile.role;
      background.value = profile.background;
      avatarUrl.value = profile.avatarUrl;
      avatarChange.value = undefined;
      snapshot = {
        name: profile.name,
        role: profile.role,
        background: profile.background,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      };
      loaded = true;
    } catch (caught) {
      showToast(messageOf(caught, t("assistantProfileLoadFailed")), "error");
    } finally {
      loading.value = false;
    }
  }

  async function chooseAvatar(file?: File): Promise<void> {
    if (!file || loading.value) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showToast(t("assistantAvatarType"), "error");
      return;
    }
    try {
      const dataUrl = await compressAvatarFile(file);
      avatarChange.value = dataUrl;
      avatarUrl.value = dataUrl;
      await saveIfChanged();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : t("assistantAvatarCompressFailed"), "error");
    }
  }

  async function commitField(): Promise<void> {
    await saveIfChanged();
  }

  async function saveIfChanged(): Promise<void> {
    if (!desktop.session.value || !loaded || loading.value) return;
    if (!isDirty()) return;
    if (!name.value.trim() || !role.value.trim() || !background.value.trim()) {
      showToast(t("assistantProfileRequired"), "error");
      return;
    }
    if (saving.value) {
      saveAgain = true;
      return;
    }

    saving.value = true;
    try {
      do {
        saveAgain = false;
        const submitted = {
          name: name.value,
          role: role.value,
          background: background.value,
          avatarDataUrl: avatarChange.value,
        };
        const saved = await api.savePersonalAssistantProfile(
          desktop.session.value.token,
          desktop.session.value.userId,
          {
            name: submitted.name,
            role: submitted.role,
            background: submitted.background,
            ...(submitted.avatarDataUrl ? { avatarDataUrl: submitted.avatarDataUrl } : {}),
          },
          readUiLocale(),
        );
        // 保存期间用户可能继续编辑：只回写仍与提交值一致的字段，避免冲掉新输入。
        if (name.value === submitted.name) name.value = saved.name;
        if (role.value === submitted.role) role.value = saved.role;
        if (background.value === submitted.background) background.value = saved.background;
        if (avatarChange.value === submitted.avatarDataUrl) {
          avatarUrl.value = saved.avatarUrl;
          avatarChange.value = undefined;
        }
        snapshot = {
          name: saved.name,
          role: saved.role,
          background: saved.background,
          ...(saved.avatarUrl ? { avatarUrl: saved.avatarUrl } : {}),
        };
        await desktop.refresh();
      } while (saveAgain || isDirty());
      showToast(t("assistantProfileSaved"), "success");
    } catch (caught) {
      showToast(messageOf(caught, t("assistantProfileSaveFailed")), "error");
    } finally {
      saving.value = false;
    }
  }

  function isDirty(): boolean {
    return (
      name.value !== snapshot.name ||
      role.value !== snapshot.role ||
      background.value !== snapshot.background ||
      Boolean(avatarChange.value)
    );
  }

  return {
    name,
    role,
    background,
    avatarUrl,
    loading,
    saving,
    load,
    chooseAvatar,
    commitField,
  };
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof DesktopApiError ? caught.message : fallback;
}
