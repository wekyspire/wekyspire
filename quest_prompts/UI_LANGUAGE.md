# UI 设计语言（2026-10-11 定稿起笔）

> 玩家可见的一切 UI 铬件（按钮/面板/条/槽/角标/对话框/tooltip）遵循本文。
> 卡牌卡面、单位立绘、场景道具、资源水晶/金币、单位状态条等**游戏内容视觉**不属
> UI 铬件，不受本文约束。

## 形状语言：方角 + 厚边框

- 一切 UI 铬件 **0 圆角**（方角）。旧「圆角 + 细描边」语言已废弃——目标是踏实、
  不纤弱。
- 边框一律**厚描边**：3D 烘焙 ≈ 3 逻辑 px（10px/wu 口径，约短边 5%）；DOM/CSS 2px。
  不再有 1px 级细边。
- 配色 = **黑白主题**（2026-10-11 用户定）：底 = 近黑中性灰，边框/文字 = 白与灰阶，
  **无彩**；hover/激活 = 灰阶提亮（不引入彩色）。金色只留给金钱相关内容；
  标题白 `#f2f2f2` / 提示灰 `#c2c2c2`。

## 例外类目

- **icon 类按钮 = 无底无框**：纯以带 alpha 的图标表示（首例 = 顶栏卡组按钮，
  `assets/ui/deck_chip`）。hover 只做缩放反馈，命名靠 tooltip；信息性角标
  （张数等）保留，角标自身方角厚边。
- **有美术素材的展示物直出素材**：遗物等已有立绘的展示位**不画底片、不画边框**，
  立绘直接呈现；素材缺席才回落「方角厚描边底片 + 特征字」占位（稀有度色描边）。

## 旋钮所在（改样式只改这些地方）

- 3D 按钮（面板按钮/操纵条/选卡确认键等全部按钮）：`src/stage/richtext/buttonFace.js`
  （THEMES 主题 + bake 圆角/线宽）。
- 顶部菜单栏窄条与遗物槽：`src/stage/objects/TopResourceBarObject.js`
  （bakeStrip / bakeRelicSlot）。
- 备战遗物装卸区：`src/stage/objects/RelicLoadoutObject.js`
  （iconTexture / barTrackTexture / zoneEdgeTexture）。
- icon 按钮：`src/stage/objects/DeckChipObject.js`。
- DOM 层：GameMenu / MenuDialog / MenuPopup / EndPanel / ChangeLog / StartScreen /
  CutsceneOverlay / TooltipOverlay / BattleHud / RichTextInline / App.vue（menu-fab）
  的 `<style>` 块。

## 暂不受管的页面

- 观战页 `watch.html`（WatchApp）与调试浮层 DebugOverlay：工具页，不进玩家 UI 语言。
- CardFacePreview 的圆角 = 卡牌语言（卡面本体），非 UI 铬件。
