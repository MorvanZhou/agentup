"""画出 20 张官方 Agent 头像。

三色与 apple-touch-icon 一致：近黑底、奶油身体、橙道具。
运行：python3 apps/desktop/scripts/render-official-avatars.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "assets" / "official-avatars"

SIZE = 256
SS = 4

INK = (14, 14, 16, 255)
CREAM = (245, 242, 235, 255)
ORANGE = (242, 104, 64, 255)

# 身体：竖向大圆角，和挥手图标同一只。
BODY = (52, 34, 152, 196, 68)  # x, y, w, h, radius
EYE_Y = 108
EYE_L = 100
EYE_R = 156
EYE_R_PX = 13


class Canvas:
    def __init__(self) -> None:
        n = SIZE * SS
        self.n = n
        self.img = np.zeros((n, n, 4), dtype=np.float32)
        axis = (np.arange(n) + 0.5) / SS
        self.x, self.y = np.meshgrid(axis, axis)

    def paint(self, mask: np.ndarray, color: tuple[int, int, int, int]) -> None:
        self.img[mask] = color

    def fill(self, color: tuple[int, int, int, int]) -> None:
        self.img[:] = color

    def circle(self, cx: float, cy: float, radius: float, color: tuple[int, int, int, int]) -> None:
        self.paint((self.x - cx) ** 2 + (self.y - cy) ** 2 <= radius * radius, color)

    def ellipse(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float,
        rotation: float,
        color: tuple[int, int, int, int],
    ) -> None:
        cos = math.cos(-rotation)
        sin = math.sin(-rotation)
        dx = self.x - cx
        dy = self.y - cy
        local_x = dx * cos - dy * sin
        local_y = dx * sin + dy * cos
        self.paint((local_x / rx) ** 2 + (local_y / ry) ** 2 <= 1, color)

    def capsule(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        radius: float,
        color: tuple[int, int, int, int],
    ) -> None:
        vx, vy = x2 - x1, y2 - y1
        length_sq = vx * vx + vy * vy
        if length_sq == 0:
            self.circle(x1, y1, radius, color)
            return
        t = np.clip(((self.x - x1) * vx + (self.y - y1) * vy) / length_sq, 0, 1)
        px = x1 + t * vx
        py = y1 + t * vy
        self.paint((self.x - px) ** 2 + (self.y - py) ** 2 <= radius * radius, color)

    def round_rect(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        radius: float,
        color: tuple[int, int, int, int],
    ) -> None:
        radius = min(radius, width / 2, height / 2)
        nearest_x = np.clip(self.x, x + radius, x + width - radius)
        nearest_y = np.clip(self.y, y + radius, y + height - radius)
        self.paint((self.x - nearest_x) ** 2 + (self.y - nearest_y) ** 2 <= radius * radius, color)

    def ring(
        self,
        cx: float,
        cy: float,
        outer: float,
        inner: float,
        color: tuple[int, int, int, int],
    ) -> None:
        distance = (self.x - cx) ** 2 + (self.y - cy) ** 2
        self.paint((distance <= outer * outer) & (distance >= inner * inner), color)

    def polygon(self, points: list[tuple[float, float]], color: tuple[int, int, int, int]) -> None:
        inside = np.zeros(self.x.shape, dtype=bool)
        j = len(points) - 1
        for i, (xi, yi) in enumerate(points):
            xj, yj = points[j]
            crosses = (yi > self.y) != (yj > self.y)
            x_at = (xj - xi) * (self.y - yi) / (yj - yi + 1e-9) + xi
            inside ^= crosses & (self.x < x_at)
            j = i
        self.paint(inside, color)

    def rgba(self) -> np.ndarray:
        s = SS
        folded = self.img.reshape(SIZE, s, SIZE, s, 4).mean(axis=(1, 3))
        return np.clip(np.rint(folded), 0, 255).astype(np.uint8)


def write_png(path: Path, rgba: np.ndarray) -> None:
    height, width, _ = rgba.shape

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def body(canvas: Canvas) -> None:
    canvas.round_rect(*BODY, CREAM)


def eyes(canvas: Canvas, kind: str) -> None:
    if kind == "up":
        canvas.circle(EYE_L, EYE_Y - 12, EYE_R_PX - 1, INK)
        canvas.circle(EYE_R, EYE_Y - 14, EYE_R_PX - 1, INK)
        return
    if kind == "happy":
        for cx in (EYE_L, EYE_R):
            canvas.circle(cx, EYE_Y + 4, 15, INK)
            canvas.circle(cx, EYE_Y - 4, 13, CREAM)
        return
    if kind == "sleepy":
        canvas.capsule(EYE_L - 14, EYE_Y + 2, EYE_L + 14, EYE_Y + 2, 7, INK)
        canvas.capsule(EYE_R - 14, EYE_Y, EYE_R + 14, EYE_Y, 7, INK)
        return
    if kind == "focus":
        canvas.ellipse(EYE_L, EYE_Y + 2, 12, 8, 0, INK)
        canvas.ellipse(EYE_R, EYE_Y, 12, 8, 0, INK)
        return
    canvas.circle(EYE_L, EYE_Y, EYE_R_PX, INK)
    canvas.circle(EYE_R, EYE_Y - 2, EYE_R_PX, INK)


def base(canvas: Canvas, kind: str = "normal") -> None:
    canvas.fill(INK)
    body(canvas)
    eyes(canvas, kind)


def read_png(path: Path) -> np.ndarray:
    data = path.read_bytes()
    pos = 8
    width = height = 0
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height = struct.unpack(">II", chunk[:8])
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
    raw = zlib.decompress(idat)
    rows = []
    index = 0
    prev = bytearray(width * 4)
    for _ in range(height):
        filter_type = raw[index]
        index += 1
        row = bytearray(raw[index : index + width * 4])
        index += width * 4
        if filter_type == 1:
            for x in range(len(row)):
                row[x] = (row[x] + (row[x - 4] if x >= 4 else 0)) & 255
        elif filter_type == 2:
            for x in range(len(row)):
                row[x] = (row[x] + prev[x]) & 255
        elif filter_type == 3:
            for x in range(len(row)):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filter_type == 4:
            for x in range(len(row)):
                left = row[x - 4] if x >= 4 else 0
                up = prev[x]
                up_left = prev[x - 4] if x >= 4 else 0
                estimate = left + up - up_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - up_left)
                predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else up_left)
                row[x] = (row[x] + predictor) & 255
        prev = row
        rows.append(row)
    return np.frombuffer(b"".join(rows), dtype=np.uint8).reshape(height, width, 4).copy()


def hand(canvas: Canvas) -> None:
    """挥手直接取自应用图标，双线性放大后贴到身体左侧。"""
    icon = read_png(ROOT / "public" / "apple-touch-icon.png")
    score = np.clip((icon[:, :, 0].astype(np.float32) - icon[:, :, 1]) / 90, 0, 1)
    score *= icon[:, :, 0] > 150
    source_x, source_y, source_w, source_h = 4, 44, 64, 70
    dest_x, dest_y, dest_w, dest_h = 8, 78, 108, 118
    u = (canvas.x - dest_x) / dest_w
    v = (canvas.y - dest_y) / dest_h
    inside = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    sample_x = np.clip(source_x + u * (source_w - 1), 0, icon.shape[1] - 1.001)
    sample_y = np.clip(source_y + v * (source_h - 1), 0, icon.shape[0] - 1.001)
    x0 = np.floor(sample_x).astype(np.int32)
    y0 = np.floor(sample_y).astype(np.int32)
    tx = sample_x - x0
    ty = sample_y - y0
    covered = (
        score[y0, x0] * (1 - tx) * (1 - ty)
        + score[y0, np.clip(x0 + 1, 0, score.shape[1] - 1)] * tx * (1 - ty)
        + score[np.clip(y0 + 1, 0, score.shape[0] - 1), x0] * (1 - tx) * ty
        + score[np.clip(y0 + 1, 0, score.shape[0] - 1), np.clip(x0 + 1, 0, score.shape[1] - 1)] * tx * ty
    )
    canvas.paint(inside & (covered >= 0.45), ORANGE)


def bulb(canvas: Canvas) -> None:
    canvas.circle(184, 46, 22, ORANGE)
    canvas.round_rect(174, 64, 20, 14, 4, ORANGE)
    canvas.capsule(178, 80, 190, 80, 2.2, CREAM)
    canvas.capsule(180, 86, 188, 86, 2.2, CREAM)


def glasses(canvas: Canvas) -> None:
    canvas.ring(EYE_L, EYE_Y, 26, 16, ORANGE)
    canvas.ring(EYE_R, EYE_Y - 2, 26, 16, ORANGE)
    canvas.capsule(EYE_L + 22, EYE_Y - 1, EYE_R - 22, EYE_Y - 1, 3.5, ORANGE)


def wrench(canvas: Canvas) -> None:
    canvas.circle(176, 104, 20, ORANGE)
    canvas.circle(176, 104, 8, INK)
    canvas.capsule(164, 118, 128, 188, 9, ORANGE)


def pencil(canvas: Canvas) -> None:
    # 笔尖落在奶油额头上，橡皮在黑底上，避免和眼睛叠在一起。
    canvas.capsule(144, 76, 198, 46, 8, ORANGE)
    canvas.circle(136, 82, 7, INK)
    canvas.circle(204, 42, 6, CREAM)


def notebook(canvas: Canvas) -> None:
    canvas.round_rect(150, 150, 52, 58, 10, ORANGE)
    canvas.round_rect(158, 158, 36, 42, 6, CREAM)
    canvas.capsule(166, 170, 186, 170, 2, INK)
    canvas.capsule(166, 180, 186, 180, 2, INK)


def magnifier(canvas: Canvas) -> None:
    canvas.ring(182, 124, 28, 16, ORANGE)
    canvas.capsule(198, 146, 220, 176, 7, ORANGE)


def open_book(canvas: Canvas) -> None:
    canvas.round_rect(60, 168, 136, 48, 12, ORANGE)
    canvas.capsule(128, 164, 128, 220, 5, INK)
    canvas.capsule(78, 184, 112, 184, 2.4, CREAM)
    canvas.capsule(78, 198, 108, 198, 2.4, CREAM)
    canvas.capsule(144, 184, 178, 184, 2.4, CREAM)
    canvas.capsule(144, 198, 174, 198, 2.4, CREAM)


def heart(canvas: Canvas) -> None:
    scale = 18
    cx, cy = 128, 168
    local_x = (canvas.x - cx) / scale
    local_y = (cy - canvas.y) / scale
    mask = (local_x**2 + local_y**2 - 1) ** 3 - local_x**2 * local_y**3 <= 0
    canvas.paint(mask, ORANGE)


def chef_hat(canvas: Canvas) -> None:
    canvas.circle(102, 48, 20, ORANGE)
    canvas.circle(128, 34, 22, ORANGE)
    canvas.circle(154, 48, 20, ORANGE)
    canvas.round_rect(82, 56, 92, 20, 8, ORANGE)


def leaf(canvas: Canvas) -> None:
    canvas.ellipse(188, 68, 18, 34, -0.55, ORANGE)
    canvas.capsule(172, 90, 208, 48, 3, INK)


def compass(canvas: Canvas) -> None:
    canvas.circle(186, 60, 24, ORANGE)
    canvas.circle(186, 60, 14, INK)
    canvas.polygon([(186, 46), (192, 60), (186, 74), (180, 60)], CREAM)
    canvas.circle(186, 60, 4, ORANGE)


def note(canvas: Canvas) -> None:
    canvas.ellipse(166, 156, 16, 12, -0.45, ORANGE)
    canvas.capsule(178, 150, 190, 78, 5.5, ORANGE)
    canvas.circle(204, 86, 12, ORANGE)


def headband(canvas: Canvas) -> None:
    canvas.capsule(76, 84, 180, 84, 9, ORANGE)
    canvas.circle(188, 84, 11, ORANGE)


def bow(canvas: Canvas) -> None:
    canvas.ellipse(108, 196, 20, 12, 0.45, ORANGE)
    canvas.ellipse(148, 196, 20, 12, -0.45, ORANGE)
    canvas.circle(128, 196, 7, INK)


def moon(canvas: Canvas) -> None:
    canvas.circle(196, 60, 24, ORANGE)
    canvas.circle(210, 50, 18, INK)


def star(canvas: Canvas) -> None:
    points: list[tuple[float, float]] = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        radius = 22 if i % 2 == 0 else 9
        points.append((188 + radius * math.cos(angle), 64 + radius * math.sin(angle)))
    canvas.polygon(points, ORANGE)


def brim_hat(canvas: Canvas) -> None:
    canvas.capsule(72, 78, 184, 78, 9, ORANGE)
    canvas.round_rect(98, 38, 60, 42, 16, ORANGE)


def envelope(canvas: Canvas) -> None:
    canvas.round_rect(142, 152, 62, 46, 8, ORANGE)
    canvas.polygon([(148, 160), (173, 184), (198, 160)], CREAM)


def flag(canvas: Canvas) -> None:
    canvas.capsule(52, 44, 52, 122, 6, CREAM)
    canvas.round_rect(58, 38, 52, 36, 8, ORANGE)


VARIANTS: list[tuple[str, str, list]] = [
    ("greeter", "normal", [hand]),
    ("thinker", "up", [bulb]),
    ("scholar", "normal", [glasses]),
    ("engineer", "focus", [wrench]),
    ("designer", "normal", [pencil]),
    ("writer", "normal", [notebook]),
    ("researcher", "focus", [magnifier]),
    ("teacher", "normal", [open_book]),
    ("care", "happy", [heart]),
    ("chef", "happy", [chef_hat]),
    ("gardener", "normal", [leaf]),
    ("guide", "up", [compass]),
    ("musician", "happy", [note]),
    ("doer", "focus", [headband]),
    ("concierge", "normal", [bow]),
    ("night", "sleepy", [moon]),
    ("happy", "happy", [star]),
    ("detective", "focus", [brim_hat]),
    ("messenger", "normal", [envelope]),
    ("leader", "normal", [flag]),
]


def render(eye_kind: str, props: list) -> np.ndarray:
    canvas = Canvas()
    base(canvas, eye_kind)
    for prop in props:
        prop(canvas)
    return canvas.rgba()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, eye_kind, props in VARIANTS:
        rgba = render(eye_kind, props)
        write_png(OUT / f"{name}.png", rgba)
        print(name, (OUT / f"{name}.png").stat().st_size)


if __name__ == "__main__":
    main()
