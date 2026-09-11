import { reactive } from 'vue';
import mitt from 'mitt';
import { isBossFloor } from '../../core/run/runFlow.js';
import { CUTSCENE_SCRIPTS } from './scripts.js';
import { AnimationSequencer } from '../../core/anim/sequencer.js';

// CutscenePlayer（Shell 层）：cutscene 分步时间轴播放器。
// S3 收敛：剧本 step 编译为 sequencer 指令（默认严格串行），与战斗/房间/塔楼
// 演出共用 run 级同一时钟——跨层定序（终局动画 → 幕间黑幕 → …）无需额外协调。
// 由游戏流程手动驱动（runController 在进出战斗等节点显式调用），不自动订阅 run 事件。
//
// step 词汇表（可组合，可继续扩展新类型；每类 = 一种指令编译方式）：
//   { type:'fade', to:0|1, ms }        全屏颜色层渐变（to=1 渐黑 / to=0 渐亮）——定时指令
//   { type:'wipe', coverMs, revealMs, holdMs?,
//     direction?, atCover? }           幕间转场：黑幕扫过，全黑中点执行 atCover——
//                                      atCover 可返回 Promise（战场预载）：黑幕保持到
//                                      兑现才 reveal；holdMs = 揭幕前的额外黑幕停留
//   { type:'image', src, fadeInMs?,
//     holdMs?, fadeOutMs? }            CG/插图：淡入 → 停留 → 淡出——定时指令
//   { type:'dialogue', pages }         对话：人工闸门指令（点击翻页，末页回执开闸）
//   { type:'call', fn }                瞬时回调（换舞台/改流程状态等副作用）——自完结指令
//
// 阻塞语义：mode !== 'idle' 期间 CutsceneOverlay 全屏吸收一切交互；
// 阻塞流程 = 流程侧 await play()/sceneTransition() 后再发下一个 run intent。
// CutsceneOverlay.vue 的 wipe 过渡时长由 step 参数驱动（缺省见 SCENE_TRANSITION_MS）。
export const SCENE_TRANSITION_MS = Object.freeze({ cover: 750, reveal: 950 });

// 完成回执协议：与 bridge 层同事件名（sequencer 构造注入的 run 级实例已用同名）
const FINISH_EVENT = 'animation-instruction-finished';

// 剧本触发规则表：供流程侧查询"此刻该播什么"（手动播放的判定依据）。
// 正式剧本按此扩展；played flag 保证每条只播一次。
// 故事模式专属：现有剧本均含剧情对话；肉鸽模式不命中任何触发（战斗内瑞米机制不受影响）。
export const CUTSCENE_TRIGGERS = Object.freeze([
  { id: 'opening', when: ({ stage, floor, storyMode = true }) => storyMode && stage === 'prep' && floor === 1 },
  { id: 'preBoss', when: ({ stage, floor, storyMode = true }) => storyMode && stage === 'prep' && isBossFloor(floor) },
  { id: 'postBoss', when: ({ stage, floor, storyMode = true }) => storyMode && stage === 'reward' && isBossFloor(floor) },
]);

/**
 * @param {object} options
 *   sleep: (ms) => Promise（测试注入；缺省 setTimeout）
 *   sequencer: run 级共享指令队列（缺省自建独立实例——单测/独立使用）
 */
export function createCutscenePlayer({ sleep = null, sequencer = null } = {}) {
  const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const seq = sequencer || new AnimationSequencer({ bus: mitt(), finishedEvent: FINISH_EVENT });
  const state = reactive({
    mode: 'idle',      // idle | playing
    script: null,      // 正在播放的剧本 { id?, steps }
    step: null,        // 当前 step（overlay 据此渲染）
    pageIndex: 0,      // dialogue step 页码
    phase: null,       // 多阶段 step 的子阶段：wipe=enter|cover|reveal；image=fadeIn|hold|fadeOut
    flags: {},         // 剧情 flag 状态机（played 标记；未来分支状态扩展位）
  });
  const scripts = new Map(CUTSCENE_SCRIPTS.map(s => [s.id, s]));
  let gate = null;         // dialogue 闸门：{ id, emit }（advance 末页时回执开闸）
  let activeScripts = 0;   // 在播/在排的剧本数（mode 语义只看 cutscene 自己，与队列中
                           // 其他层指令无关——共享队列后按 pendingCount 判断会被战斗
                           // 指令卡住，mode 永不回 idle 导致 overlay 常驻阻塞交互）

  const beginStep = (script, step) => { state.script = script; state.step = step; state.phase = null; };

  // ---- step → 指令编译（时长型走 wait 分段 + 回执；dialogue 等人工闸门） ----
  function compileStep(script, step) {
    switch (step.type) {
      case 'fade':
        return {
          durationMs: (step.ms ?? 0) + 2000, // 保险丝（前端不回执时兜底推进）
          async start({ id, emit }) {
            beginStep(script, step);
            await wait(step.ms ?? 0);
            emit(FINISH_EVENT, { id });
          },
        };
      case 'wipe': {
        const coverMs = step.coverMs ?? SCENE_TRANSITION_MS.cover;
        const revealMs = step.revealMs ?? SCENE_TRANSITION_MS.reveal;
        const holdMs = step.holdMs ?? 0;
        return {
          // 保险丝覆盖预载等待（atCover Promise 最长约 6s 兜底）+ 揭幕
          durationMs: coverMs + revealMs + holdMs + 8000,
          async start({ id, emit }) {
            beginStep(script, step);
            state.phase = 'enter';  // 黑幕屏外待命（无过渡，先落位）
            await wait(16);         // 让初始 transform 渲染一帧，再起过渡
            state.phase = 'cover';
            await wait(coverMs);
            // 全黑中点：换景/预载。atCover 可返回 Promise（战场预载就绪信号）——
            // 黑幕保持到兑现才揭幕，避免单位"加载后才显示"的突兀感
            await step.atCover?.();
            if (holdMs > 0) await wait(holdMs); // 揭幕前的额外黑幕停留
            state.phase = 'reveal';
            await wait(revealMs);
            emit(FINISH_EVENT, { id });
          },
        };
      }
      case 'image': {
        const fadeInMs = step.fadeInMs ?? 400;
        const holdMs = step.holdMs ?? 1200;
        const fadeOutMs = step.fadeOutMs ?? 400;
        return {
          durationMs: fadeInMs + holdMs + fadeOutMs + 2000,
          async start({ id, emit }) {
            beginStep(script, step);
            state.phase = 'enter';  // 先以 opacity 0 落位一帧，再起淡入过渡
            await wait(16);
            state.phase = 'fadeIn';
            await wait(fadeInMs);
            state.phase = 'hold';
            await wait(holdMs);
            state.phase = 'fadeOut';
            await wait(fadeOutMs);
            emit(FINISH_EVENT, { id });
          },
        };
      }
      case 'dialogue':
        return {
          durationMs: Infinity, // 人工闸门：只由点击推进，无超时强杀
          start({ id, emit }) {
            beginStep(script, step);
            state.pageIndex = 0;
            gate = { id, emit };
          },
        };
      case 'call':
        return {
          durationMs: 0,
          start({ id, emit }) {
            step.fn?.();
            emit(FINISH_EVENT, { id }); // 瞬时副作用即回执（同步泵起下一步）
          },
        };
      default:
        return null; // 未知 step 类型静默跳过（前向兼容：先写剧本、后补执行器也不崩）
    }
  }

  /** 手动播放一条剧本（id 或内联 { steps }；幂等：已播过直接 resolve）。返回 Promise，播完 resolve。 */
  function play(scriptOrId) {
    const id = typeof scriptOrId === 'string' ? scriptOrId : null;
    if (id && state.flags[`played:${id}`]) return Promise.resolve();
    if (id) state.flags[`played:${id}`] = true;
    const script = id ? scripts.get(scriptOrId) : scriptOrId;
    if (!script) return Promise.resolve(); // 未知剧本 id：静默 resolve

    if (state.mode === 'idle') state.mode = 'playing';
    activeScripts += 1;
    return new Promise(resolve => {
      for (const step of script.steps) {
        const compiled = compileStep(script, step);
        if (compiled) seq.enqueueInstruction(compiled);
      }
      // 尾闸：剧本收尾——resolve + 最后一个剧本结束才回 idle（自完结，同步泵起后续指令）
      seq.enqueueInstruction({
        meta: { event: 'cutscene:script-end', scriptId: script.id ?? null },
        durationMs: 0,
        start: ({ id: tailId }) => {
          seq.finish(tailId); // 自完结：同步泵起后续剧本指令（若有）
          activeScripts -= 1;
          // 回 idle 的清理推迟到微任务：advance() 调用栈内 state.step 仍可同步读
          // （翻页循环的读取契约）；期间又有新剧本 play() 则不清（activeScripts > 0）
          Promise.resolve().then(() => {
            if (activeScripts === 0 && state.mode !== 'idle') {
              state.mode = 'idle';
              state.script = null;
              state.step = null;
              state.phase = null;
            }
          });
          resolve();
        },
      });
    });
  }

  /** 对话翻页；末页 → 回执开闸推进时间轴下一步 */
  function advance() {
    if (state.step?.type !== 'dialogue' || !gate) return;
    if (state.pageIndex < state.step.pages.length - 1) { state.pageIndex += 1; return; }
    const g = gate;
    gate = null;
    g.emit(FINISH_EVENT, { id: g.id });
  }

  let transitionBusy = false;
  /** 便捷入口：标准幕间转场（wipe step），swap 在全黑中点执行。返回 Promise，reveal 结束 resolve。
   *  转场重叠时退化为直切（不卡流程、不排二次黑幕）。 */
  function sceneTransition(swap = null, { coverMs, revealMs, holdMs } = {}) {
    if (transitionBusy) { swap?.(); return Promise.resolve(); }
    transitionBusy = true;
    return play({
      id: '__transition__', // 内联剧本，不入触发规则；played flag 不拦匿名转场
      steps: [{ type: 'wipe', atCover: swap ?? undefined, ...(coverMs != null ? { coverMs } : {}), ...(revealMs != null ? { revealMs } : {}), ...(holdMs != null ? { holdMs } : {}) }],
    }).finally(() => { transitionBusy = false; });
  }

  /** 触发规则查询：返回命中且未播过的剧本 id 列表（流程侧手动 play 的依据）。 */
  function pendingTriggers(ctx) {
    return CUTSCENE_TRIGGERS
      .filter(t => t.when(ctx) && !state.flags[`played:${t.id}`])
      .map(t => t.id);
  }

  return { state, play, advance, sceneTransition, pendingTriggers };
}
