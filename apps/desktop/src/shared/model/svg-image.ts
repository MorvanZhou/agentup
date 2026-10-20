/** 将 SVG 标记转为可给 <img> 使用的 data URL。 */
export function svgMarkupToDataUrl(svgMarkup: string): string {
  let markup = svgMarkup.trim();
  if (!markup) return "";
  if (!/\sxmlns=/.test(markup)) {
    markup = markup.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // mermaid 常带 width="100%"，作 <img> 时固有尺寸会塌成 0，改用 viewBox
  const viewBox = markup.match(
    /viewBox=["']?\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)["']?/i,
  );
  if (viewBox) {
    const w = viewBox[3]!;
    const h = viewBox[4]!;
    if (/\swidth=["']100%["']/i.test(markup)) {
      markup = markup.replace(/\swidth=["']100%["']/i, ` width="${w}"`);
    } else if (!/\swidth=/i.test(markup)) {
      markup = markup.replace(/<svg\b/i, `<svg width="${w}"`);
    }
    if (!/\sheight=/i.test(markup)) {
      markup = markup.replace(/<svg\b/i, `<svg height="${h}"`);
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** 序列化 SVG 元素为 data URL（预览 / 内联 img 共用）。 */
export function svgElementToDataUrl(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  // img 需要明确尺寸时，从 viewBox 回填
  if (!clone.getAttribute("width") || !clone.getAttribute("height")) {
    const viewBox = clone.getAttribute("viewBox")?.trim().split(/[\s,]+/);
    if (viewBox && viewBox.length === 4) {
      const w = Number(viewBox[2]);
      const h = Number(viewBox[3]);
      if (Number.isFinite(w) && w > 0 && !clone.getAttribute("width")) {
        clone.setAttribute("width", String(w));
      }
      if (Number.isFinite(h) && h > 0 && !clone.getAttribute("height")) {
        clone.setAttribute("height", String(h));
      }
    }
  }
  return svgMarkupToDataUrl(new XMLSerializer().serializeToString(clone));
}
