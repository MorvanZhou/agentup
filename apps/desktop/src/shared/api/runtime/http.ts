import type { PackageIssue } from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";

export class RuntimeHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly baseUrl = "/runtime",
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async request(
    path: string,
    token?: string,
    body?: Record<string, unknown>,
    method?: "GET" | "POST" | "PUT" | "DELETE",
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: method ?? (body ? "POST" : "GET"),
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new DesktopApiError("本机 runtime 没有启动");
    }
    const payload = (await response.json()) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DesktopApiError("响应不是 JSON");
    }
    const record = payload as Record<string, unknown>;
    if (!response.ok) {
      throw new DesktopApiError(
        typeof record.error === "string" ? record.error : "请求失败",
        response.status,
        readDetails(record.details),
      );
    }
    return record;
  }
}

function readDetails(value: unknown): PackageIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).path === "string" &&
      typeof (item as Record<string, unknown>).message === "string"
    ) {
      const record = item as Record<string, string>;
      return [{ path: record.path, message: record.message }];
    }
    return [];
  });
}
