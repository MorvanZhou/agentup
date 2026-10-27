import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const {
  applyMenuBarUnread,
  createMenuBarController,
  menuBarImage,
  templateBitmapFromRgba,
} = createRequire(import.meta.url)("../../electron/menu-bar.cjs") as {
  applyMenuBarUnread: (
    count: unknown,
    tray: { setTitle: (title: string, options?: { fontType?: string }) => void } | null,
  ) => { count: number; title: string };
  templateBitmapFromRgba: (rgba: Buffer, width: number, height: number) => Buffer;
  menuBarImage: (
    nativeImage: {
      createFromPath: (path: string) => {
        isEmpty: () => boolean;
        resize: (options: { width: number; height: number; quality: string }) => {
          getSize: () => { width: number; height: number };
          toBitmap: () => Buffer;
        };
      };
      createFromBitmap: (
        buffer: Buffer,
        size: { width: number; height: number },
      ) => { toPNG: () => Buffer };
      createEmpty: () => {
        addRepresentation: (rep: unknown) => void;
        setTemplateImage: (value: boolean) => void;
      };
    },
    iconPath: string,
  ) => {
    representations: unknown[];
    isTemplateImage: () => boolean;
  } | null;
  createMenuBarController: (options: {
    platform: string;
    Tray: new (image: unknown) => {
      setToolTip: (tip: string) => void;
      setTitle: (title: string, options?: { fontType?: string }) => void;
      on: (event: string, listener: () => void) => void;
      popUpContextMenu: (menu: unknown) => void;
    };
    Menu: { buildFromTemplate: (template: unknown[]) => { template: unknown[] } };
    nativeImage: {
      createFromPath: (path: string) => {
        isEmpty: () => boolean;
        resize: (options: { width: number; height: number; quality: string }) => {
          getSize: () => { width: number; height: number };
          toBitmap: () => Buffer;
        };
      };
      createFromBitmap: (
        buffer: Buffer,
        size: { width: number; height: number },
      ) => { toPNG: () => Buffer };
      createEmpty: () => {
        addRepresentation: (rep: unknown) => void;
        setTemplateImage: (value: boolean) => void;
      };
    };
    iconPath: string;
    productName: string;
    onOpen: () => void;
  }) => {
    attach: () => unknown;
    setUnread: (count: unknown) => { count: number; title: string };
    setVisible: (visible: unknown) => unknown;
  };
};

function rgbaPixel(r: number, g: number, b: number, a = 255): Buffer {
  return Buffer.from([r, g, b, a]);
}

function fakeNativeImage(iconPath = "/assets/icon.png") {
  const representations: Array<{
    scaleFactor: number;
    width: number;
    height: number;
    dataURL?: string;
    buffer?: Buffer;
  }> = [];
  let template = false;
  // 2x2：奶油身体 / 黑底 / 橙手 / 黑眼睛 → template 后身体与手为黑不透明，底与眼透明
  const sample = Buffer.concat([
    rgbaPixel(245, 242, 235),
    rgbaPixel(14, 14, 16),
    rgbaPixel(242, 104, 64),
    rgbaPixel(0, 0, 0),
  ]);
  return {
    representations,
    isTemplate: () => template,
    nativeImage: {
      createFromPath: (path: string) => {
        expect(path).toBe(iconPath);
        return {
          isEmpty: () => false,
          resize: (options: { width: number; height: number }) => ({
            getSize: () => ({ width: options.width, height: options.height }),
            toBitmap: () => {
              if (options.width === 2 && options.height === 2) return Buffer.from(sample);
              const out = Buffer.alloc(options.width * options.height * 4);
              sample.copy(out, 0, 0, Math.min(sample.length, out.length));
              return out;
            },
          }),
        };
      },
      createFromBitmap: (buffer: Buffer, size: { width: number; height: number }) => ({
        toPNG: () => Buffer.from(`png:${size.width}:${buffer[3]},${buffer[7]}`),
      }),
      createEmpty: () => ({
        representations,
        addRepresentation: (rep: {
          scaleFactor: number;
          width: number;
          height: number;
          buffer: Buffer;
        }) => {
          representations.push(rep);
        },
        setTemplateImage: (value: boolean) => {
          template = value;
        },
        isTemplateImage: () => template,
      }),
    },
  };
}

it("clears the menu bar title when there is no unread", () => {
  const setTitle = vi.fn();
  expect(applyMenuBarUnread(0, { setTitle })).toEqual({ count: 0, title: "" });
  expect(setTitle).toHaveBeenCalledWith("", { fontType: "monospacedDigit" });
});

it("shows the unread count beside the menu bar icon, capping at 9+", () => {
  const setTitle = vi.fn();
  expect(applyMenuBarUnread(4, { setTitle })).toEqual({ count: 4, title: "4" });
  expect(applyMenuBarUnread(12, { setTitle })).toEqual({ count: 12, title: "9+" });
  expect(setTitle).toHaveBeenNthCalledWith(1, "4", { fontType: "monospacedDigit" });
  expect(setTitle).toHaveBeenNthCalledWith(2, "9+", { fontType: "monospacedDigit" });
});

it("keeps bright or colored logo pixels as the template silhouette", () => {
  const out = templateBitmapFromRgba(
    Buffer.concat([
      rgbaPixel(245, 242, 235),
      rgbaPixel(14, 14, 16),
      rgbaPixel(242, 104, 64),
      rgbaPixel(0, 0, 0),
      rgbaPixel(0, 0, 0, 0),
    ]),
    5,
    1,
  );
  // 奶油身体、橙手 → 黑+不透明；近黑底、黑眼睛、原透明 → 透明
  expect([...out]).toEqual([
    0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
});

it("builds a macOS template menu bar image at 1x and 2x", () => {
  const { nativeImage, representations, isTemplate } = fakeNativeImage();
  const image = menuBarImage(nativeImage, "/assets/icon.png");
  expect(image).not.toBeNull();
  expect(isTemplate()).toBe(true);
  expect(representations.map((rep) => ({ scaleFactor: rep.scaleFactor, width: rep.width, height: rep.height }))).toEqual([
    { scaleFactor: 1, width: 18, height: 18 },
    { scaleFactor: 2, width: 36, height: 36 },
  ]);
  expect(representations.every((rep) => Buffer.isBuffer(rep.buffer))).toBe(true);
});

it("does not create a status item off macOS", () => {
  const Tray = vi.fn();
  const controller = createMenuBarController({
    platform: "win32",
    Tray: Tray as never,
    Menu: { buildFromTemplate: vi.fn() },
    nativeImage: fakeNativeImage().nativeImage,
    iconPath: "/assets/icon.png",
    productName: "AgentUp",
    onOpen: vi.fn(),
  });
  expect(controller.attach()).toBeNull();
  expect(Tray).not.toHaveBeenCalled();
  expect(controller.setUnread(3)).toEqual({ count: 3, title: "3" });
});

it("opens the app on click and keeps a quit menu on right-click", () => {
  const onOpen = vi.fn();
  const handlers: Record<string, () => void> = {};
  const popped: unknown[] = [];
  let title = "unset";
  const tray = {
    setToolTip: vi.fn(),
    setTitle: (next: string) => {
      title = next;
    },
    on: (event: string, listener: () => void) => {
      handlers[event] = listener;
    },
    popUpContextMenu: (menu: unknown) => {
      popped.push(menu);
    },
  };
  const Tray = vi.fn(function Tray() {
    return tray;
  });
  let template: Array<{ label?: string; role?: string; click?: () => void; type?: string }> = [];
  const { nativeImage } = fakeNativeImage();
  const controller = createMenuBarController({
    platform: "darwin",
    Tray: Tray as never,
    Menu: {
      buildFromTemplate: (next) => {
        template = next as typeof template;
        return { template: next };
      },
    },
    nativeImage,
    iconPath: "/assets/icon.png",
    productName: "AgentUp",
    onOpen,
  });

  expect(controller.setUnread(2)).toEqual({ count: 2, title: "2" });
  expect(title).toBe("unset");

  const attached = controller.attach();
  expect(attached).toBe(tray);
  expect(tray.setToolTip).toHaveBeenCalledWith("AgentUp");
  expect(title).toBe("2");
  expect(template.map((item) => item.label ?? item.role ?? item.type)).toEqual([
    "Show AgentUp",
    "separator",
    "quit",
  ]);

  handlers.click?.();
  template[0]?.click?.();
  expect(onOpen).toHaveBeenCalledTimes(2);
  handlers["right-click"]?.();
  expect(popped).toHaveLength(1);
});

it("hides and restores the menu bar status item, keeping unread for reattach", () => {
  let title = "";
  const destroy = vi.fn();
  const tray = {
    setToolTip: vi.fn(),
    setTitle: (next: string) => {
      title = next;
    },
    on: vi.fn(),
    popUpContextMenu: vi.fn(),
    destroy,
  };
  const Tray = vi.fn(function Tray() {
    return tray;
  });
  const controller = createMenuBarController({
    platform: "darwin",
    Tray: Tray as never,
    Menu: { buildFromTemplate: () => ({ template: [] }) },
    nativeImage: fakeNativeImage().nativeImage,
    iconPath: "/assets/icon.png",
    productName: "AgentUp",
    onOpen: vi.fn(),
  });

  controller.attach();
  controller.setUnread(3);
  expect(title).toBe("3");

  expect(controller.setVisible(false)).toBeNull();
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(Tray).toHaveBeenCalledTimes(1);

  controller.setUnread(5);
  expect(controller.setVisible(true)).toBe(tray);
  expect(Tray).toHaveBeenCalledTimes(2);
  expect(title).toBe("5");
});
