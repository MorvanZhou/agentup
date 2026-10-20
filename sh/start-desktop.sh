#!/bin/sh
# 启动桌面界面和本机 runtime：sh sh/start-desktop.sh [--prod|--dev]
# 本机仍跑 Vite + runtime；--prod 只切换控制面 / 登录门面到正式域名
set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. sh/lib/desktop-env.sh

status=0
desktop_env_parse dev "$@" || status=$?
if [ "$status" -eq 2 ]; then
  desktop_env_usage "start-desktop.sh" "dev"
  exit 0
fi
if [ "$status" -ne 0 ]; then
  desktop_env_usage "start-desktop.sh" "dev" >&2
  exit 1
fi
desktop_env_apply

# 开发用 Electron 与打包版钥匙串密钥不同，数据目录分开，避免解不开正式版写下的密钥密文。
if [ "$MODE" = "dev" ] && [ -z "${AGENTUP_USER_DATA_ROOT:-}" ]; then
  export AGENTUP_USER_DATA_ROOT="${HOME}/.agentup-dev"
fi
if [ -n "${AGENTUP_USER_DATA_ROOT:-}" ]; then
  echo "Desktop: userData=${AGENTUP_USER_DATA_ROOT}"
fi

# 正式版 AgentUp 也监听 47391；被占用时 Vite 会把换票代理到正式后端，出现「换票码无效或已过期」
RUNTIME_PORT="${AGENTUP_RUNTIME_PORT:-47391}"
if lsof -nP -iTCP:"$RUNTIME_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Desktop: 端口 ${RUNTIME_PORT} 已被占用，开发 runtime 无法启动：" >&2
  lsof -nP -iTCP:"$RUNTIME_PORT" -sTCP:LISTEN >&2 || true
  echo "请先退出 /Applications/AgentUp.app（或其他占用进程）再启动。" >&2
  exit 1
fi

pnpm --filter @agentup/runtime build
pnpm --filter @agentup/desktop dev &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT INT TERM

ready=0
i=0
while [ "$i" -lt 50 ]; do
  if curl -sf -o /dev/null http://127.0.0.1:5173; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "界面没有启动。" >&2
  exit 1
fi

# 从本脚本（已加载用户 shell）启动，跳过再采 login env；打包 App 无此变量会采一次
export AGENTUP_CLI=1
AGENTUP_OPEN_DEVTOOLS=1 pnpm --filter @agentup/desktop start
