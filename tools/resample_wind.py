# -*- coding: utf-8 -*-
"""风声床 WAV 减重：40kHz 立体声 → 16kHz 单声道（小水管服务器带宽减负）。

风声 = 宽带噪声床，无立体声像（混响 IR 立体声会重新展开声场）、感知能量集中
在低频——16kHz 采样（保留 <8kHz 频段）足够。重采样走 scipy resample_poly
（窗口 sinc 抗混叠，40k→16k = up 2 / down 5 精确有理比）。

用法（重跑改目标采样率：改 TARGET_RATE；恢复原文件：git checkout）：
  python tools/resample_wind.py
"""
import wave
import numpy as np
from scipy.signal import resample_poly
from pathlib import Path

FILES = [
    "src/assets/sounds/wind-tower.wav",
    "src/assets/sounds/wind-tower-soft.wav",
]
TARGET_RATE = 16000


def process(path):
    p = Path(path)
    with wave.open(str(p), "rb") as w:
        rate = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        assert width == 2, f"{p.name}: 期望 16bit PCM，实际 {width * 8}bit"
        frames = w.getnframes()
        raw = w.readframes(frames)
    data = np.frombuffer(raw, dtype=np.int16).reshape(-1, ch).astype(np.float64) / 32768.0
    if ch > 1:
        data = data.mean(axis=1)  # 单声道混缩
    if rate != TARGET_RATE:
        g = np.gcd(rate, TARGET_RATE)
        data = resample_poly(data, TARGET_RATE // g, rate // g)
    out = np.clip(data * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_RATE)
        w.writeframes(out.tobytes())
    rms = float(np.sqrt(np.mean(np.square(data))))
    print(f"{p.name}: {rate}Hz/{ch}ch/{frames}帧 → {TARGET_RATE}Hz/1ch/{len(out)}帧"
          f"  {p.stat().st_size / 1048576:.2f}MB  RMS={rms:.4f}")


for f in FILES:
    process(f)
