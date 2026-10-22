#!/bin/sh
# 构建未签名的 Windows x64 NSIS 安装包：sh sh/build-win.sh [--prod|--dev]
# 默认 --prod（打进正式控制面 / 登录门面）；--dev 打进本机 URL
# 须在 Windows 本机或 windows runner 上执行（不要交叉编译）
#
# runtime 依赖打包注意（见 apps/desktop/electron/pack-runtime-modules.cjs）：
#   win 必须 follow=true（否则 Windows tar 解压 symlink 会大面积失败）；
#   勿把松散 node_modules 打进 NSIS（逐文件解压极慢）——只打 node_modules.tgz
set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. sh/lib/desktop-env.sh

status=0
desktop_env_parse prod "$@" || status=$?
if [ "$status" -eq 2 ]; then
  desktop_env_usage "build-win.sh" "prod"
  exit 0
fi
if [ "$status" -ne 0 ]; then
  desktop_env_usage "build-win.sh" "prod" >&2
  exit 1
fi
desktop_env_apply
desktop_env_write_pack_target
trap desktop_env_clear_pack_target EXIT INT TERM

runtime_deploy="apps/desktop/build/runtime"
out_dir="dist/win"

echo "→ 构建 runtime"
pnpm --filter @agentup/runtime build

echo "→ 导出 runtime 生产依赖到 ${runtime_deploy}"
rm -rf "${runtime_deploy}"
pnpm --filter @agentup/runtime deploy --prod "${runtime_deploy}"

echo "→ 裁剪 runtime node_modules（文档 / sourcemap / @types 等）"
node apps/desktop/electron/prune-runtime-modules.cjs "${runtime_deploy}/node_modules"

echo "→ 构建 desktop 界面"
pnpm --filter @agentup/desktop build

echo "→ electron-builder（win x64 NSIS，未签名）"
pnpm --filter @agentup/desktop pack:win

echo
echo "完成。产物目录：${out_dir}/（桌面环境=${AGENTUP_DESKTOP_ENV}）"
ls -la "${out_dir}" || true
echo
echo "运行日志（Windows）："
echo "  %APPDATA%\\\\AgentUp\\\\logs\\\\main.log"
echo "  %APPDATA%\\\\AgentUp\\\\logs\\\\runtime.log"
