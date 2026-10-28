/** @vitest-environment happy-dom */
import { computed, nextTick } from "vue";
import { expect, it, vi } from "vitest";

import GroupDelegationBubble from "../../src/pages/conversation/components/chat-main/group/GroupDelegationBubble.vue";
import {
  groupDelegationRuntimeKey,
  groupWaitingTaskIdsKey,
  type GroupDelegationCard,
} from "../../src/pages/conversation/model/group/group-delegation.js";
import { mountView } from "./mount-view.js";

const card: GroupDelegationCard = {
  id: "d1",
  taskId: "task-design",
  authorId: "design",
  authorName: "设计师",
  avatarUrl: "https://cdn.example/design.webp",
  role: "视觉",
  brief: "做登录页",
  summary: "登录页已完成",
  activity: "running",
  handoff: "pending",
  outcome: "completed",
};

function mount(
  next: GroupDelegationCard,
  waiting: string[] = [],
  runtime: { token: string; userId: string } = { token: "", userId: "" },
): HTMLElement {
  return mountView(GroupDelegationBubble, {
    props: { card: next },
    provide: [
      [groupWaitingTaskIdsKey, computed(() => waiting)],
      [groupDelegationRuntimeKey, computed(() => runtime)],
    ],
  });
}

function tab(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="delegation-tab-${id}"]`);
}

/** reka 的 tab 在 mousedown 时切换，click 不会改选中。 */
function pressTab(host: HTMLElement, id: string): void {
  tab(host, id)?.dispatchEvent(
    new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }),
  );
}

async function frames(count = 8): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("hides the card handoff summary and keeps its brief as the only unsigned tab", async () => {
  const host = mount(card);
  expect(host.querySelector('img[alt="设计师"]')?.getAttribute("src")).toBe(
    "https://cdn.example/design.webp",
  );
  expect(host.textContent).toContain("设计师");
  expect(host.textContent).toContain("视觉");
  const phase = host.querySelector<HTMLButtonElement>('button[aria-expanded]');
  expect(phase?.getAttribute("aria-label")).toBe("完成待汇总");
  expect(host.textContent).not.toContain("完成待汇总");
  phase?.click();
  await nextTick();
  expect(host.textContent).toContain("完成待汇总");
  expect(host.textContent).not.toContain("登录页已完成");
  expect(host.textContent).toContain("做登录页");
  expect(tab(host, "process")).toBeNull();
  expect(tab(host, "brief")).toBeNull();
});

const signedIn = { token: "tok", userId: "user-1" };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

it("loads the initially selected process and stops when leaving history tabs", async () => {
  const calls: string[] = [];
  let streamSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/history")) {
        return jsonResponse({
          task: { id: "task-design", status: "running", to_agent_id: "design" },
          messages: [],
        });
      }
      streamSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
      });
    },
  );
  try {
    const host = mount(card, [], signedIn);
    for (let i = 0; i < 20 && !streamSignal; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(calls.some((url) => url.includes("/personal-assistant/delegations/task-design/history"))).toBe(
      true,
    );
    expect(streamSignal?.aborted).toBe(false);

    pressTab(host, "brief");
    await nextTick();
    expect(streamSignal?.aborted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not show a summary tab when leaving process before the task finishes", async () => {
  let streamSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/history")) {
        return jsonResponse({
          task: { id: "task-design", status: "running", to_agent_id: "design" },
          messages: [
            {
              id: "deleg-assistant",
              role: "assistant",
              parts: [{ type: "text", text: "还在看布局", state: "done" }],
            },
          ],
        });
      }
      streamSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
      });
    },
  );
  try {
    const host = mount(card, [], signedIn);
    for (let i = 0; i < 20 && !streamSignal; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(streamSignal?.aborted).toBe(false);
    expect(tab(host, "summary")).toBeNull();

    pressTab(host, "brief");
    await frames();
    expect(tab(host, "brief")?.getAttribute("data-state")).toBe("active");
    expect(tab(host, "summary")).toBeNull();
    expect(host.textContent).toContain("做登录页");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("opens the process immediately when the card has no summary", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/history")) {
      return jsonResponse({
        task: { id: "task-design", status: "completed", to_agent_id: "design" },
        messages: [
          {
            id: "deleg-assistant",
            role: "assistant",
            parts: [
              { type: "text", text: "先看布局", state: "done" },
              { type: "text", text: "登录页结构好了", state: "done" },
            ],
          },
        ],
      });
    }
    return jsonResponse({ error: "no stream" });
  });
  try {
    const host = mount({ ...card, summary: "" }, [], signedIn);
    await frames();
    expect(calls.some((url) => url.includes("/personal-assistant/delegations/task-design/history"))).toBe(
      true,
    );
    expect(tab(host, "process")?.getAttribute("data-state")).toBe("active");
    expect(host.textContent).toContain("登录页结构好了");
    expect(tab(host, "summary")).not.toBeNull();
    expect(host.querySelector('[data-testid^="delegation-product-"]')).toBeNull();

    pressTab(host, "summary");
    await frames();
    expect(tab(host, "summary")?.getAttribute("data-state")).toBe("active");
    expect(host.textContent).toContain("登录页结构好了");
    expect(host.textContent).not.toContain("先看布局");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("renders a sparse in-flight card without process tabs", () => {
  const host = mount({
    id: "d2",
    taskId: "",
    authorId: "",
    authorName: "",
    brief: "",
    summary: "",
    activity: "queued",
    handoff: "pending",
  });
  expect(host.querySelector<HTMLButtonElement>('button[aria-expanded]')?.getAttribute("aria-label")).toBe(
    "排队中",
  );
  expect(tab(host, "process")).toBeNull();
  expect(tab(host, "brief")).toBeNull();
});
