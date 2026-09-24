# CARD_ART.md — 卡面图管线（场景时代）

> 卡面图的设计口径与生产管线。卡面图 = **骑士出演的动作场景**（图标化的厚涂速写），
> 不是符号徽标，也不是插画——「展现动作的基础上进行图标化」：弱化细节、大块纯色概括形体、
> 表现力优先（用户 2026-09-22 二轮定稿，取代首轮符号口径）。

## 一、设计口径（用户 2026-09-22 定）

- **演员 = 骑士**：玩家卡的卡面统一画骑士做那件事（挥拳、托焰、坐云……），一眼认出是什么卡。
  Z 状态/敌方衍生卡没有骑士——画那个东西本身（烟问号、绷带灼伤、尘云、黏液怪……）。
- **风格**：粗糙厚涂速写（rough gouache）、极宽大笔触、极低完成度、多边形色块、
  美漫式强烈光影分割、冷光自左上、无勾线、**纯黑背景**、主体撑满画幅、紧致特写裁切。
  锚图 = `art_src/骑士概念.png`（构图/角色）+ `art_src/角色/骑士背面-普通png.png`（笔触粒度）。
- **角色设定（不可破）**：闷钢灰全身板甲（保留金属感、略压暗）、同色圆盔、**细淡横面甲缝、
  眼不发光**、五指、亮红围巾（唯一色彩强调）。
- **武装设定（2026-09-22 用户定）**：骑士**无盾**——格挡只靠臂甲（crossed vambraces）；
  佩**大剑**（直刃双手巨剑），不是刀。法术效应（灵能屏障/树皮甲）不受「盾」禁词约束，
  但骑士本人永不持盾。
- **无 alpha**：场景全幅黑底，直接 cover 进 ART_RECT，不做抠图。
- 粒度沿用：**每系列/家族一键**（`series` 键；无系列灰卡经 `def.image` 逐卡接线）。

## 二、解析链（`src/stage/art/cardArtCache.js`）

```
def.image  →  card.series  →  `${type}-${等阶序号}`（D=0..S=4，兜底，现无素材）
```

素材位 = `src/assets/cards/<key>.webp`（704×352，2:1 全幅场景；卡面 ART_RECT 176×88 cover 贴合，
上下渐隐进卡底色 + 主题色描边）。键集合 = 注册表全卡解析键并集（2026-09-22 审计 71 活键 +
GM 调试卡 `normal-1` 无图属预期；死键 inflame 曾误入表已清除——点火卡 series=ignite）。

## 三、生产管线（本地 ComfyUI，免费可重跑）

```bash
node tools/genCardScenes.mjs [--only key1,key2] [--count N]   # ① 逐键抽卡 → art_src/cards_scenes/<key>/cand_<i>_<seed>.png
python tmp/review_scenes.py [keys…]                           # ② 拼版检阅（2:1 中裁缩略图行）
python tmp/deploy_scenes.py                                   # ③ 按 tmp/scene_picks.md 胜者 → 中裁 704×352 → webp
```

- 生成器：`tools/genCardScenes.mjs`。KNIGHT/STYLE/NEGATIVE 三常量 = 定稿风格口径；
  SCENES 表 = 每键一句手写 prompt（**不准交给模型写**）。
- **prompt 编写纪律（2026-09-22 用户严令）**：英文键名与卡面中文名/效果可能严重偏离——
  写 prompt 前必须读该键全部卡的中文名 + describe + 所属体系设计文档
  （`battle_gameplay/skills/*.md`）理解家族内涵，画面语义以中文卡面为准。
  审计脚本 `tmp/dump-image-keys.mjs` → `tmp/image_key_audit.txt`（键→卡全表）。
- 抽卡纪律（用户定）：每键先抽 3 张，全不满意再补到 5+；评审 = 我的视觉判断，
  四要素：**风格相符 / 与 concept 相似（钢灰盔非纯黑、面甲缝、红围巾、五指）/
  表达力（卡面尺寸下的可读性）/ 美观**；记录在 `tmp/scene_picks.md`。
- ComfyUI `127.0.0.1:8188`，qwen_image_2.1，25 步 euler，1344×768，单张约 60–90s；
  已存在的跳过（resume），`--count` 控制目标张数。

## 四、踩坑记录（场景时代实测）

- **模型会漂移，prompt 对了不等于图对了**：kindling prompt 写「臂上血滴着火」，首批画成
  普通拢焰（血滴退化成红点）——评审时要按卡面语义挑候选，不是按构图美观挑。
- **超时偶发**：单张 ~5% 超时（blade#0），resume 重跑补齐即可。
- **近义键要互查区分度**：common/fireControl/ignite/patience 都是「掌焰」——
  评审时须确保四键构图/姿态互不重复（正面托掌 / 侧首引焰 / 掌侧腾焰 / 俯首守血焰）。
- 符号时代的灰卡 prompt 坍缩教训仍适用：抽象词 → 毛笔符文；写**具体物体名词**。
- 旧符号管线（`tools/genCardArt.mjs` + `tools/cutCardArt.py`）已退役，仅存档备查。
