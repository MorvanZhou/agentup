import type { PackageIssue } from "../../model/runtime";

export class DesktopApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details: PackageIssue[] = [],
  ) {
    super(message);
  }
}
