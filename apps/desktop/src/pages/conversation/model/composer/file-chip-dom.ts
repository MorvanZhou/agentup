import { isAttachmentFolderPath, middleEllipsisFileName } from "./attachment-ref";

/**
 * Composer contenteditable 里的 `@ATTACHMENTS/...` 文件 / 文件夹芯片 DOM 工厂。
 * 只用于非图片。图片走 Composer 附件条（ImageAttachmentPreview），不嵌进芯片。
 * 芯片原子（contentEditable=false），serialize / copy / 光标按 data-file 整体处理。
 * 目录 path 约定尾 `/`，芯片显示文件夹图标（与 FileChip.vue 对齐）。
 */
export function createFileChipDom(
  path: string,
  name: string,
  options: { onRemove: (path: string) => void; folder?: boolean },
): HTMLSpanElement {
  const folder = options.folder ?? isAttachmentFolderPath(path);
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.file = path;
  if (folder) chip.dataset.folder = "1";
  chip.className =
    "mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0 align-baseline text-xs font-medium text-accent";
  chip.title = `@${path}`;
  const icon = createChipIconSvg(folder);
  const label = document.createElement("span");
  label.textContent = middleEllipsisFileName(name, 28);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className =
    "grid size-3.5 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 text-accent/70 hover:bg-accent/15 hover:text-accent";
  remove.setAttribute("aria-label", `移除 ${name}`);
  remove.textContent = "×";
  remove.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onRemove(path);
  });
  chip.append(icon, label, remove);
  return chip;
}

/** 极简 Lucide 形 SVG（DOM 芯片无法直接挂 Vue 图标）。 */
function createChipIconSvg(folder: boolean): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "size-3.5 shrink-0 opacity-90");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Lucide folder / file 路径
  path.setAttribute(
    "d",
    folder
      ? "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
      : "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
  );
  svg.append(path);
  if (!folder) {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    polyline.setAttribute("d", "M14 2v4a2 2 0 0 0 2 2h4");
    svg.append(polyline);
  }
  return svg;
}
