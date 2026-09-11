import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import mitt from 'mitt';
import AnimationSequencer from '../src/core/anim/sequencer.js';
import {
  createCutscenePlayer, SCENE_TRANSITION_MS,
} from '../src/shell/overlay/cutscenePlayer.js';
import { CUTSCENE_SCRIPTS } from '../src/shell/overlay/scripts.js';

// CutscenePlayer：cutscene 分步时间轴播放器（游戏流程手动驱动）。
// step 词汇表：fade / wipe / image / dialogue / call。

describe('剧本数据与触发规则契约', () => {
  it('剧本 = steps 时间轴；dialogue step 页含 speaker/text', () => {
    const ids = CUTSCENE_SCRIPTS.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['opening', 'preBoss', 'postBoss']));
    for (const s of CUTSCENE_SCRIPTS) {
      expect(Array.isArray(s.steps)).toBe(true);
      expect(s.steps.length).toBeGreaterThan(0);
      for (const step of s.steps) {
        expect(typeof step.type).toBe('string');
        if (step.type === 'dialogue') {
          expect(step.pages.length).toBeGreaterThan(0);
          for (const p of step.pages) {
            expect(typeof p.speaker).toBe('string');
            expect(typeof p.text).toBe('string');
          }
        }
      }
    }
  });

  it('触发规则：opening=prep第1层、preBoss=prep Boss层、postBoss=reward Boss层', () => {
    const p = createCutscenePlayer();
    expect(p.pendingTriggers({ stage: 'prep', floor: 1 })).toEqual(['opening']);
    expect(p.pendingTriggers({ stage: 'prep', floor: 11 })).toEqual(['preBoss']);
    expect(p.pendingTriggers({ stage: 'reward', floor: 11 })).toEqual(['postBoss']);
    expect(p.pendingTriggers({ stage: 'battle', floor: 11 })).toEqual([]);
    expect(p.pendingTriggers({ stage: 'prep', floor: 2 })).toEqual([]);
  });

  it('无限模式（storyMode: false）：剧情剧本一律不命中', () => {
    const p = createCutscenePlayer();
    expect(p.pendingTriggers({ stage: 'prep', floor: 1, storyMode: false })).toEqual([]);
    expect(p.pendingTriggers({ stage: 'prep', floor: 11, storyMode: false })).toEqual([]);
    expect(p.pendingTriggers({ stage: 'reward', floor: 11, storyMode: false })).toEqual([]);
  });

  it('缺省转场总时长 ≤ 2s（加大幕间预算：盖屏 750 + 揭幕 950）', () => {
    expect(SCENE_TRANSITION_MS.cover + SCENE_TRANSITION_MS.reveal).toBeLessThanOrEqual(2000);
    expect(SCENE_TRANSITION_MS.cover).toBeGreaterThanOrEqual(700);
    expect(SCENE_TRANSITION_MS.reveal).toBeGreaterThanOrEqual(900);
  });
});

// 微任务冲刷：时间轴推进靠 async 链，刷足轮次后状态必然落定
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe('dialogue step：手动播放 + 翻页 + played flag + 队列', () => {
  it('手动 play 才播放；翻完 resolve；同条只播一次', async () => {
    const p = createCutscenePlayer();
    expect(p.state.mode).toBe('idle'); // 无自动触发

    const done = p.play('opening');
    expect(p.state.mode).toBe('playing');
    expect(p.state.step.type).toBe('dialogue');
    const pages = CUTSCENE_SCRIPTS.find(s => s.id === 'opening').steps[0].pages;
    for (let i = 0; i < pages.length; i++) {
      expect(p.state.pageIndex).toBe(i);
      p.advance();
    }
    await done; // 末页 advance 后时间轴推进至结尾，Promise resolve
    expect(p.state.mode).toBe('idle');

    // played flag：重播直接 resolve，不切 mode
    await p.play('opening');
    expect(p.state.mode).toBe('idle');
    // 不存在的剧本 id：静默 resolve
    await p.play('nonexistent');
  });

  it('队列续播：先 play 两条，依次播完才全部 resolve', async () => {
    const p = createCutscenePlayer();
    const d1 = p.play('preBoss');
    const d2 = p.play('postBoss');
    expect(p.state.step.type).toBe('dialogue');
    let r1 = false, r2 = false;
    d1.then(() => { r1 = true; });
    d2.then(() => { r2 = true; });

    // 翻完第一条（末页 advance 开闸）→ 冲刷后自动续播第二条
    for (let i = 0; i < p.state.step.pages.length; i++) p.advance();
    await flush();
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(p.state.step.pages[0].text).toContain('塔在上层'); // 已在 postBoss

    for (let i = 0; i < p.state.step.pages.length; i++) p.advance();
    await Promise.all([d1, d2]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(p.state.mode).toBe('idle');
  });
});

describe('多段时间轴：fade → image → dialogue → call 组合编排', () => {
  it('按 steps 顺序执行：时长型自动推进、dialogue 等点击、call 执行回调', async () => {
    const timeline = [];
    const p = createCutscenePlayer({
      sleep: (ms) => {
        const s = p.state.step;
        timeline.push(`${s.type}@${p.state.phase ?? '-'}:${ms}`);
        return Promise.resolve();
      },
    });
    let called = false;
    const done = p.play({
      id: 'demo',
      steps: [
        { type: 'fade', to: 1, ms: 300 },
        { type: 'image', src: 'cg1.png', fadeInMs: 100, holdMs: 200, fadeOutMs: 150 },
        { type: 'dialogue', pages: [{ speaker: 'remi', text: '看这里' }] },
        { type: 'call', fn: () => { called = true; } },
        { type: 'fade', to: 0, ms: 300 },
      ],
    });

    // 时长型 step 自动推进，直到 dialogue step 阻塞等点击（此时 timeline 已含全部前段）
    while (p.state.step?.type !== 'dialogue') await Promise.resolve();
    expect(timeline[0]).toBe('fade@-:300');
    expect(timeline.slice(1, 5)).toEqual([
      'image@enter:16', 'image@fadeIn:100', 'image@hold:200', 'image@fadeOut:150',
    ]);

    // dialogue step：阻塞等待点击
    expect(p.state.mode).toBe('playing');
    p.advance(); // 唯一页 → 开闸推进
    await done;
    expect(called).toBe(true);           // call step 已执行
    expect(timeline.at(-1)).toBe('fade@-:300');
    expect(p.state.mode).toBe('idle');
  });

  it('未知 step 类型静默跳过，不中断时间轴', async () => {
    const p = createCutscenePlayer({ sleep: () => Promise.resolve() });
    let reached = false;
    await p.play({
      id: 'forward',
      steps: [
        { type: 'futureType', foo: 1 },
        { type: 'call', fn: () => { reached = true; } },
      ],
    });
    expect(reached).toBe(true);
    expect(p.state.mode).toBe('idle');
  });
});

describe('wipe（幕间转场）：时间轴与阻塞', () => {
  it('时间轴：enter → cover（时长后）→ 全黑中点 atCover → reveal → idle', async () => {
    const timeline = [];
    const p = createCutscenePlayer({
      sleep: (ms) => { timeline.push(`sleep:${ms}@${p.state.phase}`); return Promise.resolve(); },
    });
    let swappedAt = null;
    await p.sceneTransition(() => { swappedAt = p.state.phase; });

    // 一帧落位 → cover 段 → atCover → reveal 段
    expect(timeline[0]).toBe('sleep:16@enter');
    expect(timeline[1]).toBe(`sleep:${SCENE_TRANSITION_MS.cover}@cover`);
    expect(timeline[2]).toBe(`sleep:${SCENE_TRANSITION_MS.reveal}@reveal`);
    expect(swappedAt).toBe('cover'); // 换景发生在全黑段（cover 结束时刻）
    expect(p.state.mode).toBe('idle');
    expect(p.state.phase).toBe(null);
  });

  it('无 swap 也可安全播放；转场重叠时退化为直切', async () => {
    const p = createCutscenePlayer({ sleep: () => new Promise(() => {}) }); // 永不结束的转场
    let direct = false;
    const first = p.sceneTransition(); // 挂起在 enter 段
    await Promise.resolve();
    await p.sceneTransition(() => { direct = true; }); // 重叠 → 直切 swap
    expect(direct).toBe(true);
    expect(p.state.phase).toBe('enter'); // 首次转场仍在进行
    void first;
  });

  it('共享队列上的外来指令不阻塞 mode 回 idle（回归：战斗入场后 overlay 常驻挡交互）', async () => {
    const bus = mitt();
    const seq = new AnimationSequencer({ bus });
    const p = createCutscenePlayer({ sleep: () => Promise.resolve(), sequencer: seq });
    // 复现战斗入场链：转场播放中（atCover 中点），bridge.start() 向共享队列入队
    // 一条尚未回执的外来指令（battleStart 的 state-sync）
    const done = p.sceneTransition(() => {
      seq.enqueueInstruction({ meta: { event: 'anim:state-sync' }, durationMs: 60000, start: () => {} });
    });
    await done;
    await new Promise(r => setTimeout(r, 10)); // 让尾闸的微任务清理落定
    expect(p.state.mode).toBe('idle');  // 修复前：外来指令 pending → mode 卡 'playing'
    expect(p.state.step).toBeNull();    // overlay 随之卸载，不再挡卡牌交互
    expect(seq.pendingCount).toBe(1);   // 外来指令仍在队列，各层互不干扰
    seq.cancelAll();
  });

  it('wipe 作为剧本内嵌 step：可与 fade/image/dialogue 组合成复杂 cutscene', async () => {
    const timeline = [];
    const p = createCutscenePlayer({
      sleep: (ms) => { timeline.push(`${p.state.step.type}@${p.state.phase}:${ms}`); return Promise.resolve(); },
    });
    let swapped = false;
    await p.play({
      id: 'composite',
      steps: [
        { type: 'fade', to: 1, ms: 200 },          // smooth in
        { type: 'image', src: 'cg1.png', fadeInMs: 50, holdMs: 60, fadeOutMs: 50 }, // image fade in
        { type: 'image', src: 'cg2.png', fadeInMs: 50, holdMs: 60, fadeOutMs: 50 }, // image transition
        { type: 'wipe', coverMs: 100, revealMs: 100, atCover: () => { swapped = true; } },
        { type: 'fade', to: 0, ms: 200 },          // smooth out
      ],
    });
    expect(swapped).toBe(true);
    const types = timeline.map(t => t.split('@')[0]);
    expect(types).toEqual([
      'fade',
      'image', 'image', 'image', 'image',
      'image', 'image', 'image', 'image',
      'wipe', 'wipe', 'wipe',
      'fade',
    ]);
    expect(p.state.mode).toBe('idle');
  });

  it('atCover 返回 Promise（战场预载）：黑幕保持到兑现才 reveal；holdMs 追加停留', async () => {
    const timeline = [];
    const p = createCutscenePlayer({
      sleep: (ms) => { timeline.push(`sleep:${ms}@${p.state.phase}`); return Promise.resolve(); },
    });
    let resolvePreload = null;
    const preloadDone = new Promise(r => { resolvePreload = r; });
    let revealedBeforeResolve = null;

    const transition = p.sceneTransition(
      () => preloadDone, // 黑幕中点：建场并返回 whenReady 信号
      { holdMs: 120 },
    );
    // 微任务推进到 atCover 之后：reveal 尚未开始（黑幕等待预载）
    await flush(8);
    revealedBeforeResolve = p.state.phase;
    expect(revealedBeforeResolve).toBe('cover'); // 预载未兑现：仍处全黑段

    resolvePreload(); // 预载完成
    await transition;
    expect(p.state.phase).toBe(null);
    // holdMs 生效：atCover 兑现后先追加黑幕停留再 reveal
    expect(timeline).toContain('sleep:120@cover');
    expect(p.state.mode).toBe('idle');
  });
});
