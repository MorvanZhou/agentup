#!/bin/sh
# git add → commit → push；加 --tag 时再按 desktop package.json 打 v* 并 push tags。
#
# 默认（无 --tag）：普通提交并推送当前分支。
# --tag：读取 apps/desktop/package.json 的 version 打 annotated tag（如 v0.1.13）。
#   本地或远程已有同名 tag 则立即退出、不 commit（除非同时传 --force-tag）。
# --force-tag：与 --tag 合用；删掉本地/远程同名 tag（及可用时的 GitHub Release），
#   再打到当前提交并 push，从而重新跑 Build Desktop / Release / R2。
#
# 用法：
#   sh sh/release-git.sh "提交说明"
#   sh sh/release-git.sh --tag "提交说明"
#   sh sh/release-git.sh --tag --force-tag "修同版本 bug"
#   sh sh/release-git.sh --tag --force-tag   # 工作区干净时：只把同名 tag 挪到 HEAD 再推
#   sh sh/release-git.sh -h
set -eu
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
用法: sh sh/release-git.sh [--tag] [--force-tag] [<commit-message> [tag-message]]

  无 --tag       git add -A → commit → push（普通提交；须有变更与 commit-message）
  --tag          同上，并按 apps/desktop/package.json 的 version 打 v* tag 后
                 git push origin <tag>。tag 已存在则终止（见 --force-tag）。
  --force-tag    须配合 --tag。删除本地与 origin 上同名 tag；若已装 gh，再删
                 同名 GitHub Release，然后重新打 tag 并推送以重跑发版流水线。
                 工作区干净时可不传 commit-message，仅移动 tag 到当前 HEAD。

  commit-message  有未提交变更时必填；--force-tag 且工作区干净时可省略
  tag-message     仅打 tag 时可选，传给 git tag -m；默认与 commit-message 相同
                  （仅 retag 且无 commit-message 时用「retag <tag>」）

同版本修 bug 再发：修完后
  sh sh/release-git.sh --tag --force-tag "fix: …"
若 fix 已单独 commit/push，工作区干净时：
  sh sh/release-git.sh --tag --force-tag

发版须在已配置 .github/workflows/build-desktop.yml 的 GitHub 远程上执行
（公共客户端仓）。R2 latest 会被新构建覆盖。
EOF
}

DO_TAG=0
FORCE_TAG=0
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
    --force-tag)
      FORCE_TAG=1
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

if [ "$FORCE_TAG" -eq 1 ] && [ "$DO_TAG" -ne 1 ]; then
  echo "--force-tag 必须与 --tag 一起使用" >&2
  exit 1
fi

pkg="apps/desktop/package.json"
tag=""
version=""

if [ "$DO_TAG" -eq 1 ]; then
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
fi

echo "→ git add -A"
git add -A

has_changes=1
if git diff --cached --quiet; then
  has_changes=0
fi

if [ "$has_changes" -eq 0 ]; then
  if [ "$FORCE_TAG" -eq 1 ]; then
    echo "工作区干净：跳过 commit，仅强制重打 ${tag} → HEAD"
  else
    echo "没有可提交的变更（working tree / index 干净）" >&2
    exit 1
  fi
else
  if [ -z "$commit_msg" ]; then
    echo "有未提交变更时必须提供 commit-message" >&2
    usage >&2
    exit 1
  fi
fi

if [ -z "$tag_msg" ]; then
  if [ -n "$commit_msg" ]; then
    tag_msg="$commit_msg"
  else
    tag_msg="retag ${tag}"
  fi
fi

# --tag：同名 tag 已存在则退出；--force-tag：先删本地 / origin / Release
if [ "$DO_TAG" -eq 1 ]; then
  local_exists=0
  remote_exists=0
  if git rev-parse "$tag" >/dev/null 2>&1; then
    local_exists=1
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
    remote_exists=1
  fi

  if [ "$local_exists" -eq 1 ] || [ "$remote_exists" -eq 1 ]; then
    if [ "$FORCE_TAG" -ne 1 ]; then
      echo "已存在 tag ${tag}（本地=${local_exists} origin=${remote_exists}）。" >&2
      echo "同版本重修请加 --force-tag，或先升高 package.json version。" >&2
      exit 1
    fi

    echo "⚠ --force-tag：将移除已有 ${tag} 并重打到当前提交（会重跑发版）"
    if [ "$local_exists" -eq 1 ]; then
      echo "→ git tag -d ${tag}"
      git tag -d "$tag"
    fi
    if [ "$remote_exists" -eq 1 ]; then
      echo "→ git push origin :refs/tags/${tag}"
      git push origin ":refs/tags/${tag}"
    fi
    # 删掉旧 Release，避免同名安装包资产冲突导致 action 挂掉
    if command -v gh >/dev/null 2>&1; then
      if gh release view "$tag" >/dev/null 2>&1; then
        echo "→ gh release delete ${tag} --yes"
        gh release delete "$tag" --yes
      fi
    else
      echo "提示：未找到 gh；若旧 Release 资产上传冲突，请在网页删掉 ${tag} 的 Release 后重跑 Actions"
    fi
  elif [ "$FORCE_TAG" -eq 1 ]; then
    echo "提示：${tag} 尚不存在，--force-tag 按普通首次打 tag 处理"
  fi
fi

if [ "$has_changes" -eq 1 ]; then
  echo "→ git commit -m …"
  git commit -m "$commit_msg"

  echo "→ git push"
  git push
fi

if [ "$DO_TAG" -eq 1 ]; then
  echo "→ git tag -a ${tag}"
  git tag -a "$tag" -m "$tag_msg"

  # 只推这一枚 tag，避免误推其它本地 tags；删后重建可再次触发 push: tags
  echo "→ git push origin ${tag}"
  git push origin "$tag"

  echo "完成：tag ${tag} 已推送"
  echo "若远程是公共客户端仓：GitHub Actions「Build Desktop」会构建并创建 Release。"
  echo "  查看: https://github.com/MorvanZhou/agentup/actions"
  echo "  Release: https://github.com/MorvanZhou/agentup/releases/tag/${tag}"
else
  echo "完成：commit 已推送（未打 tag）"
fi
