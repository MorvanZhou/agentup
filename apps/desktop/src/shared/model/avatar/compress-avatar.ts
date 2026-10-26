/** 与 backend 头像压缩对齐：最长边 ≤256，输出小体积 WebP/JPEG。 */
export const AVATAR_MAX_EDGE = 256;
/** 压缩目标约 80KB（data URL 仍远低于 runtime 1MB 上限）。 */
export const AVATAR_TARGET_BYTES = 80_000;
/** 原图读取上限，避免超大文件拖垮渲染进程；保存前会再压到 KB 级。 */
export const AVATAR_SOURCE_MAX_BYTES = 25_000_000;

export function fitAvatarSize(
  width: number,
  height: number,
  maxEdge = AVATAR_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("无效的图片尺寸");
  }
  const edge = Math.max(width, height);
  if (edge <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressAvatarFile(file: File): Promise<string> {
  if (file.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new Error("头像原图过大，请选择小于 25MB 的图片");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const size = fitAvatarSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法压缩头像");
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob =
      (await encodeCanvas(canvas, "image/webp")) ?? (await encodeCanvas(canvas, "image/jpeg"));
    if (!blob) throw new Error("头像压缩失败");
    return blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  mime: "image/webp" | "image/jpeg",
): Promise<Blob | undefined> {
  let quality = 0.82;
  let blob = await canvasToBlob(canvas, mime, quality);
  if (!blob || blob.type !== mime) return undefined;

  while (blob.size > AVATAR_TARGET_BYTES && quality > 0.35) {
    quality = Math.max(0.35, quality - 0.12);
    const next = await canvasToBlob(canvas, mime, quality);
    if (!next || next.type !== mime) break;
    blob = next;
  }
  return blob;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("头像读取失败")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("头像读取失败")));
    reader.readAsDataURL(blob);
  });
}
