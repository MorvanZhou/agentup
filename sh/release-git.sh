#!/bin/sh
# git add → commit → push；加 --tag 时再按 desktop package.json 打 v* 并 push tags。
#
# 默认（无 --tag）：普通提交并推送当前分支。
# --tag：读取 apps/desktop/package.json 的 version 打 annotated tag（如 v0.1.13）。
#   本地或远程已有同名 tag 则立即退出、不 commit。push tags 后，公共仓上的
#   Build Desktop 会构建并写 GitHub Release（.github/release-install-notes.md）。
#
# 用法：
#   sh sh/release-git.sh "提交说明"
#   sh sh/release-git.sh --tag "提交说明"
#   sh sh/release-git.sh --tag "提交说明" "tag 说明"   # tag -m 默认与提交说明相同
#   sh sh/release-git.sh -h
set -eu
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
用法: sh sh/release-git.sh [--tag] <commit-message> [tag-message]

  无 --tag     git add -A → commit → push（普通提交）
  --tag        同上，并按 apps/desktop/package.json 的 version 打 v* tag 后
               git push --tags。tag 本地或 origin 已存在则终止、不提交。

  commit-message  必填，传给 git commit -m
  tag-message     仅 --tag 时可选，传给 git tag -m；默认与 commit-message 相同

发版（--tag）须在已配置 .github/workflows/build-desktop.yml 的 GitHub 远程上执行
（公共客户端仓）。push 成功的 v* tag 会触发 Actions：构建安装包、写 Release、同步 R2。
EOF
}

DO_TAG=0
commit_msg=""
tag_msg=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --tag)
      DO_TAG=1
      ;;
    -*)
      echo "未知选项: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -z "$commit_msg" ]; then
        commit_msg="$arg"
      elif [ -z "$tag_msg" ]; then
        tag_msg="$arg"
      else
        echo "多余参数: $arg" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

if [ -z "$commit_msg" ]; then
  usage >&2
  exit 1
fi

if [ -z "$tag_msg" ]; then
  tag_msg="$commit_msg"
fi

tag=""
if [ "$DO_TAG" -eq 1 ]; then
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

  # 已有同名 tag 则整段终止，避免误提交
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "本地已存在 tag ${tag}，请先处理冲突后再试" >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
    echo "远程 origin 已存在 tag ${tag}，请先处理冲突后再试" >&2
    exit 1
  fi
fi

echo "→ git add -A"
git add -A

if git diff --cached --quiet; then
  echo "没有可提交的变更（working tree / index 干净）" >&2
  exit 1
fi

echo "→ git commit -m …"
git commit -m "$commit_msg"

echo "→ git push"
git push

if [ "$DO_TAG" -eq 1 ]; then
  echo "→ git tag -a ${tag}"
  git tag -a "$tag" -m "$tag_msg"

  echo "→ git push --tags"
  git push --tags

  echo "完成：commit 已推送，tag ${tag} 已推送"
  echo "若远程是公共客户端仓：GitHub Actions「Build Desktop」会构建并创建 Release。"
  echo "  查看: https://github.com/MorvanZhou/agentup/actions"
  echo "  Release: https://github.com/MorvanZhou/agentup/releases/tag/${tag}"
else
  echo "完成：commit 已推送（未打 tag）"
fi
