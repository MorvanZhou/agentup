import { DesktopApiError } from "../../api/runtime";
import type { PackageIssue } from "./runtime";

/** 把 API 错误整理成可读文案；有 details 时附带 path + message。 */
export function formatApiError(caught: unknown, fallback: string): string {
  if (!(caught instanceof DesktopApiError)) return fallback;
  const head = caught.message.trim() || fallback;
  if (!caught.details.length) return head;
  const lines = caught.details.map((item) => formatPackageIssue(item));
  return `${head}\n${lines.join("\n")}`;
}

export function formatPackageIssue(item: PackageIssue): string {
  return `${item.path}: ${item.message}`;
}

export function detailsOf(caught: unknown): PackageIssue[] {
  return caught instanceof DesktopApiError ? caught.details : [];
}
