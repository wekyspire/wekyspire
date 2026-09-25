#!/usr/bin/env python3
# 瑞米姿势部署：art_src/remi_poses/<pose>/cand_<i>.png（黑底）→ 亮度抠透 + 内容框裁切
#   → src/assets/stage/remi_pose_<pose>.webp（RGBA q90）
# 用法：python tools/deployRemiPoses.py [--pick=sit:1,curious:0]   # 缺省全用 cand_0
import sys
from pathlib import Path
from PIL import Image

SRC = Path('art_src/remi_poses')
DST = Path('src/assets/stage')
# 亮度 → alpha 平滑阈（低阈值全透 → 高阈值不透；黑底干净、瑞米浅色身体安全）
LO, HI = 16, 52

picks = {}
for a in sys.argv:
    if a.startswith('--pick='):
        for kv in a[7:].split(','):
            k, _, v = kv.partition(':')
            picks[k] = int(v or 0)

poses = sorted(p.name for p in SRC.iterdir() if p.is_dir())
print(f'{len(poses)} 姿势: {",".join(poses)}')
for pose in poses:
    idx = picks.get(pose, 0)
    cands = sorted((SRC / pose).glob('cand_*.png'))
    if not cands:
        print(f'✗ {pose}: 无候选'); continue
    src = cands[min(idx, len(cands) - 1)]
    im = Image.open(src).convert('RGBA')
    # 亮度抠透
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            if lum <= LO:
                px[x, y] = (0, 0, 0, 0)
            elif lum < HI:
                px[x, y] = (r, g, b, int((lum - LO) * 255 / (HI - LO)))
    # 内容框裁切（8px 边距）
    bbox = im.getbbox()
    if bbox:
        pad = 8
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                min(w, bbox[2] + pad), min(h, bbox[3] + pad))
        im = im.crop(bbox)
    out = DST / f'remi_pose_{pose}.webp'
    im.save(out, 'WEBP', quality=90, method=4)
    print(f'✓ {pose} ← {src.name} → {out.name} {im.size}')
print('完成。')
