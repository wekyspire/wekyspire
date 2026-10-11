"""卡组 chip 图标扣 alpha：白底候选图 → 透明 PNG（src/assets/ui/deck_chip.png）。

算法同 tools/cutUnitArt.py 的洪水填充口径（边界连通的近白才算底，主体内部白块受
连通性保护），外加图标专用收尾：裁 alpha 包围盒 → 四周留 6% 边 → 方形画布 →
256×256（chip 在 40px/wu 高密度画布上 contain 内嵌，256 足够）。

用法：
  python tools/cutDeckIcon.py --src tmp/gen_out/deck_icon_<seed>.png [--dst src/assets/ui/deck_chip.png]
"""
import argparse
from collections import deque

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def flood_white_bg(rgb: np.ndarray, tol: float) -> np.ndarray:
    """边界洪水填充：返回 True=背景（与边界连通且接近白）。"""
    h, w, _ = rgb.shape
    near = rgb.astype(np.float32).min(axis=2) > 255 - tol   # 三通道都接近白才算近白
    is_bg = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x]:
                is_bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x]:
                is_bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not is_bg[ny, nx]:
                is_bg[ny, nx] = True
                q.append((ny, nx))
    return is_bg


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dst', default='src/assets/ui/deck_chip.png')
    ap.add_argument('--tol', type=float, default=18)
    ap.add_argument('--size', type=int, default=256)
    args = ap.parse_args()

    img = Image.open(args.src).convert('RGB')
    rgb = np.asarray(img)
    is_bg = flood_white_bg(rgb, args.tol)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    # 侵蚀 1px 去底色毛边 + 羽化 1px 抗锯齿（cutUnitArt 同口径）
    keep = ndimage.binary_erosion(alpha > 0, iterations=1)
    alpha = np.where(keep, alpha, 0)
    a_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1))
    alpha = np.asarray(a_img)

    # 裁 alpha 包围盒 → 四周留 6% → 方形 → 缩放到目标尺寸
    ys, xs = np.nonzero(alpha)
    if not len(xs):
        raise SystemExit('主体为空：扣像全灭，检查底色/容差')
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad_x = int((x1 - x0) * 0.06) + 4
    pad_y = int((y1 - y0) * 0.06) + 4
    x0, x1 = max(0, x0 - pad_x), min(rgb.shape[1] - 1, x1 + pad_x)
    y0, y1 = max(0, y0 - pad_y), min(rgb.shape[0] - 1, y1 + pad_y)
    out = np.dstack([rgb[y0:y1 + 1, x0:x1 + 1], alpha[y0:y1 + 1, x0:x1 + 1]])
    im = Image.fromarray(out, mode='RGBA')
    side = max(im.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    canvas = canvas.resize((args.size, args.size), Image.LANCZOS)
    canvas.save(args.dst)
    cov = (np.asarray(canvas)[:, :, 3] > 0).mean()
    print(f'✓ {args.dst}（{args.size}×{args.size}，覆盖率 {cov:.0%}）')


if __name__ == '__main__':
    main()
