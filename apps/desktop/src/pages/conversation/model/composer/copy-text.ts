import { stripSyntheticImageCaption } from "./image-caption";
import { serializeComposerSegments, type ComposerSegment } from "./skill-text";

/** 选区复制：去掉多余空行，保留单行换行；识图尺寸说明不进剪贴板。 */
export function sanitizeCopiedText(text: string): string {
  return stripSyntheticImageCaption(text)
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** 供测试与选区序列化共用的轻量 DOM 节点形态。 */
export type ComposerDomNode = {
  nodeType: number;
  textContent?: string | null;
  tagName?: string;
  dataset?:
    | DOMStringMap
    | { skill?: string; mention?: string; file?: string; folder?: string; copyIgnore?: string };
  childNodes?: ArrayLike<ComposerDomNode>;
};

/** 块级标签：子树后补换行，避免 Markdown/工具卡壳粘成一行。 */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "PRE",
  "BLOCKQUOTE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "HR",
]);

function hasCopyIgnore(node: ComposerDomNode): boolean {
  return node.dataset != null && "copyIgnore" in node.dataset;
}

function walkChildren(
  node: { childNodes?: ArrayLike<ComposerDomNode> },
  visit: (child: ComposerDomNode) => void,
): void {
  const children = node.childNodes;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) visit(children[i]!);
}

/**
 * 把 DOM 子树序列化为 Composer 可识别文本（`/skill`、`@成员`、`@ATTACHMENTS/...`）。
 * 依赖芯片根节点带 `data-skill` / `data-mention` / `data-file`。
 * `data-copy-ignore` 整棵跳过（操作栏等 chrome）。
 */
export function domToComposerText(root: { childNodes: ArrayLike<ComposerDomNode> }): string {
  const segments: ComposerSegment[] = [];
  const walk = (node: ComposerDomNode) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const value = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (value) segments.push({ type: "text", value });
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    if (hasCopyIgnore(node)) return;
    const skill = node.dataset?.skill;
    if (skill) {
      segments.push({ type: "skill", name: skill });
      return;
    }
    const mention = node.dataset?.mention;
    if (mention) {
      segments.push({ type: "mention", name: mention });
      return;
    }
    const file = node.dataset?.file;
    if (file) {
      // 目录芯片 path 带尾 `/`，勿用 pop() 落到空串
      const base = file.replace(/\/+$/, "").split("/").pop() || file;
      segments.push({
        type: "file",
        path: file,
        name: base,
        folder: node.dataset?.folder === "1" || file.endsWith("/") || undefined,
      });
      return;
    }
    if (node.tagName === "BR") {
      segments.push({ type: "text", value: "\n" });
      return;
    }
    walkChildren(node, walk);
  };
  walkChildren(root, walk);
  return sanitizeCopiedText(serializeComposerSegments(segments));
}

/** 把 DOM 选区序列化为 Composer 文本。 */
export function selectionToComposerText(range: Range): string {
  return domToComposerText(range.cloneContents());
}

/**
 * 气泡选区 → 纯文本：块级换行、跳过 `data-copy-ignore`，再 sanitize 尾部空行。
 * Agent Markdown / 过程区拖选用这个，避免壳节点吐出一串空白。
 */
export function domToPlainText(root: { childNodes: ArrayLike<ComposerDomNode> }): string {
  let out = "";
  const walk = (node: ComposerDomNode) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out += (node.textContent ?? "").replace(/\u00a0/g, " ");
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    if (hasCopyIgnore(node)) return;
    const tag = (node.tagName ?? "").toUpperCase();
    if (tag === "BR") {
      out += "\n";
      return;
    }
    walkChildren(node, walk);
    if (BLOCK_TAGS.has(tag)) out += "\n";
  };
  walkChildren(root, walk);
  return sanitizeCopiedText(out);
}

/** 把 DOM 选区序列化为纯文本（Agent 气泡拖选）。 */
export function selectionToPlainText(range: Range): string {
  return domToPlainText(range.cloneContents());
}
