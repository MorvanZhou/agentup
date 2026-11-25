/**
 * 解析桌面主样式里窗口拖拽的平台契约。
 * Windows / Linux 用系统标题栏，内容区 `-webkit-app-region: drag` 会吞点击。
 */

export type AppDragPlatformContract = {
  /** `@utility app-drag` 是否在未限定平台时就声明了 drag（违规） */
  utilitySetsDrag: boolean;
  /** 是否存在 `.electron.darwin .app-drag { … drag … }` */
  darwinScopedDrag: boolean;
};

/** 取出第一个匹配的大括号块（含嵌套）。 */
function braceBlock(source: string, openAt: number): string | null {
  if (source[openAt] !== "{") return null;
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openAt, i + 1);
    }
  }
  return null;
}

function declaresDragRegion(block: string): boolean {
  return (
    /-webkit-app-region\s*:\s*drag\b/.test(block) || /\bapp-region\s*:\s*drag\b/.test(block)
  );
}

/**
 * 从 `main.css`（或等价源）校验：全局 `app-drag` 工具类不得设 drag；
 * 真正的 drag 必须挂在 `.electron.darwin .app-drag`。
 */
export function readAppDragPlatformContract(css: string): AppDragPlatformContract {
  const utilityMatch = css.match(/@utility\s+app-drag\s*\{/);
  let utilitySetsDrag = false;
  if (utilityMatch && utilityMatch.index !== undefined) {
    const openAt = css.indexOf("{", utilityMatch.index);
    const block = braceBlock(css, openAt);
    utilitySetsDrag = block ? declaresDragRegion(block) : false;
  }

  const darwinMatch = css.match(/\.electron\.darwin\s+\.app-drag\s*\{/);
  let darwinScopedDrag = false;
  if (darwinMatch && darwinMatch.index !== undefined) {
    const openAt = css.indexOf("{", darwinMatch.index);
    const block = braceBlock(css, openAt);
    darwinScopedDrag = block ? declaresDragRegion(block) : false;
  }

  return { utilitySetsDrag, darwinScopedDrag };
}

export function appDragPlatformOk(contract: AppDragPlatformContract): boolean {
  return !contract.utilitySetsDrag && contract.darwinScopedDrag;
}
