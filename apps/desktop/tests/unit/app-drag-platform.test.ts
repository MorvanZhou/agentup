import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import {
  appDragPlatformOk,
  readAppDragPlatformContract,
} from "../../src/app/native/app-drag-platform";

const mainCss = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/styles/main.css"),
  "utf8",
);

it("app-drag 不得在全局 utility 里设 drag（Win 会吞设置页点击）", () => {
  const bad = `
@utility app-drag {
  -webkit-app-region: drag;
  app-region: drag;
}
.electron.darwin .app-drag {
  -webkit-app-region: drag;
}
`;
  const contract = readAppDragPlatformContract(bad);
  expect(contract.utilitySetsDrag).toBe(true);
  expect(appDragPlatformOk(contract)).toBe(false);
});

it("真正的 drag 必须限定在 .electron.darwin .app-drag", () => {
  // utility 可有非 drag 标记属性（Tailwind 4 拒空块）；不得写 app-region: drag
  const good = `
@utility app-drag {
  --app-drag-region: marker;
}
.electron.darwin .app-drag {
  -webkit-app-region: drag;
  app-region: drag;
}
`;
  const contract = readAppDragPlatformContract(good);
  expect(contract.utilitySetsDrag).toBe(false);
  expect(contract.darwinScopedDrag).toBe(true);
  expect(appDragPlatformOk(contract)).toBe(true);
});

it("桌面 main.css 满足 Win/Linux 不拖、仅 darwin drag 的契约", () => {
  const contract = readAppDragPlatformContract(mainCss);
  expect(contract.utilitySetsDrag).toBe(false);
  expect(contract.darwinScopedDrag).toBe(true);
  expect(appDragPlatformOk(contract)).toBe(true);
});
