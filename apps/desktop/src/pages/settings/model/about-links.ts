import type { UiLocale } from "../../../shared/model/runtime/runtime";

/**
 * 官网 / 下载页 URL：与 Web `prefix_except_default` 对齐（en 无前缀，zh 为 `/zh`）。
 * `webBase` 无尾斜杠。
 */
export function buildAboutMarketingUrls(
  webBase: string,
  locale: UiLocale,
): { websiteUrl: string; downloadPageUrl: string } {
  const base = webBase.replace(/\/$/, "");
  if (locale === "zh") {
    return {
      websiteUrl: `${base}/zh`,
      downloadPageUrl: `${base}/zh/download`,
    };
  }
  return {
    websiteUrl: base,
    downloadPageUrl: `${base}/download`,
  };
}

/** 主进程会检查更新的平台（与 runAppUpdateCheck 一致） */
export function supportsAppUpdateCheck(platform: string | undefined): boolean {
  return platform === "darwin" || platform === "win32";
}

export type AboutUpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "error" }
  | {
      kind: "available";
      latestVersion: string;
      downloadUrl: string;
    };

/** 把主进程 update-check-result 收成页内状态（忽略空 payload） */
export function reduceAboutUpdateResult(payload: {
  status?: unknown;
  latestVersion?: unknown;
  downloadUrl?: unknown;
}): AboutUpdateStatus | null {
  const status = String(payload.status || "");
  if (status === "checking") return { kind: "checking" };
  if (status === "up-to-date") return { kind: "up-to-date" };
  if (status === "error") return { kind: "error" };
  if (status === "available") {
    const latestVersion = String(payload.latestVersion || "").trim();
    const downloadUrl = String(payload.downloadUrl || "").trim();
    if (!latestVersion || !downloadUrl) return null;
    return { kind: "available", latestVersion, downloadUrl };
  }
  return null;
}
