import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import dns from "node:dns/promises";
import { isIP } from "node:net";

export const WEB_FETCH_TOOL = "web_fetch";
export const WEB_SEARCH_TOOL = "web_search";

const MAX_BYTES = 50_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 8;
const DDG_LITE = "https://html.duckduckgo.com/html/";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

/** 校验并规范化为可抓取的公网 http(s) URL；拒绝内网与危险主机。 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL 无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只允许 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("不允许带凭证的 URL");
  }
  const host = unwrapIpv6Hostname(url.hostname.toLowerCase());
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("不允许访问本机或本地主机名");
  }
  if (isBlockedIpLiteral(host)) {
    throw new Error("不允许访问内网或保留地址");
  }
  if (!isIP(host)) {
    const records = await dns.lookup(host, { all: true, verbatim: true }).catch(() => {
      throw new Error("无法解析主机名");
    });
    if (records.length === 0) throw new Error("无法解析主机名");
    for (const record of records) {
      if (isBlockedIpLiteral(record.address)) {
        throw new Error("主机名解析到内网或保留地址");
      }
    }
  }
  return url;
}

function unwrapIpv6Hostname(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export async function fetchPublicUrl(
  raw: string,
  signal?: AbortSignal,
): Promise<{ text: string; finalUrl: string; status: number; truncated: boolean }> {
  let current = await assertPublicHttpUrl(raw);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: combined,
      headers: {
        Accept: "text/*, application/json, application/xhtml+xml, application/xml;q=0.9, */*;q=0.1",
        "User-Agent": "AgentUp-WebFetch/1.0",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("重定向缺少 Location");
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`请求失败：HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const truncated = buffer.length > MAX_BYTES;
    const slice = truncated ? buffer.subarray(0, MAX_BYTES) : buffer;
    const text = slice.toString("utf8");
    return {
      text: truncated ? `${text}\n\n…(已截断，最多 ${MAX_BYTES} 字节)` : text,
      finalUrl: current.toString(),
      status: response.status,
      truncated,
    };
  }
  throw new Error("重定向次数过多");
}

function isBlockedIpLiteral(value: string): boolean {
  const ip = isIP(value);
  if (ip === 4) return isBlockedIpv4(value);
  if (ip === 6) return isBlockedIpv6(value);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("ff")) return true; // multicast
  // IPv4-mapped ::ffff:a.b.c.d or ::ffff:xxxx:yyyy
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isBlockedIpv4(mapped[1]!);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1]!, 16);
    const lo = Number.parseInt(mappedHex[2]!, 16);
    return isBlockedIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }
  return false;
}

/** 解析 DuckDuckGo Lite HTML，抽出标题 / URL / 摘要（无 cheerio，保持 runtime 体积小）。 */
export function parseDuckDuckGoLiteHtml(html: string, limit = MAX_SEARCH_RESULTS): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const linkRe = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null && hits.length < limit) {
    const openTag = linkMatch[0] ?? "";
    const href = decodeDuckDuckGoHref(/href="([^"]+)"/i.exec(openTag)?.[1] ?? "");
    const afterOpen = html.slice(linkMatch.index + openTag.length);
    const close = afterOpen.match(/^([\s\S]*?)<\/a>/i);
    if (!close) continue;
    const title = decodeHtmlEntities(stripTags(close[1] ?? "")).trim();
    if (!href || !title || !/^https?:\/\//i.test(href)) continue;

    const window = afterOpen.slice(0, 2_000);
    const snippetMatch =
      /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|span)>/i.exec(window);
    const snippet = decodeHtmlEntities(stripTags(snippetMatch?.[1] ?? "")).trim();
    hits.push({ title, url: href, snippet });
  }
  return hits;
}

function decodeDuckDuckGoHref(href: string): string {
  const raw = href.trim().replace(/&amp;/g, "&");
  if (!raw) return "";
  try {
    const absolute = raw.startsWith("//")
      ? `https:${raw}`
      : raw.startsWith("/")
        ? new URL(raw, DDG_LITE).toString()
        : raw;
    const parsed = new URL(absolute);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      return "";
    }
    return parsed.toString();
  } catch {
    return raw.startsWith("http") ? raw : "";
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function formatSearchHits(hits: WebSearchHit[]): string {
  if (hits.length === 0) {
    return "未找到结果（可能被限流或页面结构变化）。";
  }
  return hits
    .map((hit, index) => {
      const lines = [`${index + 1}. ${hit.title}`, `   ${hit.url}`];
      if (hit.snippet) lines.push(`   ${hit.snippet}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** 经 DuckDuckGo Lite 做无密钥网页搜索（非官方接口，可能被限流）。 */
export async function searchWeb(
  query: string,
  signal?: AbortSignal,
  limit = MAX_SEARCH_RESULTS,
): Promise<{ hits: WebSearchHit[]; status: number }> {
  const q = query.trim();
  if (!q) throw new Error("搜索词不能为空");
  if (q.length > 500) throw new Error("搜索词过长");

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const url = new URL(DDG_LITE);
  url.searchParams.set("q", q);

  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: combined,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; AgentUp-WebSearch/1.0; +https://github.com/agentup)",
    },
  });

  if (response.status === 202 || response.status === 429) {
    throw new Error("搜索被限流，请稍后再试");
  }
  if (!response.ok) {
    throw new Error(`搜索失败：HTTP ${response.status}`);
  }

  const html = await response.text();
  const hits = parseDuckDuckGoLiteHtml(html, limit);
  return { hits, status: response.status };
}

const webFetchTool = defineTool({
  name: WEB_FETCH_TOOL,
  label: "Web Fetch",
  description:
    "Fetch a public http(s) URL and return truncated text content. Use for reading web pages or public APIs. Private/local addresses are blocked.",
  parameters: Type.Object({
    url: Type.String({ description: "Public http or https URL to fetch" }),
  }),
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    destructiveHint: false,
  },
  async execute(_toolCallId, params, signal) {
    const result = await fetchPublicUrl(params.url, signal);
    return {
      content: [{ type: "text", text: result.text }],
      details: {
        url: result.finalUrl,
        status: result.status,
        truncated: result.truncated,
      },
    };
  },
});

const webSearchTool = defineTool({
  name: WEB_SEARCH_TOOL,
  label: "Web Search",
  description:
    "Search the public web (DuckDuckGo Lite, no API key). Returns titles, URLs, and snippets. May be rate-limited. Prefer this before guessing URLs; use web_fetch to read a chosen page.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
  }),
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    destructiveHint: false,
  },
  async execute(_toolCallId, params, signal) {
    const result = await searchWeb(params.query, signal);
    return {
      content: [{ type: "text", text: formatSearchHits(result.hits) }],
      details: {
        query: params.query.trim(),
        count: result.hits.length,
        status: result.status,
        results: result.hits,
      },
    };
  },
});

export function createWebToolsExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool(webSearchTool);
    pi.registerTool(webFetchTool);
  };
}
