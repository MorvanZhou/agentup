import { ref, watch } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApiError } from "../../../shared/api/runtime";
import { compressAvatarFile } from "../../../shared/model/compress-avatar";
import { showToast } from "../../../shared/model/toast";

export function useAccountSettings() {
  const { session, updateNickname, updateProfile } = useDesktop();
  const nickname = ref(session.value?.nickname ?? "");
  const busy = ref(false);
  const avatarBusy = ref(false);

  watch(
    () => session.value?.nickname,
    (value) => {
      if (value !== undefined && !busy.value) nickname.value = value;
    },
  );

  async function commitNickname(): Promise<void> {
    if (!session.value || busy.value) return;
    const next = nickname.value.trim();
    if (!next) {
      nickname.value = session.value.nickname;
      showToast("昵称不能为空", "error");
      return;
    }
    if (next === session.value.nickname) {
      nickname.value = session.value.nickname;
      return;
    }
    busy.value = true;
    try {
      const saved = await updateNickname(next);
      nickname.value = saved.nickname;
      showToast("昵称已更新", "success");
    } catch (caught) {
      nickname.value = session.value.nickname;
      showToast(messageOf(caught, "昵称更新失败"), "error");
    } finally {
      busy.value = false;
    }
  }

  async function chooseAvatar(file?: File): Promise<void> {
    if (!file || !session.value || avatarBusy.value || busy.value) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showToast("头像只支持 PNG、JPEG 或 WebP", "error");
      return;
    }
    avatarBusy.value = true;
    try {
      const dataUrl = await compressAvatarFile(file);
      const avatarBase64 = dataUrlToBase64(dataUrl);
      await updateProfile(session.value.nickname, { avatarBase64 });
      showToast("头像已更新", "success");
    } catch (caught) {
      showToast(
        caught instanceof Error && !(caught instanceof DesktopApiError)
          ? caught.message
          : messageOf(caught, "头像更新失败"),
        "error",
      );
    } finally {
      avatarBusy.value = false;
    }
  }

  return { session, nickname, busy, avatarBusy, commitNickname, chooseAvatar };
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new Error("头像编码无效");
  }
  return dataUrl.slice(comma + 1);
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof DesktopApiError ? caught.message : fallback;
}
