import { ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { compressAvatarFile } from "../../../shared/model/compress-avatar";
import { showToast } from "../../../shared/model/toast";
import { readUiLocale, t } from "../../../shared/model/ui-locale";

type Snapshot = {
  name: string;
  instructions: string;
  avatarUrl?: string;
};

export function usePersonalAssistantSettings(api = new DesktopApi()) {
  const desktop = useDesktop();
  const name = ref("");
  const instructions = ref("");
  const avatarUrl = ref<string>();
  const avatarChange = ref<string>();
  const loading = ref(false);
  const saving = ref(false);
  let loaded = false;
  let snapshot: Snapshot = { name: "", instructions: "" };
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
      instructions.value = profile.instructions;
      avatarUrl.value = profile.avatarUrl;
      avatarChange.value = undefined;
      snapshot = {
        name: profile.name,
        instructions: profile.instructions,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      };
      loaded = true;
    } catch (caught) {
      showToast(messageOf(caught, t("assistantProfileLoadFailed")));
    } finally {
      loading.value = false;
    }
  }

  async function chooseAvatar(file?: File): Promise<void> {
    if (!file || loading.value) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showToast(t("assistantAvatarType"));
      return;
    }
    try {
      const dataUrl = await compressAvatarFile(file);
      avatarChange.value = dataUrl;
      avatarUrl.value = dataUrl;
      await saveIfChanged();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : t("assistantAvatarCompressFailed"));
    }
  }

  async function commitField(): Promise<void> {
    await saveIfChanged();
  }

  async function saveIfChanged(): Promise<void> {
    if (!desktop.session.value || !loaded || loading.value) return;
    if (!isDirty()) return;
    if (!name.value.trim() || !instructions.value.trim()) {
      showToast(t("assistantProfileRequired"));
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
          instructions: instructions.value,
          avatarDataUrl: avatarChange.value,
        };
        const saved = await api.savePersonalAssistantProfile(
          desktop.session.value.token,
          desktop.session.value.userId,
          {
            name: submitted.name,
            instructions: submitted.instructions,
            ...(submitted.avatarDataUrl ? { avatarDataUrl: submitted.avatarDataUrl } : {}),
          },
          readUiLocale(),
        );
        // 保存期间用户可能继续编辑：只回写仍与提交值一致的字段，避免冲掉新输入。
        if (name.value === submitted.name) name.value = saved.name;
        if (instructions.value === submitted.instructions) {
          instructions.value = saved.instructions;
        }
        if (avatarChange.value === submitted.avatarDataUrl) {
          avatarUrl.value = saved.avatarUrl;
          avatarChange.value = undefined;
        }
        snapshot = {
          name: saved.name,
          instructions: saved.instructions,
          ...(saved.avatarUrl ? { avatarUrl: saved.avatarUrl } : {}),
        };
        await desktop.refresh();
      } while (saveAgain || isDirty());
      showToast(t("assistantProfileSaved"), "success");
    } catch (caught) {
      showToast(messageOf(caught, t("assistantProfileSaveFailed")));
    } finally {
      saving.value = false;
    }
  }

  function isDirty(): boolean {
    return (
      name.value !== snapshot.name ||
      instructions.value !== snapshot.instructions ||
      Boolean(avatarChange.value)
    );
  }

  return {
    name,
    instructions,
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
