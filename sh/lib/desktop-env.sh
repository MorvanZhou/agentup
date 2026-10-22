# Desktop 环境选择：由 start-desktop / build-mac / build-win source。
# 用法: desktop_env_parse [default] "$@" → 设置 MODE；再 desktop_env_apply
# shellcheck shell=sh

desktop_env_parse() {
  MODE="${1:-dev}"
  shift
  for arg in "$@"; do
    case "$arg" in
      --prod) MODE=prod ;;
      --dev) MODE=dev ;;
      -h|--help) return 2 ;;
      *)
        echo "未知参数: $arg" >&2
        return 1
        ;;
    esac
  done
  return 0
}

desktop_env_usage() {
  cmd="$1"
  default_mode="${2:-dev}"
  echo "用法: sh sh/${cmd} [--prod|--dev]"
  echo "  默认 --${default_mode}；URL 见 apps/desktop/electron/env-profiles.cjs"
  echo "  单 URL 覆盖：AGENTUP_BACKEND_URL / AGENTUP_WEB_URL"
}

# 依赖仓库根目录为 cwd；按 MODE 导出 AGENTUP_DESKTOP_ENV 并打印解析结果
desktop_env_apply() {
  export AGENTUP_DESKTOP_ENV="$MODE"
  node -e '
    const c = require("./apps/desktop/electron/release-config.cjs");
    console.log(`Desktop: ${c.env} — backend=${c.backendUrl} web=${c.webUrl}`);
  '
}

# 写入打包 stamp（打进 asar）；调用方负责在 pack 结束后删除
desktop_env_write_pack_target() {
  target="apps/desktop/electron/release-target.generated.cjs"
  printf 'module.exports = "%s";\n' "$AGENTUP_DESKTOP_ENV" >"$target"
  echo "Desktop: 已写入打包目标 ${target} → ${AGENTUP_DESKTOP_ENV}"
}

desktop_env_clear_pack_target() {
  rm -f apps/desktop/electron/release-target.generated.cjs
}
