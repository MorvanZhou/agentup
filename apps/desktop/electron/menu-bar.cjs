const { normalizeCount } = require("./app-badge.cjs");

/** 菜单栏内容高度约 22pt，图标用 18pt，避免顶满状态栏。 */
const MENU_BAR_POINT_SIZE = 18;

/**
 * macOS 状态栏标题：无待处理为空，>9 为 9+，与 Dock / 导航角标一致。
 * @param {unknown} count
 */
function menuBarUnreadTitle(count) {
  const n = normalizeCount(count);
  if (n <= 0) return "";
  return n > 9 ? "9+" : String(n);
}

/**
 * @param {unknown} count
 * @param {{ setTitle?: (title: string, options?: { fontType?: string }) => void } | null | undefined} tray
 */
function applyMenuBarUnread(count, tray) {
  const n = normalizeCount(count);
  const title = menuBarUnreadTitle(n);
  if (tray && typeof tray.setTitle === "function") {
    tray.setTitle(title, { fontType: "monospacedDigit" });
  }
  return { count: n, title };
}

/**
 * 把应用彩色 logo 转成 macOS template 位图：黑剪影 + 透明底。
 * 亮色身体 / 有彩度的手 → 不透明黑；近黑底与黑眼睛 → 透明（眼睛成开孔）。
 * 非 template 彩色图进状态栏时，系统会把旁边标题压暗。
 * @param {Buffer} rgba
 * @param {number} width
 * @param {number} height
 */
function templateBitmapFromRgba(rgba, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const r = rgba[o] ?? 0;
    const g = rgba[o + 1] ?? 0;
    const b = rgba[o + 2] ?? 0;
    const a = rgba[o + 3] ?? 0;
    if (a < 12) continue;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    // 奶油身体或橙色手：保留为 template 前景；近黑底/眼睛丢掉
    if (luminance < 48 && chroma < 28) continue;
    out[o + 3] = a;
  }
  return out;
}

/**
 * 用应用 logo 生成 1x / 2x template 状态栏图，让图标与标题跟随菜单栏明暗。
 * @param {{
 *   createFromPath: (path: string) => { isEmpty?: () => boolean, resize: Function },
 *   createFromBitmap: (buffer: Buffer, size: { width: number, height: number }) => { toPNG: () => Buffer },
 *   createEmpty: () => { addRepresentation: Function, setTemplateImage: (value: boolean) => void },
 * }} nativeImage
 * @param {string} iconPath
 */
function menuBarImage(nativeImage, iconPath) {
  const source = nativeImage.createFromPath(iconPath);
  if (!source || (typeof source.isEmpty === "function" && source.isEmpty())) return null;
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const px = MENU_BAR_POINT_SIZE * scale;
    const resized = source.resize({ width: px, height: px, quality: "best" });
    const size = typeof resized.getSize === "function" ? resized.getSize() : { width: px, height: px };
    const width = size.width || px;
    const height = size.height || px;
    const rgba = Buffer.from(resized.toBitmap());
    const template = templateBitmapFromRgba(rgba, width, height);
    const png = nativeImage.createFromBitmap(template, { width, height }).toPNG();
    image.addRepresentation({
      scaleFactor: scale,
      width,
      height,
      buffer: png,
    });
  }
  image.setTemplateImage(true);
  return image;
}

/**
 * 仅 darwin 创建状态栏图标。左键打开窗口；右键菜单含显示与退出。
 * 不 setContextMenu，避免左键被菜单吃掉。
 * @param {{
 *   platform?: string,
 *   Tray: new (image: unknown) => {
 *     setToolTip: (tip: string) => void,
 *     on: (event: string, listener: () => void) => void,
 *     popUpContextMenu: (menu: unknown) => void,
 *   },
 *   Menu: { buildFromTemplate: (template: unknown[]) => unknown },
 *   nativeImage: Parameters<typeof menuBarImage>[0],
 *   iconPath: string,
 *   productName?: string,
 *   onOpen?: () => void,
 * }} options
 */
function createStatusItem(options) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return null;
  const image = menuBarImage(options.nativeImage, options.iconPath);
  if (!image) return null;
  const productName = options.productName || "AgentUp";
  const tray = new options.Tray(image);
  tray.setToolTip(productName);
  const menu = options.Menu.buildFromTemplate([
    {
      label: `Show ${productName}`,
      click: () => {
        if (typeof options.onOpen === "function") options.onOpen();
      },
    },
    { type: "separator" },
    { role: "quit" },
  ]);
  tray.on("click", () => {
    if (typeof options.onOpen === "function") options.onOpen();
  });
  tray.on("right-click", () => {
    tray.popUpContextMenu(menu);
  });
  return tray;
}

/**
 * 记住未读数与显隐：图标尚未创建时先记下，attach / 重新显示后补上。
 * @param {Parameters<typeof createStatusItem>[0]} options
 */
function createMenuBarController(options) {
  /** @type {ReturnType<typeof createStatusItem> & { destroy?: () => void } | null} */
  let tray = null;
  let unread = 0;
  let visible = true;

  return {
    attach() {
      if (!visible) return null;
      if (tray) return tray;
      tray = createStatusItem(options);
      applyMenuBarUnread(unread, tray);
      return tray;
    },
    setUnread(count) {
      unread = normalizeCount(count);
      return applyMenuBarUnread(unread, tray);
    },
    /**
     * 显示或销毁状态栏图标；关闭时仍记住未读，再次打开时补上。
     * @param {unknown} next
     */
    setVisible(next) {
      visible = next === true || next === 1 || next === "1";
      if (visible) return this.attach();
      if (tray && typeof tray.destroy === "function") tray.destroy();
      tray = null;
      return null;
    },
  };
}

module.exports = {
  MENU_BAR_POINT_SIZE,
  applyMenuBarUnread,
  createMenuBarController,
  createStatusItem,
  menuBarImage,
  menuBarUnreadTitle,
  templateBitmapFromRgba,
};
