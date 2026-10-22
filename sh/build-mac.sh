#!/bin/sh
# 构建未签名的 macOS arm64 应用（.app / .dmg / .zip）：sh sh/build-mac.sh [--prod|--dev]
# 默认 --prod（打进正式控制面 / 登录门面）；--dev 打进本机 URL
#
# runtime 依赖打包注意（dmg ~160MB；若涨到 210MB+ 多半是 symlink 被解引用）：
#   见 apps/desktop/electron/pack-runtime-modules.cjs 文件头「打包注意事项」
#   首次启动会解压 node_modules.tgz；以后若签名/公证勿再改 .app 内文件
set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. sh/lib/desktop-env.sh

status=0
desktop_env_parse prod "$@" || status=$?
if [ "$status" -eq 2 ]; then
  desktop_env_usage "build-mac.sh" "prod"
  exit 0
fi
if [ "$status" -ne 0 ]; then
  desktop_env_usage "build-mac.sh" "prod" >&2
  exit 1
fi
desktop_env_apply
desktop_env_write_pack_target
trap desktop_env_clear_pack_target EXIT INT TERM

runtime_deploy="apps/desktop/build/runtime"
out_dir="dist/mac"

echo "→ 构建 runtime"
pnpm --filter @agentup/runtime build

echo "→ 导出 runtime 生产依赖到 ${runtime_deploy}"
rm -rf "${runtime_deploy}"
pnpm --filter @agentup/runtime deploy --prod "${runtime_deploy}"

echo "→ 裁剪 runtime node_modules（文档 / sourcemap / @types 等）"
node apps/desktop/electron/prune-runtime-modules.cjs "${runtime_deploy}/node_modules"

echo "→ 构建 desktop 界面"
pnpm --filter @agentup/desktop build

echo "→ electron-builder（mac arm64，未签名）"
pnpm --filter @agentup/desktop pack:mac

echo
echo "完成。产物目录：${out_dir}/（桌面环境=${AGENTUP_DESKTOP_ENV}）"
ls -la "${out_dir}" || true
echo
echo "未签名安装：从 dmg 拖到「应用程序」后执行："
echo "  xattr -cr /Applications/AgentUp.app"
echo "或对解压出的 .app："
echo "  xattr -cr /path/to/AgentUp.app"
echo
echo "运行日志（macOS）："
echo "  ~/Library/Logs/AgentUp/main.log"
echo "  ~/Library/Logs/AgentUp/runtime.log"
