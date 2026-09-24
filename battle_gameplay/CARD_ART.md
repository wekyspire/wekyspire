# CARD_ART.md — 卡面符号图管线

> 卡面图的设计口径与生产管线。卡面图 = **传达符号**（一拳一刀一盾一焰），不是插画。

## 一、设计口径（用户 2026-09-22 定）

- **符号性质优先，美观其次**：一张图说清「这是什么卡」，玩家在 0.5 秒内认出系列/家族。
- **每系列固定主题色**：火系只用红橙黄白黑、体修/通用灰卡用岩灰白黑 + 一点赭、木系深浅绿 + 米白、
  风系青蓝白 + 藏青。其它颜色只作点缀。色板表在 `tools/genCardArt.mjs` 的 `PALETTES`。
- **绝对不扣细节**：大形体、粗笔触、强剪影；禁止纹理、场景、边框、多物体。
- 粒度 = **每系列/家族一个符号**（不为单卡出图）：fist/blade/block…按 `series` 键；
  无系列的通用灰卡按家族（纯化/萃取/魏启罐…）经 `def.image` 逐卡接线。

## 二、解析链（`src/stage/art/cardArtCache.js`）

```
def.image  →  card.series  →  `${type}-${等阶序号}`（D=0..S=4，兜底，现无素材）
```

素材位 = `src/assets/cards/<key>.webp`（704×352，2:1 透明底符号；卡面 ART_RECT 176×88 cover 贴合，
上下渐隐进卡底色 + 主题色描边）。**新系列卡要出图：在 `tools/genCardArt.mjs` 的 SERIES 表加一行
（id = series 键）再跑管线即可**，core 侧零改动；无系列卡则须在 def 上加 `image` 字段。

## 三、生产管线（本地 ComfyUI，免费可重跑）

```bash
node tools/genCardArt.mjs [--only id1,id2] [--force] [--out 目录]   # ① 白底 1024² 符号图 → art_src/cards_qwen/
python tools/cutCardArt.py --src art_src/cards_qwen                  # ② 洪泛抠图 → 704×352 透明画布 → src/assets/cards/*.png
python tools/compress_art.py --only cards                            # ③ 原位转 WebP 删 PNG
```

- 生成器与敌人立牌同一套（白底 + 洪泛抠图）：ComfyUI `127.0.0.1:8188`，qwen_image_2.1，25 步 euler，
  单张约 60–90s；已存在的跳过，`--force` 覆盖。
- 风格词锚「minimalist symbolic emblem + flat rough gouache + absolutely minimal detail」，
  描述只写「是什么 + 一个形态词」（遗物模板同一方法论：完成度由名词密度驱动，不由风格词驱动）。

## 四、踩坑记录（2026-09-22 实测）

- **灰色系 prompt 极易坍缩成「毛笔符文」**：抽象词（shield silhouette / stain / umbrella 直译徽标化）
  会被画成十字形笔刷字；多张灰卡因此长成同一个模样（圆 + 十字）。解法 = **写具体物体名词**
  （round wooden shield with a raised center boss / glass potion jar with a cork lid / folded closed umbrella），
  一次即中。
- **「round X」易触发「圆形硬币 + 中央字符」**（panpanBread 连踩两次）；改成 oval/side view 后正常。
- 拼版检阅脚本 `tmp/review_cardart.py`（一次性）：全符号缩略图 + MISSING 标红，离群单张 `--only` 重跑。
- 覆盖率审计口径：注册表全卡遍历，键存在但素材缺失 = 事故；首批 47 张漏了 25 个系列键
  （火系子系列比预估多），第二批补齐后才全绿（仅剩 GM 调试卡 onePunch/gmPunch50 无图，属预期）。
