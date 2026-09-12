import { reactive } from 'vue';
import mitt from 'mitt';
import { isBossFloor } from '../../core/run/runFlow.js';
import { CUTSCENE_SCRIPTS } from './scripts.js';
import { AnimationSequencer } from '../../core/anim/sequencer.js';
import { createSceneWipe, SCENE_TRANSITION_MS } from './sceneWipe.js';

// CutscenePlayer（Shell 层）：cutscene 分步时间轴播放器。
// S3 收敛：剧本 step 编译为 sequencer 指令（默认严格串行），与战斗/房间/塔楼
// 演出共用 run 级同一时钟——跨层定序（终局动画 → 幕间黑幕 → …）无需额外协调。
// 由游戏流程手动驱动（runController 在进出战斗等节点显式调用），不自动订阅 run 事件。
//
// **切幕器与内容播放器分离**（用户定 2026-09-12 的架构修正）：
//   黑幕（wipe）不再画在本播放器的 overlay 里，而是交给独立的 `sceneWipe` 状态机 +
//   `SceneWipeOverlay.vue`（自占一层，z 压过内容层）。原因：黑幕的**目的地可以是任何东西**
//   ——3D 舞台，也可以是一段 cutscene 内容；同层时"切到 cutscene"会退化成
//   "黑幕播完 → 内容才挂上（突然蹦出来）"。
//   现在 wipe step 在**全黑中点**调用下一步的 `preStage()`（内容层在黑幕之下就位），
//   于是揭幕揭开的就是目的地本身：切幕开始 → 目的地就位 → 切幕结束。
//
// step 词汇表（可组合，可继续扩展新类型；每类 = 一种指令编译方式）：
//   { type:'fade', to:0|1, ms }        全屏颜色层渐变（to=1 渐黑 / to=0 渐亮）——定时指令
//   { type:'wipe', coverMs, revealMs, holdMs?,
//     direction?, atCover? }           幕间切幕：黑幕扫过，全黑中点执行 atCover——
//                                      atCover 可返回 Promise（战场预载）：黑幕保持到
//                                      兑现才 reveal；holdMs = 揭幕前的额外黑幕停留。
//                                      同时把**下一步的内容**就位（见上）——wipe 后面
//                                      跟的内容会被"揭开"而不是"事后蹦出"
//   { type:'image', src, fadeInMs?,
//     holdMs?, fadeOutMs? }            CG/插图：淡入 → 停留 → 淡出——定时指令
//   { type:'dialogue', pages }         对话：人工闸门指令（点击翻页，末页回执开闸）
//                                      page 可带 `choices: [{ id, label, hint?, disabled? }]`
//                                      ——该页不靠点击推进，必须 `choose(id)`（见下）
//   { type:'call', fn }                瞬时回调（换舞台/改流程状态等副作用）——自完结指令
//
// **带选项的对话**（用户定 2026-09-11：粉碎物品入口首次用上 dialogue 层）：
//   step = { type:'dialogue', pages:[{ speaker, text, choices }], onChoice?(id) }
//   · 有 choices 的页：overlay 渲染按钮，点按钮 → player.choose(id)（点背板无效）
//   · 选完 → 回执开闸（与翻页共用同一道闸门），选择同时写进 state.lastChoice
//   · 调用方 await player.play({ steps:[…] }) 后经 onChoice / 闭包变量读结果
//   · 选项内容由**调用方按可用内容动态拼**（如"没有可粉碎的卡就不给卡牌选项"）——
//     层里不做游戏判定，只负责"把选项摆出来并把人选的那个交回去"
//
// 阻塞语义：mode !== 'idle' 期间 CutsceneOverlay 全屏吸收一切交互；切幕期间由
// SceneWipeOverlay 吸收（z 更高）。阻塞流程 = 流程侧 await play()/sceneTransition()
// 后再发下一个 run intent。
export { SCENE_TRANSITION_MS };

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
 *   wipe: 幕间切幕器（`createSceneWipe()`；缺省自建——独立使用时也自洽）。
 *         宿主（runController）传共享实例，overlay 才能渲染到同一份状态。
 */
export function createCutscenePlayer({ sleep = null, sequencer = null, wipe = null } = {}) {
  const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const seq = sequencer || new AnimationSequencer({ bus: mitt(), finishedEvent: FINISH_EVENT });
  const wipeCtl = wipe ?? createSceneWipe();
  const state = reactive({
    mode: 'idle',      // idle | playing
    script: null,      // 正在播放的剧本 { id?, steps }
    step: null,        // 当前 step（overlay 据此渲染）
    pageIndex: 0,      // dialogue step 页码
    phase: null,       // 多阶段 step 的子阶段：wipe=enter|cover|reveal；image=fadeIn|hold|fadeOut
    lastChoice: null,  // 最近一次带选项对话的选择 id（调用方也可走 step.onChoice 读）
    flags: {},         // 剧情 flag 状态机（played 标记；未来分支状态扩展位）
  });
  const scripts = new Map(CUTSCENE_SCRIPTS.map(s => [s.id, s]));
  let gate = null;         // dialogue 闸门：{ id, emit }（advance 末页时回执开闸）
  let activeScripts = 0;   // 在播/在排的剧本数（mode 语义只看 cutscene 自己，与队列中
                           // 其他层指令无关——共享队列后按 pendingCount 判断会被战斗
                           // 指令卡住，mode 永不回 idle 导致 overlay 常驻阻塞交互）

  const beginStep = (script, step) => { state.script = script; state.step = step; state.phase = null; };

  // ---- step → 指令编译（时长型走 wait 分段 + 回执；dialogue 等人工闸门） ----
  // nextBox: 一个可变盒子，最终装着**下一步的编译结果**（play() 编译完才填）。
  // 只有 wipe 用它——见 'wipe' 分支的"目的地就位"。
  //
  // 每个内容类 step 都可给 `preStage()`：**在黑幕之下把这一步先摆出来**（不推进时间轴、
  // 不开闸），于是揭幕揭开的就是这一步的画面。与 start 的差异：preStage 不做"落位一帧
  // 再起过渡/开闸"这类只该发生一次的事——它是幂等的"摆好姿势"。
  function compileStep(script, step, nextBox = null) {
    switch (step.type) {
      case 'fade':
        return {
          durationMs: (step.ms ?? 0) + 2000, // 保险丝（前端不回执时兜底推进）
          preStage() { beginStep(script, step); },
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
            wipeCtl.begin({ coverMs, revealMs });   // 黑幕由独立切幕层渲染（不在本 overlay 里）
            await wait(16);         // 让屏外初始 transform 渲染一帧，再起过渡
            wipeCtl.toCover();
            await wait(coverMs);
            // ★ 全黑中点：换景/预载/目的地就位。
            //   · atCover 可返回 Promise（战场预载就绪信号）——黑幕保持到兑现才揭幕；
            //   · 下一步的内容在这里**就位**（内容层在黑幕之下渲染），于是揭幕揭开的
            //     就是目的地本身——"切幕开始 → 目的地就位 → 切幕结束"（用户定 2026-09-12）。
            //     此前 wipe 与内容同层，切到 cutscene 时只能等黑幕播完内容才蹦出来。
            await step.atCover?.();
            nextBox?.c?.preStage?.();
            if (holdMs > 0) await wait(holdMs); // 揭幕前的额外黑幕停留
            wipeCtl.reveal();
            await wait(revealMs);
            // 幕布移出屏外后留一帧余量再卸层（CSS 过渡在合成器上可能比定时器晚一拍，
            // 早卸会看到黑幕被"切断"）；这点延迟不影响任何节拍
            await wait(80);
            wipeCtl.end();
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
          // 幕后就位：以 opacity 0 落位（揭幕揭开的是黑，随后自己淡入——不会闪一下再淡出）
          preStage() { beginStep(script, step); state.phase = 'enter'; },
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
          // 幕后就位：对话框直接可读（揭幕揭开的就是这一页）。不开闸——闸门只在
          // start 时开，所以揭幕期间点它不会误翻页（gate 为 null）。
          preStage() { beginStep(script, step); state.pageIndex = 0; },
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
      // 先整表编译再链接（wipe 需要拿到"下一步"的编译结果做幕后就位）
      const boxes = script.steps.map(() => ({ c: null }));
      const compiled = script.steps.map((step, i) => compileStep(script, step, boxes[i + 1] ?? null));
      compiled.forEach((c, i) => { boxes[i].c = c; });
      for (const c of compiled) {
        if (c) seq.enqueueInstruction(c);
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
    // 带选项的页不翻页：必须点某个选项（否则会出现"点一下跳过选择"的坑）
    if (state.step.pages[state.pageIndex]?.choices?.length) return;
    if (state.pageIndex < state.step.pages.length - 1) { state.pageIndex += 1; return; }
    const g = gate;
    gate = null;
    g.emit(FINISH_EVENT, { id: g.id });
  }

  /** 选中当前页的某个选项（带 choices 的对话页专用）：回执开闸 + 记下选择。
   *  返回 false = 该选项不存在/被禁用（overlay 据此不关闸）。 */
  function choose(id) {
    if (state.step?.type !== 'dialogue' || !gate) return false;
    const page = state.step.pages[state.pageIndex];
    const opt = page?.choices?.find((c) => c.id === id);
    if (!opt || opt.disabled) return false;
    const g = gate;
    gate = null;
    state.lastChoice = id;
    state.step.onChoice?.(id);
    g.emit(FINISH_EVENT, { id: g.id });
    return true;
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

  // wipe：切幕器状态机（宿主把它交给 SceneWipeOverlay 渲染；独立使用时也在这里读到）
  return { state, play, advance, choose, sceneTransition, pendingTriggers, wipe: wipeCtl };
}
