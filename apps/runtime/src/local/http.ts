import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HttpBindings } from "@hono/node-server";

import type { LocalConfig, ModelConfig } from "../config/load.js";
import { localeFromRequest, type UiLocale } from "../i18n/index.js";
import type { BackgroundJobs } from "../session/background/index.js";
import type { ApprovalBroker } from "../session/hitl/approval/index.js";
import type { ShellHangBroker } from "../session/hitl/shell-hang/index.js";
import type { DelegationService } from "../session/delegation/index.js";
import type { GroupRooms, GroupTurns } from "../session/group/index.js";
import type { AskUserBroker } from "../session/tools/index.js";
import type { VisitChats } from "../session/turn/index.js";

export const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export type LocalAppEnv = { Bindings: HttpBindings };

export interface LocalAppDeps {
  config: LocalConfig;
  chats: VisitChats;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  shellHang: ShellHangBroker;
  delegation: DelegationService;
  groups: GroupRooms;
  groupTurns: GroupTurns;
  backgroundJobs: BackgroundJobs;
  readModel: () => ModelConfig;
}

export class LocalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function bearer(c: Context<LocalAppEnv>): string {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw new LocalError("未登录", 401);
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new LocalError("未登录", 401);
  return token;
}

export function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new LocalError("请求无效", 400);
  return value;
}

export function requireUserId(value: string | null): string {
  if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value)) {
    throw new LocalError("请求无效", 400);
  }
  return value;
}

/** 路径参数里的 agent_id；非法时 400。 */
export function requireAgentId(value: string): string {
  if (!AGENT_ID.test(value)) throw new LocalError("agent_id 无效", 400);
  return value;
}

/** body / query 里的 user_id（允许先取空串再校验）。 */
export function requirePathUserId(value: string): string {
  if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value)) {
    throw new LocalError("请求无效", 400);
  }
  return value;
}

export function optionalText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) throw new LocalError("请求无效", 400);
  return value;
}

/** 桌面端 `?lang=` / `x-ui-locale`；缺省中文。 */
export function uiLocaleFromRequest(c: Context<LocalAppEnv>): UiLocale {
  return localeFromRequest(c.req.query("lang"), c.req.header("x-ui-locale"));
}

export async function readJson(c: Context<LocalAppEnv>): Promise<Record<string, unknown>> {
  const contentLength = c.req.header("content-length");
  if (contentLength && Number(contentLength) > 1_000_000) throw new LocalError("请求过大", 413);
  const buffer = Buffer.from(await c.req.arrayBuffer());
  if (buffer.length > 1_000_000) throw new LocalError("请求过大", 413);
  if (buffer.length === 0) return {};
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new LocalError("请求不是 JSON", 400);
  }
}

export function loopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export function json(c: Context<LocalAppEnv>, status: ContentfulStatusCode, payload: unknown) {
  return c.json(payload, status);
}

export function sendNodeJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length });
  res.end(body);
}
