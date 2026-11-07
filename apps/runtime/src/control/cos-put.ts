import crypto from "node:crypto";

import { BackendClientError } from "./errors.js";

/** 临时密钥直传或直读一个对象。签名与 backend `core/cos_sign.py` 同一套 v5。 */
export interface ObjectCredential {
  bucket: string;
  region: string;
  key: string;
  tmp_secret_id: string;
  tmp_secret_key: string;
  session_token: string;
  content_type?: string;
}

export async function putCosObject(
  credential: ObjectCredential,
  body: Uint8Array,
  fetchImpl: typeof fetch,
  options: { forbidOverwrite?: boolean } = {},
): Promise<void> {
  const contentType = credential.content_type || "application/octet-stream";
  const headers: Record<string, string> = {
    host: cosHost(credential),
    "content-type": contentType,
    "x-cos-security-token": credential.session_token,
  };
  // 头像和旧整包禁止覆盖。skill / hooks / mcp / settings 的 key 固定，允许覆盖。
  if (options.forbidOverwrite !== false) headers["x-cos-forbid-overwrite"] = "true";
  const response = await signedRequest(credential, "PUT", headers, body, fetchImpl);
  if (response.status === 409 || response.ok) return;
  throw new BackendClientError("上传对象失败", response.status);
}

export async function getCosObject(
  credential: ObjectCredential,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const headers: Record<string, string> = {
    host: cosHost(credential),
    "x-cos-security-token": credential.session_token,
  };
  const response = await signedRequest(credential, "GET", headers, undefined, fetchImpl);
  if (!response.ok) throw new BackendClientError("下载对象失败", response.status);
  return new Uint8Array(await response.arrayBuffer());
}

export function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  );
}

function cosHost(credential: ObjectCredential): string {
  // region=local 只给测试把请求打回本机。正式凭证的 region 是 ap- 开头。
  if (credential.region === "local") return credential.bucket;
  return `${credential.bucket}.cos.${credential.region}.myqcloud.com`;
}

function objectUrl(credential: ObjectCredential, uri: string): string {
  if (credential.region === "local") return `http://${cosHost(credential)}${uri}`;
  return `https://${cosHost(credential)}${uri}`;
}

async function signedRequest(
  credential: ObjectCredential,
  method: "PUT" | "GET",
  headers: Record<string, string>,
  body: Uint8Array | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const uri = `/${encodeKey(credential.key)}`;
  const authorization = sign(method, uri, credential.tmp_secret_id, credential.tmp_secret_key, headers);
  const url = objectUrl(credential, uri);
  const requestHeaders: Record<string, string> = { authorization };
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "host") requestHeaders[key] = value;
  }
  return fetchImpl(url, {
    method,
    headers: requestHeaders,
    body: body ? Buffer.from(body) : undefined,
  });
}

function sign(
  method: string,
  uri: string,
  secretId: string,
  secretKey: string,
  headers: Record<string, string>,
): string {
  const start = Math.floor(Date.now() / 1000);
  const keyTime = `${start};${start + 600}`;
  const signKey = crypto.createHmac("sha1", secretKey).update(keyTime).digest("hex");
  const [paramString, paramList] = canonical({});
  const [headerString, headerList] = canonical(headers);
  const httpString = `${method.toLowerCase()}\n${uri}\n${paramString}\n${headerString}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash("sha1").update(httpString).digest("hex")}\n`;
  const signature = crypto.createHmac("sha1", signKey).update(stringToSign).digest("hex");
  return (
    "q-sign-algorithm=sha1"
    + `&q-ak=${secretId}`
    + `&q-sign-time=${keyTime}`
    + `&q-key-time=${keyTime}`
    + `&q-header-list=${headerList}`
    + `&q-url-param-list=${paramList}`
    + `&q-signature=${signature}`
  );
}

function canonical(values: Record<string, string>): [string, string] {
  const items = Object.entries(values)
    .map(([key, value]) => [key.toLowerCase(), encodeURIComponent(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return [
    items.map(([key, value]) => `${key}=${value}`).join("&"),
    items.map(([key]) => key).join(";"),
  ];
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}
