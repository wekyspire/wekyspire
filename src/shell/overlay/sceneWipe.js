// 幕间切幕器（**独立于 cutscene 内容播放器**，用户 2026-09-12 定的架构修正）。
//
// 为什么必须拆开：黑幕是"场景切换"这个动作本身的呈现，它的**目的地可以是任何东西**——
// 3D 舞台（塔楼/房间/战场）、也可以是一段 cutscene 内容（对话 + CG）。早期把黑幕画在
// CutsceneOverlay 里（与对话同一个组件、同一层），于是"切到 cutscene"实际变成了：
//   黑幕播完 → 对话层才挂上 → 内容在黑幕之后才蹦出来
// 而不是玩家要的节拍：
//   切幕开始 → （全黑中点）目的地就位 → 切幕结束（揭开的就是目的地）
// 拆开之后：本模块只提供"盖住/揭开"这一个状态机，渲染在 `SceneWipeOverlay.vue`
// （自占一层，z-index 高于内容层）；内容层（`CutsceneOverlay.vue`）只管对话/CG/渐变。
// 两者的协调在 `cutscenePlayer`：wipe step 在全黑中点调用**下一步的 preStage**，
// 让内容在黑幕之下就位（见 cutscenePlayer.compileStep 的 'wipe' 分支）。
import { reactive } from 'vue';

/** 幕间转场时长（缺省；step 可用 coverMs/revealMs 覆盖）。 */
export const SCENE_TRANSITION_MS = Object.freeze({ cover: 750, reveal: 950 });

/**
 * @returns {state, begin, toCover, reveal, end}
 *   state: reactive `{ active, phase: 'enter'|'cover'|'reveal'|null, coverMs, revealMs }`
 *   （渲染层只看 state；驱动层按 enter → cover → reveal → end 推进）
 */
export function createSceneWipe() {
  const state = reactive({
    active: false,
    phase: null,                              // enter（屏外待命）| cover（盖满）| reveal（移出左侧）
    coverMs: SCENE_TRANSITION_MS.cover,
    revealMs: SCENE_TRANSITION_MS.reveal,
  });
  return {
    state,
    /** 起幕：先以屏外姿态落位（下一帧再起过渡，否则初始 transform 不生效）。 */
    begin({ coverMs, revealMs } = {}) {
      state.coverMs = coverMs ?? SCENE_TRANSITION_MS.cover;
      state.revealMs = revealMs ?? SCENE_TRANSITION_MS.reveal;
      state.phase = 'enter';
      state.active = true;
    },
    toCover() { state.phase = 'cover'; },
    reveal() { state.phase = 'reveal'; },
    end() { state.active = false; state.phase = null; },
  };
}
