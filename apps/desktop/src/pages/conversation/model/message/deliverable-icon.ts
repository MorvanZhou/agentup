/**
 * 交付卡片左侧非图预览：按扩展名选 Lucide 组件（对齐 path-icon 分类）。
 */

import type { Component } from "vue";
import {
  FileArchiveIcon,
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
} from "@lucide/vue";

const EXT_ICON: Record<string, Component> = {
  md: FileTextIcon,
  mdx: FileTextIcon,
  markdown: FileTextIcon,
  txt: FileTextIcon,
  rst: FileTextIcon,
  log: FileTextIcon,

  ts: FileCodeIcon,
  tsx: FileCodeIcon,
  js: FileCodeIcon,
  jsx: FileCodeIcon,
  mjs: FileCodeIcon,
  cjs: FileCodeIcon,
  vue: FileCodeIcon,
  py: FileCodeIcon,
  go: FileCodeIcon,
  rs: FileCodeIcon,
  java: FileCodeIcon,
  kt: FileCodeIcon,
  c: FileCodeIcon,
  cc: FileCodeIcon,
  cpp: FileCodeIcon,
  h: FileCodeIcon,
  hpp: FileCodeIcon,
  cs: FileCodeIcon,
  css: FileCodeIcon,
  scss: FileCodeIcon,
  less: FileCodeIcon,
  html: FileCodeIcon,
  htm: FileCodeIcon,
  sh: FileCodeIcon,
  bash: FileCodeIcon,
  zsh: FileCodeIcon,
  ps1: FileCodeIcon,
  sql: FileCodeIcon,

  json: FileJsonIcon,
  jsonc: FileJsonIcon,
  yaml: FileJsonIcon,
  yml: FileJsonIcon,
  toml: FileJsonIcon,
  xml: FileJsonIcon,

  zip: FileArchiveIcon,
  tar: FileArchiveIcon,
  gz: FileArchiveIcon,
  tgz: FileArchiveIcon,
  rar: FileArchiveIcon,
  "7z": FileArchiveIcon,
};

/** 按路径扩展名返回 Lucide 组件；未知回落通用文件图标。 */
export function deliverableFileIcon(filePath: string): Component {
  const trimmed = filePath.trim();
  if (!trimmed) return FileIcon;
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return FileIcon;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_ICON[ext] ?? FileIcon;
}
