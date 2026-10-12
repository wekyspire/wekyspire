#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# UI 字体子集化管线（UI_LANGUAGE.md 字体章）：
#   游戏子集 = **GB2312 一级字表（3755 字，按编码区间枚举，无需字表文件）**
#     ∪ 全库静态文本扫描（src/**/*.js|vue、public/**/*、*.html）∪ ASCII/CJK 标点。
#     双子集同一份字符集：
#       · 标题/数字 = 文道潮黑 → public/fonts/wendaochaohei.woff2（家族名 WenDaoChaoHei）
#       · 正文 = 思源黑体 TC Bold → public/fonts/sourcehansantc.woff2（家族名 SourceHanTC）
#         （2026-10-11 用户定：文道潮黑成段太挤，正文换思源黑体拉开辨识度）
#     （2026-10-11 用户定：按常用字表裁而非仅扫现文案——未来新增文案常用字直接命中；
#     二级生僻字未收，真用到由扫描集补上并重跑。）
#   启动子集 = BOOT_TEXT 固定字符集（启动壳全部文案，与 index.html 同步维护）
#     → base64 data URI，自动重写 index.html 的 <!-- BOOT-FONT:BEGIN/END --> 标记块
#     （零请求：HTML 解析即上色，字体不经过它自己把守的加载链）。
#     启动壳只有标题/短状态行 → 只子集文道潮黑；正文字体走正常加载链。
# 源字体：art_src/fonts/WenDaoChaoHei.ttf（文道潮黑，用户确认可商用 2026-10-11）、
#         art_src/fonts/SourceHanSansTC-Bold.otf（思源黑体 TC，SIL OFL 1.1 免费商用）。
# ⚠ 文案用到生僻字（GB2312 二级）时须重跑本脚本（扫描集会自动带上该字）。
import base64
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# (源字体, 产物, @font-face 家族名)
GAME_FONTS = [
    (ROOT / 'art_src/fonts/WenDaoChaoHei.ttf', ROOT / 'public/fonts/wendaochaohei.woff2', 'WenDaoChaoHei'),
    (ROOT / 'art_src/fonts/SourceHanSansTC-Bold.otf', ROOT / 'public/fonts/sourcehansantc.woff2', 'SourceHanTC'),
]
SRC_FONT = GAME_FONTS[0][0]   # 启动子集源（标题字族）
INDEX = ROOT / 'index.html'

# 启动壳文案（index.html 静态壳 + App.vue GPU 门 fatal 文本；改壳文案要同步这里）
BOOT_TEXT = (
    '魏启尖塔加载美术资源…网络较慢或异常——可稍候或刷新重试失败项请检查后'
    '剩余约秒分此设备浏览器不支持，无法运行本游戏检测到当前页面不在安全上下文（'
    '）只在下可用若你正在用裸地址访问，请改用域名本机后请使用较新的桌面版'
    '并确保硬件加速开启重试'
    '0123456789./%:｜—+ KMGBs'
)

SCAN_GLOBS = [
    ('src', ('.js', '.vue')),
    ('public', ('.md', '.js', '.html', '.json')),
    ('', ('.html',)),  # 根目录 index.html / watch.html 等
]


def gb2312_level1():
    """GB2312 一级常用汉字（3755 字）：编码区间 0xB0A1–0xD7F9，按区位枚举。"""
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.append(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                continue
    return chars


def scan_chars():
    chars = set()
    for sub, exts in SCAN_GLOBS:
        base = ROOT / sub if sub else ROOT
        files = []
        for ext in exts:
            files += list(base.rglob(f'*{ext}'))
        for p in files:
            if any(seg in ('node_modules', 'dist', '.git') for seg in p.parts):
                continue
            try:
                text = p.read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue
            for ch in text:
                cp = ord(ch)
                if cp >= 0x2000 and not (0xD800 <= cp <= 0xDFFF):
                    chars.add(ch)
    # ASCII 可印字符 + 常用 CJK/全角标点恒带上 + GB2312 一级常用字表（常用字兜底）
    chars |= {chr(c) for c in range(0x20, 0x7F)}
    chars |= set('，。！？；：、「」『』【】（）《》〈〉—…·～％‰￥、')
    chars |= set(gb2312_level1())
    return ''.join(sorted(chars))


def subset(src_font, text_file, out_file, extra=None):
    cmd = [
        sys.executable, '-m', 'fontTools.subset', str(src_font),
        f'--output-file={out_file}', '--flavor=woff2',
        f'--text-file={text_file}', '--layout-features=*', '--desubroutinize',
    ]
    if extra:
        cmd += extra
    subprocess.run(cmd, check=True)


def main():
    tmp = ROOT / 'tmp/fontsubset'
    tmp.mkdir(parents=True, exist_ok=True)

    game_chars = scan_chars()
    game_txt = tmp / 'game_chars.txt'
    game_txt.write_text(game_chars, encoding='utf-8')
    for src_font, out_file, family in GAME_FONTS:
        if not src_font.exists():
            sys.exit(f'缺源字体：{src_font}')
        subset(src_font, game_txt, out_file)
        kb = out_file.stat().st_size // 1024
        print(f'游戏子集[{family}]：{len(game_chars)} 字符 → {out_file.name} {kb}KB')

    boot_txt = tmp / 'boot_chars.txt'
    boot_txt.write_text(BOOT_TEXT, encoding='utf-8')
    boot_woff2 = tmp / 'boot.woff2'
    subset(SRC_FONT, boot_txt, boot_woff2)
    b64 = base64.b64encode(boot_woff2.read_bytes()).decode('ascii')
    print(f'启动子集：{len(set(BOOT_TEXT))} 字符 → data URI {len(b64) // 1024}KB（base64）')

    faces = [
        "      @font-face {\n"
        "        font-family: 'WDCHBoot';\n"
        f"        src: url(data:font/woff2;base64,{b64}) format('woff2');\n"
        '        font-display: block;\n'
        '      }',
    ]
    for _, out_file, family in GAME_FONTS:
        faces.append(
            '      @font-face {\n'
            f"        font-family: '{family}';\n"
            f"        src: url('./fonts/{out_file.name}') format('woff2');\n"
            '        font-display: swap;\n'
            '      }'
        )
    block = (
        '<!-- BOOT-FONT:BEGIN（tools/buildFontSubset.py 自动生成，勿手改） -->\n'
        '    <style>\n' + '\n'.join(faces) + '\n    </style>\n'
        '    <!-- BOOT-FONT:END -->'
    )
    html = INDEX.read_text(encoding='utf-8')
    pat = re.compile(r'<!-- BOOT-FONT:BEGIN.*?BOOT-FONT:END -->', re.S)
    if not pat.search(html):
        sys.exit('index.html 缺 BOOT-FONT 标记块——先在 <head> 里放 BEGIN/END 注释再跑')
    INDEX.write_text(pat.sub(lambda _: block, html), encoding='utf-8')
    print('index.html 字体块已重写')


if __name__ == '__main__':
    main()
