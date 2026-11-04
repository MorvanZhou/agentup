import { computed, onMounted, onScopeDispose, ref } from "vue";

import { showToast } from "../../../shared/model/ui/toast";
import { t, uiLocale } from "../../../shared/model/ui/ui-locale";
import {
  buildAboutMarketingUrls,
  reduceAboutUpdateResult,
  supportsAppUpdateCheck,
  type AboutUpdateStatus,
} from "../model/about-links";

export function useAboutSettings() {
  const productName = ref("AgentUp");
  const version = ref("");
  const webBase = ref("");
  const updateStatus = ref<AboutUpdateStatus>({ kind: "idle" });
  const cmdCopied = ref(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const platform = typeof window !== "undefined" ? window.agentUp?.platform : undefined;
  const isMac = computed(() => platform === "darwin");
  const canCheckUpdates = computed(() => supportsAppUpdateCheck(platform));
  const checking = computed(() => updateStatus.value.kind === "checking");
  const available = computed(() =>
    updateStatus.value.kind === "available" ? updateStatus.value : null,
  );
  // 语言切换时官网 / 下载页路径前缀跟着变
  const marketingUrls = computed(() =>
    webBase.value ? buildAboutMarketingUrls(webBase.value, uiLocale.value) : null,
  );
  const websiteUrl = computed(() => marketingUrls.value?.websiteUrl ?? "");
  const downloadPageUrl = computed(() => marketingUrls.value?.downloadPageUrl ?? "");

  let stopUpdateListener: (() => void) | undefined;

  onMounted(() => {
    void loadAbout();
    const bridge = window.agentUp;
    if (!bridge?.onUpdateCheckResult) return;
    stopUpdateListener = bridge.onUpdateCheckResult((payload) => {
      const next = reduceAboutUpdateResult(payload ?? {});
      if (next) updateStatus.value = next;
    });
  });

  onScopeDispose(() => {
    stopUpdateListener?.();
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  async function loadAbout(): Promise<void> {
    const bridge = window.agentUp;
    try {
      const about = await bridge?.getAppAbout?.();
      if (about?.name?.trim()) productName.value = about.name.trim();
      if (about?.version?.trim()) version.value = about.version.trim();
    } catch {
      /* 开发/e2e 无 IPC 时保留默认名 */
    }
    try {
      const base = (await bridge?.webUrl?.())?.trim() || "";
      if (base) webBase.value = base.replace(/\/$/, "");
    } catch {
      /* 无 webUrl 时链接区隐藏 */
    }
  }

  async function openLink(url: string): Promise<void> {
    if (!url) return;
    const open = window.agentUp?.openExternal;
    if (!open) {
      showToast(t("appUpdateDownloadFailed"), "error");
      return;
    }
    try {
      await open(url);
    } catch {
      showToast(t("appUpdateDownloadFailed"), "error");
    }
  }

  function openWebsite(): Promise<void> {
    return openLink(websiteUrl.value);
  }

  function openDownloadPage(): Promise<void> {
    return openLink(downloadPageUrl.value);
  }

  async function checkForUpdates(): Promise<void> {
    if (!canCheckUpdates.value || checking.value) return;
    const check = window.agentUp?.checkForUpdates;
    if (!check) {
      updateStatus.value = { kind: "error" };
      return;
    }
    updateStatus.value = { kind: "checking" };
    try {
      await check();
    } catch {
      updateStatus.value = { kind: "error" };
    }
  }

  async function downloadUpdate(): Promise<void> {
    const current = available.value;
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

  async function copyMacCmd(): Promise<void> {
    const text = t("appUpdateMacCmd");
    try {
      await navigator.clipboard.writeText(text);
      cmdCopied.value = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        cmdCopied.value = false;
      }, 2000);
    } catch {
      /* 无剪贴板权限时用户仍可手动选中命令 */
    }
  }

  return {
    productName,
    version,
    websiteUrl,
    downloadPageUrl,
    updateStatus,
    isMac,
    canCheckUpdates,
    checking,
    available,
    cmdCopied,
    openWebsite,
    openDownloadPage,
    checkForUpdates,
    downloadUpdate,
    copyMacCmd,
  };
}
