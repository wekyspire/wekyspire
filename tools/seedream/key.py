#!/usr/bin/env python3
"""立牌抠图：白（或纯色）背景 → 透明 PNG。

边缘洪水填充法：从图像四边所有与"边缘主色"色差小于 tolerance 的像素开始 BFS，
只把与背景连通的部分置透明——角色内部的白色（如瑞米身体）不会被误抠。

切边后按 --erode 对 alpha 做形态学腐蚀（默认 2px）：生成图的边缘常残留
1-2px 半透明白边，深色场景里会显出发亮白圈——多切这几像素根治
（2026-09-22 用户定）。

用法：
    python key.py out/unit_remi.png                 # → out/unit_remi_cut.png
    python key.py out/unit_remi.png --tol 40 --feather 1.6 --erode 2
"""
import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


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
    ap.add_argument("--erode", type=int, default=2,
                    help="切边后 alpha 腐蚀像素数（多吃掉边缘白残留；0 关闭）")
    ap.add_argument("--holes", type=int, default=0,
                    help="封闭白腔清理阈值（默认关）：被轮廓包住的大块近白连通域 >=N 像素则清除"
                         "（藤蔓/四肢围合的露白）。白眼睛同属封闭白域，按尺寸区分不了就靠阈值——"
                         "只对确认有腔的图显式开（如荆棘 --holes 8000），勿当默认")
    ap.add_argument("--despeckle", type=int, default=60,
                    help="孤岛去斑阈值：与主体（含 2px 邻接带）不相连、<=N 像素的**任意颜色**"
                         "连通域清除——轮廓外飞溅点/漆斑常是中灰而非纯白（2026-09-22 验收实测）")
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

    # 边缘腐蚀：alpha 通道 N 次 3x3 min 滤波 = 向内收缩 N 像素，
    # 洪填羽化带里残留的半透明白边随最外圈一起消失
    if args.erode > 0:
        a = img.getchannel("A")
        for _ in range(args.erode):
            a = a.filter(ImageFilter.MinFilter(3))
        img.putalpha(a)

    def near_white(x, y):
        r, g, b, _ = px[x, y]
        return dist2((r, g, b), bg) <= feather2

    def components(pred):
        """近白像素连通域标注（4 邻接）。返回 [(size, [(x,y)...])]，按 size 降序。"""
        seen = bytearray(w * h)
        comps = []
        for sy in range(h):
            for sx in range(w):
                if seen[sy * w + sx] or not pred(sx, sy):
                    continue
                stack = [(sx, sy)]
                seen[sy * w + sx] = 1
                pts = []
                while stack:
                    x, y = stack.pop()
                    pts.append((x, y))
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and pred(nx, ny):
                            seen[ny * w + nx] = 1
                            stack.append((nx, ny))
                comps.append(pts)
        comps.sort(key=len, reverse=True)
        return comps

    # 封闭白腔清理（2026-09-22 验收自由报告实锤）：洪填只清边界连通的背景，够不着
    # 被轮廓包住的内腔——藤蔓/四肢围合的洞里烧着不透明白。阈值保护小特征（白眼睛）。
    if args.holes > 0:
        for pts in components(lambda x, y: near_white(x, y) and px[x, y][3] > 0):
            if len(pts) >= args.holes:
                for x, y in pts:
                    px[x, y] = (0, 0, 0, 0)

    # 孤岛去斑：与主体（含 2px 邻接带）不相连的小连通域，任意颜色——生成图常在
    # 轮廓外撒中灰/浅白飞溅点（亮度 88-160，不在近白容差内），按颜色筛会漏
    if args.despeckle > 0:
        solid = components(lambda x, y: px[x, y][3] > 200)
        body = solid[0] if solid else []
        body_set = set(body)
        for _ in range(2):  # 主体外扩两圈 = 允许贴身的部件（毒滴/雪粒等）
            body_set |= {(x + dx, y + dy) for x, y in tuple(body_set)
                         for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))}
        for pts in components(lambda x, y: px[x, y][3] > 0):
            if len(pts) <= args.despeckle and len(pts) < len(body) and not any(p in body_set for p in pts):
                for x, y in pts:
                    px[x, y] = (0, 0, 0, 0)

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
