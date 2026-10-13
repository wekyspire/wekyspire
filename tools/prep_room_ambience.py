# -*- coding: utf-8 -*-
"""休息室氛围素材加工（一次性；再生素材重跑）：
尾标滴滴声切除（数字静音甄别：内容→静音 gap→1s 蜂鸣→EOF，切在 gap 起点）
→ 首尾 25ms 淡化防爆音 → loop 素材等功率接缝循化（尾 0.6s 与头交叠）
→ 单声道混缩 + 分档降采样（环境/篝火 16k，白噪/通电 24k）→ src/assets/sounds/。

用法：python tools/prep_room_ambience.py
"""
import os
import wave
import numpy as np
from scipy.signal import resample_poly

SRC = r"C:\Users\hineven\Downloads"
# (源文件名, 产物名, 循环?, 目标采样率)
JOBS = [
    ("塔楼室内环境音（无火把）", "room-indoor", True, 16000),
    ("塔楼室内环境音（带火把）", "room-indoor-torch", True, 16000),
    ("显像管电器白噪音", "room-crt-hum", True, 24000),
    ("篝火", "room-campfire", True, 16000),
    ("通电", "power-on", False, 24000),
]
FADE_MS = 25
LOOP_XFADE = 0.6


def load(path):
    with wave.open(path, "rb") as w:
        rate, ch = w.getframerate(), w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch)
    return rate, data.astype(np.float64) / 32768.0


def cut_tail_beep(rate, data):
    """定位尾部蜂鸣：找「静音 gap 后还有 ≥0.3s 非静音块」的最后一个 gap，内容切在 gap 起点。
    实测素材结构：内容 → ~0.1s 静音缝 → ~1.1s 断续蜂鸣 burst → EOF（缝比蜂鸣短得多）。"""
    hop = 512
    mono = np.abs(data).max(axis=1)
    n = len(mono) // hop
    peak = mono.max()
    eps = max(peak * 5e-4, 2.0 / 32768.0)
    loud = np.array([mono[i * hop:(i + 1) * hop].max() > eps for i in range(n)])
    cut = None
    i = 0
    while i < n:
        if not loud[i]:
            j = i
            while j < n and not loud[j]:
                j += 1
            if j < n and (j - i) * hop >= 0.08 * rate and (n - j) * hop >= 0.3 * rate:   # gap→蜂鸣块
                cut = i * hop   # 内容自然终点 = gap 起点
            i = j
        else:
            i += 1
    if cut is None:
        cut = max(0, len(data) - int(1.1 * rate))   # 兜底：按 1s 蜂鸣硬切
        print("  ⚠ 未检出尾标结构，按 1.1s 硬切（人工复核！）")
    return data[:cut]


def fade_edges(rate, data, ms=FADE_MS):
    n = int(rate * ms / 1000)
    if n * 2 >= len(data):
        return data
    env = np.linspace(0.0, 1.0, n, endpoint=False)[:, None]
    data[:n] *= env
    data[-n:] *= env[::-1]
    return data


def loop_seam(rate, data, overlap_s=LOOP_XFADE):
    """等功率接缝：尾 O 秒与头 O 秒 sin/cos 交叠，产出长度 len-O 的无缝循环体。"""
    o = int(rate * overlap_s)
    if o * 2 >= len(data):
        return data
    body = data[:-o].copy()
    tail = data[-o:]
    head = data[:o]
    t = np.linspace(0.0, np.pi / 2, o, endpoint=False)
    body[-o:] = tail * np.cos(t)[:, None] + head * np.sin(t)[:, None]
    return body


for src_name, out_name, is_loop, target in JOBS:
    rate, data = load(os.path.join(SRC, src_name + ".wav"))
    raw_s = len(data) / rate
    data = cut_tail_beep(rate, data)
    data = fade_edges(rate, data)
    if is_loop:
        data = loop_seam(rate, data)
    data = data.mean(axis=1)   # 单声道混缩
    if rate != target:
        g = np.gcd(rate, target)
        data = resample_poly(data, target // g, rate // g)
    out = np.clip(data * 32767.0, -32768, 32767).astype(np.int16)
    dst = os.path.join("src", "assets", "sounds", out_name + ".wav")
    with wave.open(dst, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(target)
        w.writeframes(out.tobytes())
    rms = float(np.sqrt(np.mean(np.square(data))))
    print(f"{src_name}: {raw_s:.2f}s → 循环 {len(out)/target:.2f}s @{target}Hz "
          f"{os.path.getsize(dst)/1048576:.2f}MB RMS={rms:.4f}")
