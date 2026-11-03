#!/bin/sh
# 一条龙：git add → commit → tag → push
# 版本取自 apps/desktop/package.json，tag 形如 v0.1.12
#
# 在「带 Build Desktop workflow 的 GitHub 仓」上 push v* tag 后会：
#   构建 mac/win → 创建/更新 GitHub Release（正文含 .github/release-install-notes.md）
#   → 上传 R2 latest。勿在未同步 workflow 的私有仓误推同名 tag 当正式发版。
#
# 用法：
#   # 先把 apps/desktop/package.json 的 version 改到目标版，再：
#   sh sh/release-git.sh "提交说明"
#   sh sh/release-git.sh "提交说明" "tag 说明"   # 可选；默认与提交说明相同
#   sh sh/release-git.sh -h
set -eu
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
用法: sh sh/release-git.sh <commit-message> [tag-message]

从 apps/desktop/package.json 读取 version，打 tag（如 v0.1.12），
执行 git add -A、commit、tag、push（含 tags）。

  commit-message  必填，传给 git commit -m
  tag-message     可选，传给 git tag -m；默认与 commit-message 相同

发版前提：在已配置 .github/workflows/build-desktop.yml 的 GitHub 远程上执行
（公共客户端仓）。push 成功的 v* tag 会触发 Actions：构建安装包、写 Release
（固定安装说明见 .github/release-install-notes.md）、再同步 R2。
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ -z "${1:-}" ]; then
  usage >&2
  exit 1
fi

commit_msg="$1"
tag_msg="${2:-$commit_msg}"
pkg="apps/desktop/package.json"

if [ ! -f "$pkg" ]; then
  echo "找不到 ${pkg}" >&2
  exit 1
fi

version="$(
  node -e "const p=require('./${pkg}'); if(!p.version) process.exit(2); process.stdout.write(String(p.version))"
)" || {
  echo "无法从 ${pkg} 读取 version" >&2
  exit 1
}

tag="v${version}"

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "本地已存在 tag ${tag}，请先处理冲突后再试" >&2
  exit 1
fi

echo "→ git add -A"
git add -A

if git diff --cached --quiet; then
  echo "没有可提交的变更（working tree / index 干净）" >&2
  exit 1
fi

echo "→ git commit -m …"
git commit -m "$commit_msg"

echo "→ git tag -a ${tag}"
git tag -a "$tag" -m "$tag_msg"

echo "→ git push && git push --tags"
git push
git push --tags

echo "完成：commit 已推送，tag ${tag}"
echo "若远程是公共客户端仓：GitHub Actions「Build Desktop」会构建并创建 Release。"
echo "  查看: https://github.com/MorvanZhou/agentup/actions"
echo "  Release: https://github.com/MorvanZhou/agentup/releases/tag/${tag}"
