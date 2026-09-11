#!/usr/bin/env python3
"""立牌抠图：白（或纯色）背景 → 透明 PNG。

边缘洪水填充法：从图像四边所有与"边缘主色"色差小于 tolerance 的像素开始 BFS，
只把与背景连通的部分置透明——角色内部的白色（如瑞米身体）不会被误抠。

用法：
    python key.py out/unit_remi.png                 # → out/unit_remi_cut.png
    python key.py out/unit_remi.png --tol 40 --feather 1.6
"""
import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def border_color(px, w, h):
    """四边像素的平均色作为背景色估计。"""
    samples = []
    for x in range(0, w, 4):
        samples.append(px[x, 0][:3])
        samples.append(px[x, h - 1][:3])
    for y in range(0, h, 4):
        samples.append(px[0, y][:3])
        samples.append(px[w - 1, y][:3])
    n = len(samples)
    return tuple(sum(c[i] for c in samples) // n for i in range(3))


def dist2(a, b):
    return sum((a[i] - b[i]) ** 2 for i in range(3))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--tol", type=float, default=32, help="色差阈值（RGB 欧氏距离）")
    ap.add_argument("--feather", type=float, default=1.8,
                    help="羽化带宽度倍数：tol*feather 内的边缘像素按色差比例半透明")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out) if args.out else src.with_name(src.stem + "_cut.png")
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    px = img.load()
    bg = border_color(px, w, h)
    tol2 = args.tol ** 2
    feather2 = (args.tol * args.feather) ** 2
    print(f"背景色估计 {bg}，tol={args.tol}")

    visited = bytearray(w * h)
    q = deque()

    def try_seed(x, y):
        if not visited[y * w + x] and dist2(px[x, y][:3], bg) <= feather2:
            visited[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        x, y = q.popleft()
        d2 = dist2(px[x, y][:3], bg)
        if d2 <= tol2:
            alpha = 0
        else:
            # 羽化带：tol..tol*feather 之间按色差比例过渡
            alpha = int(255 * (d2 - tol2) / (feather2 - tol2))
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, alpha)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny * w + nx] \
                    and dist2(px[nx, ny][:3], bg) <= feather2:
                visited[ny * w + nx] = 1
                q.append((nx, ny))

    # 自动裁掉全透明边距（留 2% 边距），立牌纹理更紧凑
    bbox = img.getbbox()
    if bbox:
        mx = round(w * 0.02)
        my = round(h * 0.02)
        bbox = (max(0, bbox[0] - mx), max(0, bbox[1] - my),
                min(w, bbox[2] + mx), min(h, bbox[3] + my))
        img = img.crop(bbox)

    img.save(out)
    print(f"-> {out}（{img.width}x{img.height}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
