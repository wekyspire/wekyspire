#!/usr/bin/env python3
"""seedream 素材生成管线（火山引擎方舟 / doubao-seedream-5-0-pro）。

用法：
    ARK_API_KEY=... python gen.py                 # 按 manifest 全量生成（已存在则跳过）
    ARK_API_KEY=... python gen.py --only unit_remi bg_dungeon
    ARK_API_KEY=... python gen.py --size 1K       # 覆盖尺寸（试水用最低档）

- refImages 条目走 i2i：本地参考图读为 base64 data URI（>1024px 先降采样，控制请求体积）。
- 输出到 out/<name>.png（response_format=url → 下载落盘）。
- 单个资产失败不中断批次，最后汇总失败列表。
"""
import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
MODEL_DEFAULT = "doubao-seedream-5-0-pro-260628"
BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"


def to_data_uri(path: Path, max_side: int = 1024) -> str:
    from PIL import Image
    img = Image.open(path).convert("RGB")
    if max(img.size) > max_side:
        ratio = max_side / max(img.size)
        img = img.resize((round(img.width * ratio), round(img.height * ratio)))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "seedream-gen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        f.write(resp.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="只生成指定名称")
    ap.add_argument("--size", default=None, help="覆盖 manifest 尺寸（如 1K/2K）")
    ap.add_argument("--force", action="store_true", help="已存在也重新生成")
    args = ap.parse_args()

    api_key = os.environ.get("ARK_API_KEY")
    if not api_key:
        print("错误：环境变量 ARK_API_KEY 未设置", file=sys.stderr)
        return 2

    from volcenginesdkarkruntime import Ark
    client = Ark(base_url=BASE_URL, api_key=api_key)

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    model = manifest.get("model", MODEL_DEFAULT)
    default_size = args.size or manifest.get("size", "1K")
    OUT.mkdir(exist_ok=True)

    failures = []
    for entry in manifest["assets"]:
        name = entry["name"]
        if args.only and name not in args.only:
            continue
        out = OUT / f"{name}.png"
        if out.exists() and not args.force:
            print(f"[skip] {name}（已存在，--force 可重生成）")
            continue

        kwargs = dict(
            model=model,
            prompt=entry["prompt"],
            response_format="url",
            size=args.size or entry.get("size", default_size),
            stream=False,
            watermark=False,
        )
        refs = entry.get("refImages")
        if refs:
            kwargs["image"] = [to_data_uri(ROOT / r) for r in refs]

        print(f"[gen] {name} size={kwargs['size']} refs={len(refs or [])} ...", flush=True)
        t0 = time.time()
        try:
            resp = client.images.generate(**kwargs)
            url = resp.data[0].url
            download(url, out)
            print(f"[ok] {name} -> {out.name}（{time.time() - t0:.0f}s）", flush=True)
        except Exception as e:  # 单资产失败不中断批次
            failures.append(name)
            print(f"[fail] {name}: {e}", file=sys.stderr, flush=True)

    if failures:
        print(f"失败：{', '.join(failures)}", file=sys.stderr)
        return 1
    print("全部完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
