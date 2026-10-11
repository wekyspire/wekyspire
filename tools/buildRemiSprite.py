#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 瑞米加载涂鸦 sprite 管线（UI_LANGUAGE.md 加载涂鸦章）：
#   art_src/remi.mp4（Seedance 白描走路循环）→ public/ui/remi_loader.png（横向序列帧）
# 工序：① 去水印 = 黑底画面上把右下角「生成」logo 区直接填黑（背景纯黑，无损）
#       ② 循环区间 = 全帧对 MSE 最小的一对 (i,j)（步态回摆点），取 [i,j) 为循环段
#       ③ 内容 bbox 并集裁剪 + 降采样   ④ alpha = 亮度（白线变真透明通道）
# 输出末尾打印帧数与单帧尺寸——index.html 的 steps() 动画参数照此填。
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art_src/remi.mp4'
OUT = ROOT / 'public/ui/remi_loader.png'

WATERMARK = (1000, 600, 1280, 720)  # (x0,y0,x1,y1) 右下角 logo 区（1280×720 画布）
TARGET_W = 340                      # 单帧目标宽（显示 ~170px，2× 给 HiDPI）
N_FRAMES = 12                       # 序列帧采样数（12fps 播放 = 1s 一圈）
LOOP = (10, 34)                     # 循环段（帧分析定稿）：单步态 24 帧；闭合缝 22k
#   差异像素 < 环内相邻帧均值 53k 的一半（线条本身逐帧沸腾），缝合不可见；且整段早于
#   顶部左侧水印的淡入帧（f99+），只需遮右下角 logo。主体零伸入填黑区（已逐帧验证）。


def main():
    cap = cv2.VideoCapture(str(SRC))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        fr[WATERMARK[1]:WATERMARK[3], WATERMARK[0]:WATERMARK[2]] = 0  # ① 填黑去水印
        frames.append(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY))
    cap.release()
    n = len(frames)
    if n < LOOP[1]:
        raise SystemExit(f'帧数 {n} 不足循环段 {LOOP}')
    print(f'读入 {n} 帧，循环段 [{LOOP[0]}, {LOOP[1]})')
    i0, i1 = LOOP

    # ③ 内容 bbox 并集（循环段内亮度 > 40 的像素）+ 8px 边距
    acc = np.zeros_like(frames[0])
    for f in frames[i0:i1]:
        acc = np.maximum(acc, f)
    ys, xs = np.where(acc > 40)
    x0, x1 = max(0, xs.min() - 8), min(acc.shape[1], xs.max() + 9)
    y0, y1 = max(0, ys.min() - 8), min(acc.shape[0], ys.max() + 9)

    # ④ 抽帧 + 降采样 + 亮度转 alpha，横向拼条
    take = [i0 + round(k * (i1 - i0) / N_FRAMES) for k in range(N_FRAMES)]
    scale = TARGET_W / (x1 - x0)
    th = round((y1 - y0) * scale)
    strip = np.zeros((th, TARGET_W * N_FRAMES, 4), dtype=np.uint8)
    for k, fi in enumerate(take):
        crop = frames[fi][y0:y1, x0:x1]
        g = cv2.resize(crop, (TARGET_W, th), interpolation=cv2.INTER_AREA)
        a = np.clip(g.astype(np.float32) * 1.15, 0, 255).astype(np.uint8)  # 亮度→alpha（微增益）
        strip[:, k * TARGET_W:(k + 1) * TARGET_W, 0:3] = 255
        strip[:, k * TARGET_W:(k + 1) * TARGET_W, 3] = a
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(strip, 'RGBA').save(OUT)
    print(f'{OUT.name}：{N_FRAMES} 帧 × {TARGET_W}×{th}（播放参数：steps({N_FRAMES})，'
          f'周期 {N_FRAMES / 12:.2f}s @12fps）')


if __name__ == '__main__':
    main()
