import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import hljs from "highlight.js/lib/common";

/** Lucide copy / check 的精简 path，供 fence HTML 内联（v-html 无法挂 Vue 组件）。 */
const COPY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * 对齐 assistant-ui MarkdownText / Streamdown 常见配置：
 * GFM 表格与删除线、外链新窗口、围栏代码语言头 + 复制、highlight.js 高亮、mermaid 占位。
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

md.set({
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* 非法片段时回退为转义原文 */
      }
    }
    return md.utils.escapeHtml(str);
  },
});

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

function setTokenAttr(token: Token, name: string, value: string): void {
  const i = token.attrIndex(name);
  if (i < 0) token.attrPush([name, value]);
  else if (token.attrs) token.attrs[i][1] = value;
}

function appendTokenClass(token: Token, className: string): void {
  const classIndex = token.attrIndex("class");
  if (classIndex < 0) {
    token.attrPush(["class", className]);
    return;
  }
  if (!token.attrs) return;
  const current = String(token.attrs[classIndex][1] ?? "");
  if (!current.split(/\s+/).includes(className)) {
    token.attrs[classIndex][1] = `${current} ${className}`.trim();
  }
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  setTokenAttr(token, "target", "_blank");
  setTokenAttr(token, "rel", "noopener noreferrer");
  appendTokenClass(token, "aui-md-a");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  appendTokenClass(token, "aui-md-img");
  setTokenAttr(token, "loading", "lazy");
  return defaultImage(tokens, idx, options, env, self);
};

md.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : "";
  const lang = info.split(/\s+/g)[0] ?? "";

  // mermaid：输出占位，由 MarkdownText 挂载后调用 mermaid.render
  if (lang === "mermaid") {
    const source = md.utils.escapeHtml(token.content);
    return `<div class="aui-mermaid"><pre class="aui-mermaid-source">${source}</pre></div>`;
  }

  const langClass = lang ? ` language-${md.utils.escapeHtml(lang)}` : "";
  const highlighted = options.highlight?.(token.content, lang, "") ?? md.utils.escapeHtml(token.content);
  const label = md.utils.escapeHtml(lang || "text");

  return [
    `<div class="aui-code-block">`,
    `<div class="aui-code-header">`,
    `<span class="aui-code-lang">${label}</span>`,
    `<button type="button" class="aui-code-copy" data-copy-ignore aria-label="Copy code">`,
    `<span class="aui-code-copy-idle">${COPY_SVG}</span>`,
    `<span class="aui-code-copy-done">${CHECK_SVG}</span>`,
    `<span class="aui-code-copy-label">Copy</span>`,
    `</button>`,
    `</div>`,
    `<pre class="aui-md-pre"><code class="hljs${langClass}">${highlighted}</code></pre>`,
    `</div>`,
  ].join("");
};

export function renderMarkdown(source: string): string {
  if (!source) return "";
  return md.render(source);
}
