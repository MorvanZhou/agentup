import { describe, expect, it } from "vitest";

import { vi } from "vitest";

import {
  createPlatformPinState,
  ensurePinnedPlatformSuites,
  expandPlatformMcpSuites,
  mergePlatformDeferredCallables,
  platformMcpPrefix,
  preferBrowserSuite,
  preferComputerSuite,
  queryWantsComputer,
  queryWantsPlaywright,
  rewriteToolSearchResult,
  seedPinsFromNames,
} from "../src/session/mcp/platform-tool-search.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

describe("platformMcpPrefix", () => {
  it("认 browser / playwright / computer 平台前缀", () => {
    expect(platformMcpPrefix("mcp__browser__browser_navigate")).toBe("mcp__browser__");
    expect(platformMcpPrefix("mcp__playwright__browser_click")).toBe("mcp__playwright__");
    expect(platformMcpPrefix("mcp__computer__get_app_state")).toBe("mcp__computer__");
  });

  it("其它 MCP / 内置工具不认", () => {
    expect(platformMcpPrefix("mcp__filesystem__read")).toBeUndefined();
    expect(platformMcpPrefix("bash")).toBeUndefined();
  });
});

describe("preferComputerSuite", () => {
  const all = [
    "bash",
    "mcp__computer__list_apps",
    "mcp__computer__get_app_state",
    "mcp__computer__click",
    "mcp__browser__browser_navigate",
  ];

  it("query 含 computer / 桌面时补齐 computer 套件且保留 browser", () => {
    expect(queryWantsComputer("open computer use on desktop")).toBe(true);
    expect(queryWantsComputer("系统设置")).toBe(true);
    expect(queryWantsComputer("read a file with grep")).toBe(false);
    const next = preferComputerSuite("computer", ["bash"], all, new Set());
    expect(next).toEqual(
      expect.arrayContaining([
        "bash",
        "mcp__computer__list_apps",
        "mcp__computer__get_app_state",
        "mcp__computer__click",
      ]),
    );
    // 不与 browser 互斥
    const withBrowser = preferComputerSuite(
      "computer",
      ["mcp__browser__browser_navigate"],
      all,
      new Set(),
    );
    expect(withBrowser).toContain("mcp__browser__browser_navigate");
    expect(withBrowser).toContain("mcp__computer__click");
  });
});

describe("expandPlatformMcpSuites", () => {
  const all = [
    "bash",
    "mcp__browser__browser_navigate",
    "mcp__browser__browser_click",
    "mcp__browser__browser_type",
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_snapshot",
    "mcp__other__thing",
  ];

  it("未命中平台前缀时原样返回", () => {
    expect(expandPlatformMcpSuites(["bash", "read"], all)).toEqual(["bash", "read"]);
  });

  it("命中任一 browser 工具时展开同前缀全部已注册工具", () => {
    const next = expandPlatformMcpSuites(["bash", "mcp__browser__browser_navigate"], all);
    expect(next).toEqual(
      expect.arrayContaining([
        "bash",
        "mcp__browser__browser_navigate",
        "mcp__browser__browser_click",
        "mcp__browser__browser_type",
      ]),
    );
    expect(next).not.toContain("mcp__playwright__browser_navigate");
    expect(next).not.toContain("mcp__other__thing");
  });

  it("可同时展开 browser 与 playwright 两套", () => {
    const next = expandPlatformMcpSuites(
      ["mcp__browser__browser_click", "mcp__playwright__browser_navigate"],
      all,
    );
    expect(next).toEqual(
      expect.arrayContaining([
        "mcp__browser__browser_navigate",
        "mcp__browser__browser_click",
        "mcp__browser__browser_type",
        "mcp__playwright__browser_navigate",
        "mcp__playwright__browser_snapshot",
      ]),
    );
  });

  it("去重且保留原顺序前缀", () => {
    const next = expandPlatformMcpSuites(
      ["bash", "mcp__browser__browser_click", "mcp__browser__browser_click"],
      all,
    );
    expect(next[0]).toBe("bash");
    expect(new Set(next).size).toBe(next.length);
  });
});

describe("preferBrowserSuite", () => {
  const all = [
    "bash",
    "mcp__browser__browser_navigate",
    "mcp__browser__browser_click",
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_click",
  ];

  it("模糊 browser 搜索只激活了 playwright 时改走 browser 整套", () => {
    const next = preferBrowserSuite(
      "browser click evaluate snapshot navigate",
      ["bash", "mcp__playwright__browser_click", "mcp__playwright__browser_navigate"],
      all,
      new Set(),
    );
    expect(next).toEqual(
      expect.arrayContaining(["bash", "mcp__browser__browser_navigate", "mcp__browser__browser_click"]),
    );
    expect(next.some((n) => n.startsWith("mcp__playwright__"))).toBe(false);
  });

  it("搜 computer 时不要把 playwright 命中拐成 browser", () => {
    const next = preferBrowserSuite(
      "computer desktop get_app_state",
      ["bash", "mcp__playwright__browser_click"],
      all,
      new Set(),
    );
    expect(next).toContain("mcp__playwright__browser_click");
    expect(next.filter((n) => n.startsWith("mcp__browser__"))).toEqual([]);
  });

  it("显式 playwright / preview 不抢 browser", () => {
    const next = preferBrowserSuite(
      "playwright preview_url localhost",
      ["mcp__playwright__browser_navigate"],
      all,
      new Set(),
    );
    expect(next).toEqual(
      expect.arrayContaining(["mcp__playwright__browser_navigate", "mcp__playwright__browser_click"]),
    );
    expect(next.some((n) => n.startsWith("mcp__browser__"))).toBe(false);
  });

  it("已钉住 browser 时后续 search 保 browser、丢掉 playwright", () => {
    const next = preferBrowserSuite(
      "browser click",
      ["mcp__playwright__browser_click"],
      all,
      new Set(["mcp__browser__"]),
    );
    expect(next).toEqual(
      expect.arrayContaining(["mcp__browser__browser_navigate", "mcp__browser__browser_click"]),
    );
    expect(next.some((n) => n.startsWith("mcp__playwright__"))).toBe(false);
  });

  it("queryWantsPlaywright 认 preview / headless", () => {
    expect(queryWantsPlaywright("playwright headless")).toBe(true);
    expect(queryWantsPlaywright("browser click")).toBe(false);
  });
});

describe("rewriteToolSearchResult", () => {
  const infos = [
    { name: "mcp__browser__browser_navigate", description: "Navigate\nmore" },
    { name: "mcp__browser__browser_click", description: "Click" },
    { name: "mcp__playwright__browser_navigate", description: "PW Navigate" },
    { name: "mcp__playwright__browser_click", description: "PW Click" },
    { name: "mcp__computer__list_apps", description: "List apps" },
    { name: "mcp__computer__get_app_state", description: "App AX tree" },
    { name: "mcp__computer__click", description: "Click by index" },
  ];

  it("搜 computer 时即使 BM25 命中 playwright 也改写为 computer 套件，不拐去 browser", () => {
    // 线上事故：三次 tool_search(computer…) 都被 rewrite 成 headed browser suite
    const state = createPlatformPinState();
    state.lastSearchQuery = "computer desktop app accessibility get_app_state click";
    const pi = {
      getAllTools: () => infos,
      getActiveTools: () => [
        "mcp__computer__list_apps",
        "mcp__computer__get_app_state",
        "mcp__computer__click",
      ],
    };
    const out = rewriteToolSearchResult(
      {
        content: [{ type: "text", text: "Loaded playwright…" }],
        details: { loaded: ["mcp__playwright__browser_click", "mcp__playwright__browser_navigate"] },
      },
      pi,
      state,
    );
    expect(out?.details.loaded).toEqual(
      expect.arrayContaining([
        "mcp__computer__list_apps",
        "mcp__computer__get_app_state",
        "mcp__computer__click",
      ]),
    );
    expect(out?.content[0]?.text).toContain("mcp__computer__get_app_state");
    expect(out?.content[0]?.text).toMatch(/computer/i);
    expect(out?.content[0]?.text).not.toContain("platform headed browser suite");
    expect(out?.details.loaded?.some((n) => n.startsWith("mcp__browser__"))).toBe(false);
  });

  it("BM25 只命中 playwright 时改写为 headed browser 套件文案", () => {
    const state = createPlatformPinState();
    state.lastSearchQuery = "browser click navigate";
    state.pinned.add("mcp__browser__");
    const pi = {
      getAllTools: () => infos,
      getActiveTools: () => ["mcp__browser__browser_navigate", "mcp__browser__browser_click"],
    };
    const out = rewriteToolSearchResult(
      {
        content: [{ type: "text", text: "Loaded playwright…" }],
        details: { loaded: ["mcp__playwright__browser_click", "mcp__playwright__browser_navigate"] },
      },
      pi,
      state,
    );
    expect(out?.details.loaded).toEqual([
      "mcp__browser__browser_navigate",
      "mcp__browser__browser_click",
    ]);
    expect(out?.content[0]?.text).toContain("mcp__browser__browser_navigate");
    expect(out?.content[0]?.text).toContain("do not call mcp__playwright__*");
    expect(out?.content[0]?.text).not.toContain("mcp__playwright__browser_click");
  });

  it("registry 没有 browser 时明确禁止改用 playwright", () => {
    const state = createPlatformPinState();
    state.lastSearchQuery = "browser click";
    const pi = {
      getAllTools: () => infos.filter((t) => t.name.startsWith("mcp__playwright__")),
      getActiveTools: () => [],
    };
    const out = rewriteToolSearchResult(
      {
        content: [{ type: "text", text: "Loaded…" }],
        details: { loaded: ["mcp__playwright__browser_click"] },
      },
      pi,
      state,
    );
    expect(out?.details.loaded).toEqual([]);
    expect(out?.content[0]?.text).toContain("Do NOT use `mcp__playwright__*`");
  });
});

/**
 * L3→L0：线上关窗后「not found → tool_search 只报 playwright → 模型走开头」事故路径。
 * 以后改 prefer / rewrite / pin 若弄坏这条契约，本块应先红。
 */
describe("回归：关窗后不得拐去无头 playwright", () => {
  const all = [
    "bash",
    "tool_search",
    "mcp__browser__browser_navigate",
    "mcp__browser__browser_click",
    "mcp__browser__browser_type",
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_click",
    "mcp__playwright__browser_snapshot",
  ];
  const infos = all.map((name) => ({ name, description: name }));

  it("续会话：从旧 active 名恢复 pin，并写回整套 browser", () => {
    const state = createPlatformPinState();
    // 进程重启后内存 pin 为空；transcript 恢复的 active 仍带 browser 名
    seedPinsFromNames(state, ["bash", "mcp__browser__browser_click"]);
    expect(state.pinned.has("mcp__browser__")).toBe(true);

    const setActive = vi.fn();
    const session = {
      getActiveToolNames: () => ["bash", "mcp__browser__browser_click"],
      getAllTools: () => all.map((name) => ({ name })),
      setActiveToolsByName: setActive,
    } as unknown as AgentSession;

    ensurePinnedPlatformSuites(session, state.pinned);
    expect(setActive).toHaveBeenCalled();
    const next = setActive.mock.calls[0]?.[0] as string[];
    expect(next).toEqual(
      expect.arrayContaining([
        "mcp__browser__browser_navigate",
        "mcp__browser__browser_click",
        "mcp__browser__browser_type",
      ]),
    );
  });

  it("事故复现管线：BM25 只命中 playwright → 激活集与文案都改回 browser", () => {
    const state = createPlatformPinState();
    state.lastSearchQuery = "browser click evaluate snapshot navigate";
    // 上一回合用过 headed（关窗前）
    seedPinsFromNames(state, ["mcp__browser__browser_navigate"]);

    // stock tool_search：active 已有 browser 时候选只剩 playwright
    const stockActivate = [
      "bash",
      "mcp__browser__browser_navigate",
      "mcp__browser__browser_click",
      "mcp__playwright__browser_click",
      "mcp__playwright__browser_navigate",
    ];
    const activated = preferBrowserSuite(state.lastSearchQuery, stockActivate, all, state.pinned);
    expect(activated.some((n) => n.startsWith("mcp__playwright__"))).toBe(false);
    expect(activated).toEqual(
      expect.arrayContaining(["mcp__browser__browser_navigate", "mcp__browser__browser_click"]),
    );

    const rewritten = rewriteToolSearchResult(
      {
        content: [{ type: "text", text: "Loaded 8 tools… mcp__playwright__…" }],
        details: {
          loaded: [
            "mcp__playwright__browser_click",
            "mcp__playwright__browser_navigate",
            "mcp__playwright__browser_snapshot",
          ],
        },
      },
      {
        getAllTools: () => infos,
        getActiveTools: () => activated,
      },
      state,
    );
    expect(rewritten?.details.loaded.every((n) => n.startsWith("mcp__browser__"))).toBe(true);
    expect(rewritten?.content[0]?.text).toContain("headed browser");
    expect(rewritten?.content[0]?.text).not.toMatch(/mcp__playwright__browser_/);
  });

  it("snapshot 救援：声明集被清空后仍能从 deferred callables 找回 browser", () => {
    // 对应 transcript toolsRemoved 整套后 createContextSnapshot 只剩内置工具
    const declared = [{ name: "bash" }, { name: "tool_search" }];
    const callables = all.map((name) => ({ name }));
    const merged = mergePlatformDeferredCallables(declared, callables);
    expect(merged.map((t) => t.name)).toEqual(
      expect.arrayContaining(["mcp__browser__browser_navigate", "mcp__browser__browser_click"]),
    );
    // 可执行集有了，模型点名 mcp__browser__* 才进得了 bridge → 才会重开有窗
  });
});

describe("mergePlatformDeferredCallables", () => {
  it("把未进 snapshot 的平台 deferred 工具并入可执行集", () => {
    const declared = [{ name: "bash" }, { name: "tool_search" }];
    const callables = [
      { name: "bash" },
      { name: "mcp__browser__browser_navigate" },
      { name: "mcp__playwright__browser_click" },
      { name: "mcp__other__x" },
    ];
    const merged = mergePlatformDeferredCallables(declared, callables);
    expect(merged.map((t) => t.name)).toEqual([
      "bash",
      "tool_search",
      "mcp__browser__browser_navigate",
      "mcp__playwright__browser_click",
    ]);
  });

  it("已声明的不重复追加", () => {
    const declared = [{ name: "mcp__browser__browser_navigate" }];
    const callables = [{ name: "mcp__browser__browser_navigate" }, { name: "mcp__browser__browser_click" }];
    const merged = mergePlatformDeferredCallables(declared, callables);
    expect(merged.map((t) => t.name)).toEqual([
      "mcp__browser__browser_navigate",
      "mcp__browser__browser_click",
    ]);
  });
});
