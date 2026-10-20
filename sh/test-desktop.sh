#!/bin/sh
# 运行 runtime + desktop 的 Vitest，以及 desktop Playwright：sh sh/test-desktop.sh [vitest 参数]
set -eu
cd "$(dirname "$0")/.."

pnpm --filter @agentup/runtime --filter @agentup/desktop test "$@"
pnpm --filter @agentup/desktop exec playwright install chromium
pnpm --filter @agentup/desktop test:e2e
