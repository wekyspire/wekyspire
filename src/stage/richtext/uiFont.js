// UI 字体族唯一事实源（UI_LANGUAGE.md 字体章，双字族 2026-10-11 用户定）：
//   UI_FONT      标题/数字/短语 = 文道潮黑（展示字族，本体即粗、禁叠 bold）
//   UI_FONT_BODY 成句/成段正文 = 思源黑体 TC Bold（潮黑成段太挤，正文辨识度优先）
// 均为 public/fonts 子集 woff2（@font-face 在 index.html 的 BOOT-FONT 块）→ 系统黑体兜底。
// canvas 烘焙拼 font 串一律经这里，不要再写裸 `sans-serif`（烘焙时机见 App.vue
// 的 fonts.ready 门——字体未到就烘会烙成兜底字体）。
export const UI_FONT = "'WenDaoChaoHei', 'Microsoft YaHei', sans-serif";
export const UI_FONT_BODY = "'SourceHanTC', 'Microsoft YaHei', sans-serif";
