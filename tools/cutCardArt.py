"""卡面系列符号抠图垫版：白底符号 PNG → 透明 2:1 垫版 → src/assets/cards/<series>.png。

与 unit 立牌不同：卡面图区（cardFace.js ART_RECT 176×88 = 2:1）对卡图做 cover 裁切，
bbox 裁边的符号会被二次裁掉上下——所以抠出符号后要垫回 2:1 透明画布（符号居中、
占短边 ~80%），保证符号完整落在图区内、四边透明渐隐融入卡面底板。
产物落盘后跑 compress_art.py --only cards 转 webp。

用法：python tools/cutCardArt.py --src art_src/cards_qwen [--dst src/assets/cards] [--ids a,b,c] [--tol 30]
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter

from cutUnitArt import despeckle, estimate_bg, flood_mask

CANVAS = (704, 352)   # 2:1（ART_RECT 176×88 的 4 倍，烘焙富余）
FILL_W, FILL_H = 0.86, 0.8  # 符号可用画幅（宽/高占比），四周留白融入底板


def cut_pad(src_path: str, dst_path: str, tol: float) -> tuple:
    im = Image.open(src_path).convert('RGB')
    rgb = np.asarray(im)
    bg = estimate_bg(rgb)
    is_bg = flood_mask(rgb, bg.astype(np.float32), tol)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    alpha = despeckle(alpha)
    a = Image.fromarray(alpha, 'L')
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    rgba = Image.fromarray(np.dstack([rgb, np.asarray(a)]), 'RGBA')
    box = rgba.split()[-1].getbbox()
    if not box:
        raise RuntimeError(f'{src_path}: 抠完是空的（tol={tol} 过大？）')
    sym = rgba.crop(box)
    cw, ch = CANVAS
    scale = min(cw * FILL_W / sym.width, ch * FILL_H / sym.height)
    sym = sym.resize((max(1, round(sym.width * scale)), max(1, round(sym.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    out.paste(sym, ((cw - sym.width) // 2, (ch - sym.height) // 2), sym)
    out.save(dst_path)
    return im.size, sym.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dst', default='src/assets/cards')
    ap.add_argument('--ids', default=None)
    ap.add_argument('--tol', type=float, default=30)
    args = ap.parse_args()

    names = sorted(f for f in os.listdir(args.src) if f.lower().endswith('.png'))
    if args.ids:
        keep = set(args.ids.split(','))
        names = [n for n in names if os.path.splitext(n)[0] in keep]
    os.makedirs(args.dst, exist_ok=True)
    for n in names:
        dst = os.path.join(args.dst, n)
        before, sym = cut_pad(os.path.join(args.src, n), dst, args.tol)
        print(f'{n} {before} -> 符号 {sym} -> {dst}')
    print(f'共 {len(names)} 张。')


if __name__ == '__main__':
    main()
