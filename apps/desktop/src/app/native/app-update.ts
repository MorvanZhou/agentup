import { onScopeDispose, shallowRef } from "vue";

import { t } from "../../shared/i18n";
import { showToast } from "../../shared/model/ui/toast";

export type AppUpdateAvailable = {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  fileName?: string;
};

const DISMISS_KEY = "agentup.update.dismissedVersion";

/** 左下角提示条：有可更新版本时展示 */
export const updateBanner = shallowRef<AppUpdateAvailable | null>(null);

function readDismissedVersion(): string {
  try {
    return String(localStorage.getItem(DISMISS_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* 隐私模式等写失败忽略 */
  }
}

/**
 * 订阅主进程更新检查结果；应在应用根 setup 调一次。
 * 手动检查（先推 checking）：up-to-date / error 走 toast；available 始终出条。
 * 静默轮询：仅 available，且未忽略该版本时出条。
 */
export function bindAppUpdateListener(): void {
  const bridge = typeof window === "undefined" ? undefined : window.agentUp;
  if (!bridge?.onUpdateCheckResult) return;

  /** 收到 checking 后，下一次终态视为手动检查 */
  let pendingInteractive = false;

  const stop = bridge.onUpdateCheckResult((payload) => {
    if (!payload || typeof payload !== "object") return;
    const status = String((payload as { status?: unknown }).status || "");
    if (status === "checking") {
      pendingInteractive = true;
      return;
    }
    const interactive = pendingInteractive;
    pendingInteractive = false;

    if (status === "available") {
      const latestVersion = String((payload as { latestVersion?: unknown }).latestVersion || "").trim();
      const currentVersion = String((payload as { currentVersion?: unknown }).currentVersion || "").trim();
      const downloadUrl = String((payload as { downloadUrl?: unknown }).downloadUrl || "").trim();
      const fileName = String((payload as { fileName?: unknown }).fileName || "").trim();
      if (!latestVersion || !downloadUrl) return;
      // 静默且已忽略该版本：不再弹出
      if (!interactive && readDismissedVersion() === latestVersion) return;
      updateBanner.value = {
        latestVersion,
        currentVersion,
        downloadUrl,
        ...(fileName ? { fileName } : {}),
      };
      return;
    }
    if (status === "up-to-date") {
      updateBanner.value = null;
      showToast(t("appUpdateUpToDate"), "success");
      return;
    }
    if (status === "error") {
      showToast(t("appUpdateCheckFailed"), "error");
    }
  });

  onScopeDispose(() => {
    stop();
  });
}

export function dismissUpdateBanner(): void {
  const current = updateBanner.value;
  if (current?.latestVersion) {
    writeDismissedVersion(current.latestVersion);
  }
  updateBanner.value = null;
}

export async function openUpdateDownload(): Promise<void> {
  const current = updateBanner.value;
  if (!current?.downloadUrl) return;
  const open = window.agentUp?.openUpdateDownload;
  if (!open) {
    showToast(t("appUpdateDownloadFailed"), "error");
    return;
  }
  try {
    await open(current.downloadUrl);
  } catch {
    showToast(t("appUpdateDownloadFailed"), "error");
  }
}
