"""战斗立牌抠图入库：单色底（白/黑）立绘 → 透明 alpha + 裁包围盒 → src/assets/stage/unit_<id>.png。

算法：以四角像素估计底色，从图像边界做洪水填充（颜色距底色 < tol 且与边界连通才算底），
主体内部与底色同色的块面受连通性保护（白肚子不会被吃掉）；随后清孤立小团（草稿飞白/杂点）、
侵蚀 1px 去底色毛边 + 羽化 1px，最后裁到 alpha 包围盒（立牌按纵横比重排平面，留白=缩水，见
unitArt.js 注释与 tmp/trim_unit_art.py 同约）。产物落盘后跑 compress_art.py --only stage 转 webp。

用法：
  python tools/cutUnitArt.py --src art_src/enemies_unit --dst src/assets/stage [--ids a,b,c] [--tol 30]
  python tools/cutUnitArt.py --src art_src/角色 --only-file 史莱姆.png --out-name unit_slime --bg black --tol 24
"""
import argparse
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def estimate_bg(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    corners = np.concatenate([
        rgb[0:4, 0:4].reshape(-1, 3), rgb[0:4, w - 4:w].reshape(-1, 3),
        rgb[h - 4:h, 0:4].reshape(-1, 3), rgb[h - 4:h, w - 4:w].reshape(-1, 3),
    ])
    return np.median(corners, axis=0)


def flood_mask(rgb: np.ndarray, bg: np.ndarray, tol: float) -> np.ndarray:
    """边界洪水填充：返回 True=背景（与边界连通且接近底色）。"""
    h, w, _ = rgb.shape
    dist = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(axis=2))
    near = dist < tol
    is_bg = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not is_bg[y, x]:
                is_bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not is_bg[y, x]:
                is_bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not is_bg[ny, nx]:
                is_bg[ny, nx] = True
                q.append((ny, nx))
    return is_bg


def despeckle(alpha: np.ndarray, min_area: int = 300) -> np.ndarray:
    """删孤立小团（alpha>0 且面积 < min_area 的连通域）——草稿飞白与杂点。"""
    h, w = alpha.shape
    seen = np.zeros((h, w), dtype=bool)
    out = alpha.copy()
    for sy in range(h):
        for sx in range(w):
            if alpha[sy, sx] > 0 and not seen[sy, sx]:
                q = deque([(sy, sx)])
                seen[sy, sx] = True
                comp = []
                while q:
                    y, x = q.popleft()
                    comp.append((y, x))
                    for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                        if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] > 0 and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                if len(comp) < min_area:
                    for y, x in comp:
                        out[y, x] = 0
    return out


def cut_one(src_path: str, dst_path: str, tol: float, bg_mode: str) -> tuple:
    im = Image.open(src_path).convert('RGB')
    rgb = np.asarray(im)
    bg = np.array([0, 0, 0]) if bg_mode == 'black' else (
        np.array([255, 255, 255]) if bg_mode == 'white' else estimate_bg(rgb))
    is_bg = flood_mask(rgb, bg.astype(np.float32), tol)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    alpha = despeckle(alpha)
    a_im = Image.fromarray(alpha, 'L')
    a_im = a_im.filter(ImageFilter.MinFilter(3))      # 侵蚀 1px：去底色毛边
    a_im = a_im.filter(ImageFilter.GaussianBlur(1.1))  # 羽化边缘
    rgba = np.dstack([rgb, np.asarray(a_im)])
    out = Image.fromarray(rgba, 'RGBA')
    box = out.split()[-1].getbbox()
    if not box:
        raise RuntimeError(f'{src_path}: 抠完是空的（tol={tol} 过大？）')
    out = out.crop(box)
    out.save(dst_path)
    return im.size, out.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dst', default='src/assets/stage')
    ap.add_argument('--ids', default=None, help='逗号分隔；缺省处理 src 下全部 png')
    ap.add_argument('--tol', type=float, default=30)
    ap.add_argument('--bg', choices=['auto', 'white', 'black'], default='white')
    ap.add_argument('--only-file', default=None, help='单文件模式（与 --out-name 搭配）')
    ap.add_argument('--out-name', default=None, help='单文件输出名（缺省 unit_<去扩展名>）')
    args = ap.parse_args()

    if args.only_file:
        jobs = [(args.only_file, (args.out_name or f'unit_{os.path.splitext(args.only_file)[0]}') + '.png')]
    else:
        names = sorted(f for f in os.listdir(args.src) if f.lower().endswith('.png'))
        if args.ids:
            keep = set(args.ids.split(','))
            names = [n for n in names if os.path.splitext(n)[0] in keep]
        jobs = [(n, f'unit_{os.path.splitext(n)[0]}.png') for n in names]

    os.makedirs(args.dst, exist_ok=True)
    for src_name, dst_name in jobs:
        before, after = cut_one(os.path.join(args.src, src_name), os.path.join(args.dst, dst_name),
                                args.tol, args.bg)
        print(f'{src_name} {before} -> {dst_name} {after}')
    print(f'共 {len(jobs)} 张。')


if __name__ == '__main__':
    main()
