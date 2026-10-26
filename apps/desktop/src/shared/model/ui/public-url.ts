/**
 * Vite `public/` 资源 URL（跟 `vite.config` 的 `base`）。
 * 发布态 Electron `loadFile` 走 `file://`，根路径 `/xxx` 会落到磁盘根；须用 BASE_URL。
 * @see https://www.electronforge.io/config/plugins/vite#renderer-base-path
 */
export function publicUrl(assetPath: string): string {
  const name = assetPath.replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${name}`;
}
