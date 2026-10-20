import type { PackageIssue } from "../package/validate.js";

import { BackendClientError } from "./errors.js";

export async function requestForm(
  fetchImpl: typeof fetch,
  backendUrl: string,
  method: string,
  path: string,
  form: FormData,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchBackend(fetchImpl, backendUrl, path, {
    method,
    headers,
    body: form,
  });
  return readJsonRecord(response);
}

export async function requestJson(
  fetchImpl: typeof fetch,
  backendUrl: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchBackend(fetchImpl, backendUrl, path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJsonRecord(response);
}

async function fetchBackend(
  fetchImpl: typeof fetch,
  backendUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${backendUrl.replace(/\/$/, "")}${path}`;
  try {
    return await fetchImpl(url, init);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new BackendClientError(`无法连接控制面 ${backendUrl}: ${detail}`, 502);
  }
}

export async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BackendClientError(
      `控制面返回非 JSON（HTTP ${response.status}）`,
      response.status >= 400 ? response.status : 502,
    );
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new BackendClientError("响应不是 JSON", response.status >= 400 ? response.status : 502);
  }
  const record = payload as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof record.error === "string" ? record.error : "请求失败";
    throw new BackendClientError(message, response.status, readDetails(record.details));
  }
  return record;
}

export function decodeHeader(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
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
