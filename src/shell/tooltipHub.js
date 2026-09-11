// tooltipHub：tooltip 契约中枢（塔楼/房间层共享）——hover 生命周期状态机 +
// 全局唯一呈现状态。所有 token 源只发不渲：
//   3D 源（Picker）：经 tooltip:* 事件 → BattleHud 转发到本 hub；
//   DOM 源（CardFacePreview 等）：直调 show/move/hide。
// 渲染只有一份：App.vue 挂载的 TooltipOverlay 读 tooltipState。
//
// 状态机契约：同 token（kind + payload 内容相等）重复 show 只跟随指针、不重算
// 内容（DOM 源逐 mousemove 调用也天然去抖）；token 变化才重建模型；hide 后
// move 不复活浮层。内容模型由 shell/tooltip.js 的 tooltipModel 统一解析。

import { reactive } from 'vue';
import { tooltipModel } from './tooltip.js';

export const tooltipState = reactive({
  visible: false,
  x: 0,
  y: 0,
  model: null, // { title, delta?, body, tint? }（tooltipModel 产出）
});

let tokenKey = null; // 当前浮层的 token 键（null = 未显示）

const keyOf = (kind, payload) => `${kind}:${JSON.stringify(payload ?? {})}`;

// 指针右下偏移落点；浮层估算尺寸（model.size，缺省按文本浮层）越出 #game-frame 右/下缘时
// 翻到左/上侧——整卡预览（216x294）比文本摘要大得多，不翻会频繁出框
function place(x, y) {
  const est = tooltipState.model?.size ?? { w: 260, h: 120 };
  let px = x + 14;
  let py = y + 14;
  if (typeof document !== 'undefined') {
    const frame = document.getElementById('game-frame')?.getBoundingClientRect();
    if (frame) {
      if (px + est.w > frame.width) px = x - 14 - est.w;
      if (py + est.h > frame.height) py = y - 14 - est.h;
    }
  }
  tooltipState.x = px;
  tooltipState.y = py;
}

/** 悬浮命中（或同 token 移动）：x/y 为 #game-frame 局部像素（见 framePoint）。 */
export function tooltipShow(kind, payload, x, y) {
  const k = keyOf(kind, payload);
  if (k !== tokenKey) {
    tokenKey = k;
    tooltipState.model = tooltipModel(kind, payload);
    tooltipState.visible = true;
  }
  place(x, y); // 同 token：仅跟随指针，模型不重算
}

/** 悬浮移动（未显示时无操作）。 */
export function tooltipMove(x, y) {
  if (tokenKey == null) return;
  place(x, y);
}

/** 离开/隐藏。 */
export function tooltipHide() {
  tokenKey = null;
  tooltipState.visible = false;
}

/**
 * 鼠标事件 → #game-frame 局部坐标：tooltip 浮层 position:fixed 于 frame
 * （transform 包含块，16:9 信箱留边时 frame ≠ 视口），DOM 源的 clientX/Y 必须
 * 经此换算；3D 源（Picker）收到的是 canvas 内坐标，与 frame 同空间免换算。
 */
export function framePoint(e) {
  if (typeof document === 'undefined') return { x: e.clientX, y: e.clientY };
  const r = document.getElementById('game-frame')?.getBoundingClientRect()
    ?? { left: 0, top: 0 };
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
