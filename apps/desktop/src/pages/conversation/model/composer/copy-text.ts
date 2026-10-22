import { serializeComposerSegments, type ComposerSegment } from "./skill-text";

/** 选区复制：去掉多余空行，保留单行换行。 */
export function sanitizeCopiedText(text: string): string {
  return text
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
  dataset?: DOMStringMap | { skill?: string; file?: string };
  childNodes?: ArrayLike<ComposerDomNode>;
};

/**
 * 把 DOM 子树序列化为 Composer 可识别文本（`/skill`、`@ATTACHMENTS/...`）。
 * 依赖芯片根节点带 `data-skill` / `data-file`。
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
    const skill = node.dataset?.skill;
    if (skill) {
      segments.push({ type: "skill", name: skill });
      return;
    }
    const file = node.dataset?.file;
    if (file) {
      segments.push({
        type: "file",
        path: file,
        name: file.split("/").pop() || file,
      });
      return;
    }
    if (node.tagName === "BR") {
      segments.push({ type: "text", value: "\n" });
      return;
    }
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i += 1) walk(children[i]!);
  };
  const children = root.childNodes;
  for (let i = 0; i < children.length; i += 1) walk(children[i]!);
  return sanitizeCopiedText(serializeComposerSegments(segments));
}

/** 把 DOM 选区序列化为 Composer 文本。 */
export function selectionToComposerText(range: Range): string {
  return domToComposerText(range.cloneContents());
}
