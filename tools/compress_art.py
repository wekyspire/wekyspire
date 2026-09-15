#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""美术资源压缩管线：src/assets 下 PNG 原位转 WebP（删原件），JPG 不动。

用法：
    python tools/compress_art.py            # 全量转换（已转过的自动跳过——原件已删）
    python tools/compress_art.py --dry-run  # 只报告不写盘
    python tools/compress_art.py --only relics   # 只转某子目录（新素材批量入库时用）

设计要点：
- 立绘（stage/）带透明通道，WebP 原生支持 alpha，浏览器全兼容。
- 背景/CG 等无透明大图 q85 即可（视觉无损）；带 alpha 的立绘用 q90 保边缘。
- 卡图/装饰（cards/）不透明插画，q85。
- 遗物立绘（relics/）带 alpha 的成品图，q90。
- 前端解析层（stage/art/unitArt.js、cardArtCache.js）按「去扩展名」查表，
  png/webp 混放不影响代码；新素材丢进 assets 后重跑本脚本即可。
"""
import argparse
import os
import sys

from PIL import Image

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')

# 目录前缀 → 质量（越具体的规则越靠前）
QUALITY_RULES = [
    ('stage/', 90),   # 立绘：带 alpha，保边缘
    ('tower/', 90),   # 塔楼拼接模块：带 alpha，保层间衔接边缘
    ('relics/', 90),  # 遗物立绘：带 alpha，保白描边边缘
    ('ui/', 90),      # 气泡等 UI 小件：带 alpha，保边缘
    ('cards/', 85),   # 卡图插画
    ('images/', 85),  # 背景/CG
    ('cutscenes/', 85),
]
DEFAULT_QUALITY = 85


def quality_for(rel):
    rel = rel.replace('\\', '/')
    for prefix, q in QUALITY_RULES:
        if rel.startswith(prefix):
            return q
    return DEFAULT_QUALITY


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--only', default=None,
                    help='只处理该子目录（相对 src/assets，如 relics）；缺省全量')
    args = ap.parse_args()

    total_before = total_after = 0
    for root, _dirs, files in os.walk(ASSETS):
        for name in files:
            if not name.lower().endswith('.png'):
                continue
            src = os.path.join(root, name)
            dst = src[:-4] + '.webp'
            rel = os.path.relpath(src, ASSETS)
            if args.only and not rel.replace('\\', '/').startswith(args.only.strip('/') + '/'):
                continue
            before = os.path.getsize(src)
            if args.dry_run:
                print(f'[dry] {rel} ({before / 1048576:.2f}MB) -> webp q{quality_for(rel)}')
                continue
            img = Image.open(src)
            img.save(dst, 'WEBP', quality=quality_for(rel), method=6)
            after = os.path.getsize(dst)
            os.remove(src)
            total_before += before
            total_after += after
            print(f'{rel}: {before / 1048576:.2f}MB -> {after / 1048576:.2f}MB '
                  f'({100 * after / before:.0f}%)')
    if not args.dry_run:
        print(f'\n合计：{total_before / 1048576:.1f}MB -> {total_after / 1048576:.1f}MB')


if __name__ == '__main__':
    sys.exit(main())
