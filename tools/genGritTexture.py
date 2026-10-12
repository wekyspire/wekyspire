#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 粗粝纹理生成器（UI_LANGUAGE.md 粗粝质感章）：程序化生成 256×256 可无缝平铺的
# 干笔刷/粗粝 alpha 纹理 → public/ui/grit256.png（白 + alpha，着色由使用方决定）。
# 平铺无缝 = 值噪声格点按尺寸取模回绕；干笔刷感 = 横向拉伸噪声（刷痕方向）+ 稀疏孔洞。
# 改参数后重跑即可，产物是静态资产（运行期零生成成本）。
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/ui/grit256.png'
SIZE = 256
SEED = 20261011


def lattice_noise(cells, size, rng, stretch=(1, 1)):
    """可平铺值噪声：cells×(cells*stretch) 格点 wrap 回绕，双线性+smoothstep 插值。"""
    lat = rng.random((cells * stretch[1], cells * stretch[0]))
    ys = np.linspace(0, cells * stretch[1], size, endpoint=False)
    xs = np.linspace(0, cells * stretch[0], size, endpoint=False)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % (cells * stretch[1])
    x1 = (x0 + 1) % (cells * stretch[0])
    y0 = y0[:, None]
    y1 = y1[:, None]
    a = lat[np.ix_(y0[:, 0], x0)]
    b = lat[np.ix_(y0[:, 0], x1)]
    c = lat[np.ix_(y1[:, 0], x0)]
    d = lat[np.ix_(y1[:, 0], x1)]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def main():
    rng = np.random.default_rng(SEED)
    # 颗粒底（多倍频 fbm，横纵各向同性）——频率取高：低频成团会像奶渍而非干笔刷
    grain = (lattice_noise(16, SIZE, rng) * 0.5
             + lattice_noise(32, SIZE, rng) * 0.3
             + lattice_noise(64, SIZE, rng) * 0.2)
    # 干笔刷刷痕：横向拉长（x 格少 y 格多 = 水平条纹），两档频率
    streak = (lattice_noise(10, SIZE, rng, stretch=(1, 8)) * 0.65
              + lattice_noise(20, SIZE, rng, stretch=(1, 12)) * 0.35)
    # 孔洞：高频噪声过阈 → 完全透明（干笔刷的飞白）
    pits = lattice_noise(96, SIZE, rng)

    alpha = np.full((SIZE, SIZE), 255.0)
    # 颗粒起伏 ±28
    alpha += (grain - 0.5) * 56
    # 刷痕亮暗 ±38（横向拉丝感的主要来源）
    alpha += (streak - 0.5) * 76
    # 飞白孔洞：pits > 0.86 的区域挖空（向阈值羽化 0.06）
    hole = np.clip((pits - 0.86) / 0.06, 0, 1)
    alpha *= (1 - hole)
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)

    img = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    img[..., 0:3] = 255  # 纯白，颜色信息全在 alpha
    img[..., 3] = alpha
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, 'RGBA').save(OUT)
    cov = float((alpha > 128).mean())
    print(f'{OUT.name} {SIZE}x{SIZE} 覆盖率 {cov:.0%}（seed {SEED}）')


if __name__ == '__main__':
    main()
