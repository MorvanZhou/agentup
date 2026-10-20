import dns from "node:dns/promises";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  assertPublicHttpUrl,
  fetchPublicUrl,
  parseDuckDuckGoLiteHtml,
  searchWeb,
} from "../src/session/tools/index.js";

beforeEach(() => {
  vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("rejects private hosts and credentials before fetching", async () => {
  await expect(assertPublicHttpUrl("http://127.0.0.1/secret")).rejects.toThrow(/内网|本机/);
  await expect(assertPublicHttpUrl("http://192.168.1.1/")).rejects.toThrow(/内网/);
  await expect(assertPublicHttpUrl("http://10.0.0.2/")).rejects.toThrow(/内网/);
  await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow(/内网|本机/);
  await expect(assertPublicHttpUrl("http://localhost/")).rejects.toThrow(/本机/);
  await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  await expect(assertPublicHttpUrl("https://user:pass@example.com/")).rejects.toThrow(/凭证/);
});

it("rejects hostnames that resolve to private addresses", async () => {
  vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }] as never);
  await expect(assertPublicHttpUrl("https://evil.example/")).rejects.toThrow(/内网/);
});

it("fetches a public URL and truncates large bodies", async () => {
  const body = "x".repeat(60_000);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ),
  );
  const result = await fetchPublicUrl("https://example.com/doc");
  expect(result.status).toBe(200);
  expect(result.truncated).toBe(true);
  expect(result.text.endsWith("…(已截断，最多 50000 字节)")).toBe(true);
  expect(result.finalUrl).toBe("https://example.com/doc");
});

it("re-validates redirect targets and refuses private hops", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    ),
  );
  await expect(fetchPublicUrl("https://example.com/jump")).rejects.toThrow(/内网|本机/);
});

const DDG_FIXTURE = `
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Official documentation &amp; guides</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a class="result__a" href="https://news.ycombinator.com/item?id=1">HN Thread</a>
  </h2>
  <a class="result__snippet" href="https://news.ycombinator.com/item?id=1">Discussion about agents</a>
</div>
`;

it("parses DuckDuckGo Lite HTML and unwraps uddg redirects", () => {
  const hits = parseDuckDuckGoLiteHtml(DDG_FIXTURE);
  expect(hits).toEqual([
    {
      title: "Example Docs",
      url: "https://example.com/docs",
      snippet: "Official documentation & guides",
    },
    {
      title: "HN Thread",
      url: "https://news.ycombinator.com/item?id=1",
      snippet: "Discussion about agents",
    },
  ]);
});

it("searches via DuckDuckGo Lite and surfaces rate limits", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(DDG_FIXTURE, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ),
  );
  const result = await searchWeb("agent tools");
  expect(result.hits).toHaveLength(2);
  expect(result.hits[0]?.url).toBe("https://example.com/docs");

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 202 })),
  );
  await expect(searchWeb("agent tools")).rejects.toThrow(/限流/);
});
