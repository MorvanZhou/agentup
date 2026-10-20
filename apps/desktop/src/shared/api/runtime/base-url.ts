/** 开发态走 Vite `/runtime` 代理；打包后直连本机 runtime。 */
export function runtimeBaseUrl(prod = import.meta.env.PROD): string {
  if (prod) return "http://127.0.0.1:47391";
  return "/runtime";
}
