import { svgMarkupToDataUrl } from "../preview/svg-image";
import { t } from "../ui/ui-locale";

type MermaidApi = typeof import("mermaid").default;

let mermaidApi: MermaidApi | null = null;
let loadPromise: Promise<MermaidApi> | null = null;
let seq = 0;

function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

async function getMermaid(): Promise<MermaidApi> {
  if (mermaidApi) return mermaidApi;
  if (!loadPromise) {
    loadPromise = import("mermaid").then((mod) => {
      const api = mod.default;
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: isDarkTheme() ? "dark" : "default",
      });
      mermaidApi = api;
      return api;
    });
  }
  return loadPromise;
}

/** 按当前文档主题同步 mermaid（dark class 切换后下次渲染生效）。 */
function syncTheme(api: MermaidApi): void {
  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDarkTheme() ? "dark" : "default",
  });
}

function mountMermaidImage(block: HTMLElement, svgMarkup: string): void {
  const dataUrl = svgMarkupToDataUrl(svgMarkup);
  if (!dataUrl) return;
  const img = document.createElement("img");
  img.className = "aui-md-img aui-mermaid-img";
  img.src = dataUrl;
  img.alt = t("mermaidAlt");
  img.draggable = false;
  block.replaceChildren(img);
  block.dataset.rendered = "true";
  block.setAttribute("role", "button");
  block.setAttribute("tabindex", "0");
  block.setAttribute("aria-label", t("mermaidZoom"));
  block.title = t("mermaidZoomTitle");
}

/**
 * 将 root 内未渲染的 `.aui-mermaid` 块画成图片。
 * 语法未完成（流式输出中）或非法时保留源码，不抛错。
 */
export async function renderMermaidIn(root: ParentNode | null | undefined): Promise<void> {
  if (!root || typeof document === "undefined") return;
  const blocks = root.querySelectorAll<HTMLElement>(".aui-mermaid:not([data-rendered])");
  if (blocks.length === 0) return;

  const api = await getMermaid();
  syncTheme(api);

  await Promise.all(
    Array.from(blocks).map(async (block) => {
      const source = block.querySelector(".aui-mermaid-source")?.textContent?.trim() ?? "";
      if (!source) return;
      const id = `aui-mermaid-${++seq}`;
      try {
        const { svg } = await api.render(id, source);
        mountMermaidImage(block, svg);
      } catch {
        /* 流式未闭合或语法错误：保留源码预览；清理 mermaid 临时节点 */
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    }),
  );
}
