import type { PackageIssue } from "../package/validate.js";

export class BackendClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: PackageIssue[] = [],
  ) {
    super(message);
  }
}
