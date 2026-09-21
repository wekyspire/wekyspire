// 浏览器调试 harness（dev 工具，不进构建产物）：**GPU 加速**的 Playwright 封装。
//
// 为什么有它（2026-09-19 定）：`tmp/play/*.mjs` 那套从 headless + swiftshader 软渲染起步，
// 每帧 ~1 秒（实测 1.9 fps），于是所有脚本都得"手动泵 tick + 限帧等待"，写出的用例既慢又
// 不像真人在玩。实测同一台机器去掉 `--use-angle=swiftshader` 后 headless 也能跑 **60 fps**
// （RTX 3090 / ANGLE-D3D11）——**慢的唯一原因就是那几行软渲染开关**。本文件把这套姿势固化：
// 真显卡、真时间流逝（演出自己会播完，不用 pump）、真鼠标点击。
//
// 用法（模块）：脚本 import 后自取所需
//   import { launch, openSave, waitRoom, clickObject, panelIds, clickPanelBtn, dbgCall, state, shot } from '../../tools/browserHarness.mjs';
//   const h = await launch();                       // 起浏览器（默认无头 + 真显卡）
//   await h.goto('?debug=1&save=t2');               // 起跑：调试模式 + 造好的存档
//   await h.waitRoom();                             // 等房间舞台就绪
//   await h.clickObject('training');                // 点 3D 交互物（世界坐标 → 屏幕）
//   await h.clickPanelBtn('train:begin');           // 点停靠面板按钮
//   await h.dbgCall('setFloor', 6);                 // 直接调调试门面（比点 UI 更省事）
//   console.log(await h.state(), await h.log());    // 后台状态 + 调试回执
//
// 用法（自检 CLI）：`node tools/browserHarness.mjs --check [--save 名] [--headed] [--fps]`
//   起一次、报帧率/WebGL 后端/存档现场，并落一张截图到 tmp/play/harness-check.png。
//
// 断言的正确姿势：一律用 `h.waitFor(() => 页面内表达式)` 等**真实条件**（演出在真实时间里
// 播放，60fps 下一次 0.6s 的切幕就是 0.6s），别再用"泵 N 帧"模拟时间。

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'play');
export const DEFAULT_URL = process.env.WEKY_URL ?? 'http://localhost:5177/';

// 只留"别把后台窗口降帧"的开关；**不要**加任何 --use-angle / --use-gl 软渲染开关
// （那会把 60fps 打到 2fps，是本文件存在的全部理由）
const ANTI_THROTTLE_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

/**
 * 起一个真显卡浏览器 + 一个页面，返回带项目专用助手的句柄。
 * @param {object} opts
 *   headless  缺省 true（无头也不影响 GPU 加速）；false = 有头窗口（要看画面时用）
 *   viewport  缺省 1280x720
 *   url       缺省 dev server 根
 *   exe       指定浏览器可执行文件（缺省 Playwright 自带的 chromium）
 */
export async function launch({ headless = true, viewport = { width: 1280, height: 720 }, url = DEFAULT_URL, exe = null } = {}) {
  const exePath = exe ?? process.env.CHROME_EXE ?? join(homedir(),
    'AppData', 'Local', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe');
  const browser = await chromium.launch({
    executablePath: exePath, headless, args: ANTI_THROTTLE_ARGS,
  });
  const page = await browser.newPage({ viewport });
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) consoleErrors.push(m.text().slice(0, 200));
  });

  /** 相对路径/查询串 → 完整 URL（`goto('?debug=1&save=t2')` 这种写法最常用）。 */
  const abs = (u) => (u.startsWith('http') ? u : `${url}${u.replace(/^\//, '')}`);
  const sleep = (ms) => page.waitForTimeout(ms);

  const helpers = {
    browser, page, errors, consoleErrors,

    async goto(u = '', { waitApp = true } = {}) {
      await page.goto(abs(u), { waitUntil: 'domcontentloaded' });
      if (waitApp) await helpers.waitApp();
    },
    /**
     * 等 App **可交互**：要么已在局内（`window.__shell` 挂上），要么开始界面已就绪
     * （美术预载门全过才渲染 StartScreen——等它就是等"资源好了"）。
     */
    waitApp: () => page.waitForFunction(
      () => !!window.__shell?.ctrl?.value || !!document.querySelector('.start-screen'),
      null, { timeout: 120000 },
    ),
    /** 等真的在局内（`window.__shell` 挂上）。 */
    waitInGame: () => page.waitForFunction(() => !!window.__shell?.ctrl?.value, null, { timeout: 60000 }),

    /**
     * 从开始界面开一局（写脚本时省掉菜单点击）：勾上调试模式 → 肉鸽模式 →（有存档则）覆盖并开始。
     * 已开局时直接返回（幂等）。
     */
    startRun: async ({ debug = true } = {}) => {
      if (await page.evaluate(() => !!window.__shell?.ctrl?.value)) return true;
      if (debug) {
        await page.evaluate(() => {
          const c = document.querySelector('#debug-checkbox');
          if (c && !c.checked) c.click();
        });
      }
      await page.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => /肉鸽模式/.test(b.textContent))?.click());
      await sleep(700);
      await page.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => /覆盖并开始/.test(b.textContent))?.click());
      await helpers.waitInGame();
      await sleep(800);
      return true;
    },

    /**
     * 等一个真实条件（页面内表达式字符串）。60fps 下演出按真实时间走完，
     * 所以这里等的是"画面/状态真的到了"，不是"我替它推进了 N 帧"。
     */
    waitFor: (expr, { timeout = 30000, poll = 100 } = {}) => page.waitForFunction(
      typeof expr === 'function' ? expr : new Function(`return (${expr});`), null, { timeout, polling: poll },
    ),
    sleep,
    waitRoom: () => helpers.waitFor(() => !!window.__shell.ctrl.value.getRoomStage?.()),
    waitBattle: () => helpers.waitFor(() => !!window.__shell.ctrl.value.getBattleStage?.()),
    waitStage: (stage) => helpers.waitFor((s) => window.__shell.ctrl.value.run.gameStage === s, []),
    /** 等幕间播完（cutscene 回 idle）。 */
    waitCutsceneEnd: () => helpers.waitFor(() => window.__shell.ctrl.value.cutscene.state.mode === 'idle'),
    /** 等全部演出队列排空（sequencer + 舞台动画都停了，画面进入静息）。 */
    waitIdleFrames: (frames = 5) => page.evaluate((n) => new Promise((resolve) => {
      let left = n;
      const tick = () => { left -= 1; if (left <= 0) resolve(true); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), frames),

    /** 页面内求值（带 `h` 句柄时最常用的口子）。 */
    eval: (fnOrExpr, arg) => page.evaluate(fnOrExpr, arg),

    /** 后台状态速览（run + 房间舞台 + 调试回执）。 */
    state: () => page.evaluate(() => {
      const c = window.__shell?.ctrl?.value;
      if (!c) return null;
      const rs = c.getRoomStage?.();
      const bs = c.getBattleStage?.();
      const r = c.run;
      return {
        stage: r.gameStage, floor: r.floor, room: r.currentRoom,
        hp: r.player.hp, maxHp: r.player.maxHp, mana: r.player.mana, money: r.player.money,
        deck: r.player.deck.length, relics: [...r.player.relics], leino: { ...r.player.leino },
        training: r.player.trainingCount, ascension: r.player.ascensionCount,
        roomData: r.roomData ? JSON.parse(JSON.stringify(r.roomData)) : null,
        roomStage: !!rs, panel: rs?._panelKind ?? null,
        panelIds: rs?._panel ? [...rs._panel._buttons.keys()] : null,
        pickerOpen: !!rs?.cardPicker?.opened,
        cutscene: c.cutscene.state.mode, battleStage: !!bs, debugMode: !!r.debugMode,
      };
    }),
    /** 调试面板的回执历史（"点了没反应"类问题的第一手证据）。 */
    log: (n = 6) => page.evaluate((k) => window.__shell?.ctrl?.value?.debug?.messages?.slice(0, k).map(m => m.text) ?? [], n),

    /** 直接调调试门面（`ctrl.debug.*`）——省掉点 UI 的绕路。 */
    dbgCall: async (method, ...args) => {
      const out = await page.evaluate(([m, a]) => {
        const d = window.__shell.ctrl.value.debug;
        if (typeof d[m] !== 'function') return `（没有这个方法：${m}）`;
        const r = d[m](...a);
        return { ret: r === undefined ? null : String(r), log: d.messages.slice(0, 3).map(x => x.text) };
      }, [method, args]);
      return out;
    },
    /** 调试面板的开关（F9 同义；面板会挡住房间点击，交互前先关掉）。 */
    togglePanel: async (open = null) => {
      const isOpen = await page.evaluate(() => !!document.querySelector('.dbg'));
      if (open === null || open !== isOpen) await page.keyboard.press('F9');
      await sleep(300);
    },

    // ---- 点击：屏幕坐标一律由页面内的 worldToScreen 算（用错相机会点空）----
    /** 世界坐标点（3D 交互物）。expr 里可用 `V`（Vector3 构造器）与 `rs`。 */
    screenOfWorld: (expr) => page.evaluate((e) => {
      const sm = window.__shell.stageManager;
      const rs = window.__shell.ctrl.value.getRoomStage?.();
      const fn = new Function('V', 'rs', `return (${e});`);
      const p = fn(sm.camera.position.constructor, rs);
      return p ? sm.worldToScreen(p.x, p.y, p.z, sm.camera) : null;
    }, expr),
    /** UI 坐标点（面板按钮/卡片/常驻按钮在 uiScene 里，相机不同）。 */
    screenOfUi: (expr) => page.evaluate((e) => {
      const sm = window.__shell.stageManager;
      const rs = window.__shell.ctrl.value.getRoomStage?.();
      const fn = new Function('V', 'rs', `return (${e});`);
      const p = fn(sm.camera.position.constructor, rs);
      return p ? sm.worldToScreen(p.x, p.y, p.z, sm.uiCamera) : null;
    }, expr),

    async clickAt(pos, { settle = 120 } = {}) {
      if (!pos) return false;
      await page.mouse.move(pos.x, pos.y);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(settle);
      return true;
    },
    /** 点房间里的 3D 交互物（按 marker 名）。 */
    clickObject: async (name, dy = 6) => helpers.clickAt(await helpers.screenOfWorld(
      `(() => { const e = rs._markers.find(m => m.name === '${name}').entry; return new V(e.x, -30 + ${dy}, e.z); })()`,
    )),
    /** 点塔楼层地图上的东西（同一套 worldToScreen，只是用 MapStage 的 marker）。 */
    clickMapObject: async (name, dy = 6) => helpers.clickAt(await page.evaluate((n) => {
      const sm = window.__shell.stageManager;
      const ms = sm._stage;
      const e = ms?._markers?.find?.(m => m.name === n)?.entry;
      if (!e) return null;
      const V = sm.camera.position.constructor;
      return sm.worldToScreen(e.x, -30 + 6, e.z, sm.camera);
    }, name)),
    /**
     * 点面板按钮（`train:begin` 这类 id）——阶段模态面板优先于 dock 操纵条：
     * 进阶期间房间的旧 dock 面板**还挂着**（内容已过时），而真正能吃点击的是盖在它上面的
     * 阶段模态面板（种子包九选三）。找错层 = 点了"看得见的旧面板"，症状与"点了没反应"一样。
     */
    clickPanelBtn: async (...ids) => {
      for (const id of ids) {
        const pos = await helpers.screenOfUi(
          `(() => { const p = rs?._stagePanel ?? rs?._panel; const b = p?._buttons?.get('${id}');`
          + ` if (!b) return null; return b.getWorldPosition(new V()); })()`,
        );
        if (pos) { await helpers.clickAt(pos); return id; }
      }
      return null;
    },
    /** 面板按钮清单 / 卡阵 pickId 清单（找不到按钮时先看这两个）。 */
    panelIds: () => page.evaluate(() => {
      const rs = window.__shell.ctrl.value.getRoomStage?.();
      const p = rs?._stagePanel ?? rs?._panel;   // 阶段模态优先：它盖在 dock 操纵条之上
      return p ? [...p._buttons.keys()] : null;
    }),
    panelCards: () => page.evaluate(() => {
      const rs = window.__shell.ctrl.value.getRoomStage?.();
      const p = rs?._stagePanel ?? rs?._panel;
      return p?._cards?.map(x => x.id) ?? null;
    }),
    /** 点面板卡阵里的第 i 张（得卡/选卡/种子包面板）。 */
    clickPanelCard: async (i) => helpers.clickAt(await helpers.screenOfUi(
      `(() => { const p = rs?._stagePanel ?? rs?._panel; const c = p?._cards?.[${i}];`
      + ` return c ? c.object.getWorldPosition(new V()) : null; })()`,
    ), { settle: 200 }),
    /** 全屏选卡界面（CardScrollPickerObject）：点第 i 张 / 点确认键。 */
    clickPickerCard: async (i) => helpers.clickAt(await helpers.screenOfUi(
      `(() => { const e = rs?.cardPicker?._entries?.[${i}]; return e ? e.obj.getWorldPosition(new V()) : null; })()`,
    ), { settle: 200 }),
    clickPickerConfirm: async () => helpers.clickAt(await page.evaluate(() => {
      const rs = window.__shell.ctrl.value.getRoomStage?.();
      const sm = window.__shell.stageManager;
      const b = [...(rs?.cardPicker?._buttons?.values() ?? [])].find(x => /确认/.test(x.data?.label ?? ''));
      if (!b) return null;
      const V = sm.camera.position.constructor;
      const w = b.getWorldPosition(new V());
      return sm.worldToScreen(w.x, w.y, w.z, sm.uiCamera);
    }), { settle: 250 }),

    /** 幕间对话/选项：真点 DOM（cutscene 是 Vue 层，不走 3D 拾取）。 */
    cutsceneChoice: async (contains = null, index = 0) => helpers.clickAt(await page.evaluate(([kw, idx]) => {
      const list = [...document.querySelectorAll('.dialogue .choices button')];
      const b = kw == null ? list[idx] : list.find(x => x.textContent.includes(kw));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, [contains, index]), { settle: 300 }),
    cutsceneAdvance: async () => helpers.clickAt(await page.evaluate(() => {
      const d = document.querySelector('.dialogue');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height * 0.8 };
    }), { settle: 300 }),
    /** 调试面板里的按钮（面板是 DOM，直接按文本点）。 */
    clickDebugButton: async (text) => {
      const ok = await page.evaluate((t) => {
        const b = [...document.querySelectorAll('.dbg button')].find(x => x.textContent.includes(t));
        if (!b) return false;
        b.click();
        return true;
      }, text);
      await sleep(250);
      return ok;
    },
    clickDebugTab: (name) => helpers.clickDebugButton(name),

    // ---- hover（tooltip 验收用：tooltip 是"悬停产物"，点不出来）----
    /** hover 一个 uiScene 对象（expr 求值出世界坐标，与 screenOfUi 同语言）。 */
    hoverUi: async (expr, { settle = 350 } = {}) => {
      const pos = await helpers.screenOfUi(expr);
      if (!pos) return null;
      await page.mouse.move(pos.x, pos.y);
      await sleep(settle);
      return pos;
    },
    /**
     * hover 面板里带热区（token）的行——遗物/效果预览行就是这么挂的
     * （prep 面板在塔楼 MapStage 上，房间机器面板在 RoomStage 上 → 一律取当前活动舞台）。
     * @param {number|string} sel 行序号，或遗物 id（如 'aronaIII'，按 token payload 匹配）
     */
    hoverPanelRow: async (sel = 0, { settle = 350 } = {}) => {
      const pos = await page.evaluate((selector) => {
        const sm = window.__shell.stageManager;
        const st = sm._stage;
        const p = st?._stagePanel ?? st?._panel;
        const rows = (p?._rows ?? []).filter(r => r.object?.userData?.token);
        const r = typeof selector === 'number'
          ? rows[selector]
          : rows.find(x => {
            const pl = x.object.userData.token.payload ?? {};
            return pl.relicId === selector || pl.cardId === selector || pl.name === selector;
          });
        if (!r) return null;
        const V = sm.camera.position.constructor;
        const w = r.object.getWorldPosition(new V);
        return sm.worldToScreen(w.x, w.y, w.z, sm.uiCamera);
      }, sel);
      if (!pos) return null;
      await page.mouse.move(pos.x, pos.y);
      await sleep(settle);
      return pos;
    },
    /**
     * 读 tooltip 的 DOM（tooltip 的唯一渲染宿主是 App.vue 的 TooltipOverlay）：
     * 按"玩家看得见的 DOM"取证——不看内部状态，因为它就是验收对象本身。
     */
    tooltipDom: () => page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.tooltip')].map(el => ({
        title: el.querySelector('b')?.textContent ?? '',
        text: el.textContent,
        isCard: el.classList.contains('is-card'),
        hasCardFace: !!el.querySelector('.tip-card'),
      }));
      // 富文本正文里的引用段（卡片/术语/效果）——纯呈现，不带热区
      const refs = [...document.querySelectorAll('.rich-ref')].map(el => el.textContent);
      return { boxes, refs };
    }),

    /** 帧率与 WebGL 后端（确诊"是不是又跑回软渲染了"）。 */
    fps: (ms = 2000) => page.evaluate((dur) => new Promise((resolve) => {
      const gl = window.__shell.stageManager?._renderer?.getContext?.();
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames += 1;
        if (performance.now() - t0 < dur) requestAnimationFrame(tick);
        else resolve({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), renderer });
      };
      requestAnimationFrame(tick);
    }), ms),

    /** 截图（落 tmp/play/<名字>.png）。 */
    shot: async (name) => {
      mkdirSync(OUT_DIR, { recursive: true });
      const file = join(OUT_DIR, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },

    /** 一次性跑完：起浏览器 → 脚本 → 关浏览器（脚本里不用管 close）。 */
    async run(fn) { try { return await fn(helpers); } finally { await browser.close(); } },
    close: () => browser.close(),
  };

  // 顶级导出也带上（脚本可 `const { page } = h` 直接用）
  return Object.assign(helpers, { sleep });
}

/** 便捷入口：起浏览器 → 打开 URL/save → 跑 fn → 关掉。 */
export async function withBrowser(opts, fn) {
  const h = await launch(opts);
  return h.run(async () => {
    if (opts?.save) await h.goto(`?debug=1&save=${opts.save}`);
    else if (opts?.path) await h.goto(opts.path);
    return fn(h);
  });
}

/** 一键：从造好的存档起跑并等房间就绪（最常用的开头两句）。 */
export async function openSave(name, opts = {}) {
  const h = await launch(opts);
  await h.goto(`?debug=1&save=${name}`);
  return h;
}

// ---------- CLI 自检：node tools/browserHarness.mjs --check [--save 名] [--headed] ----------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/browserHarness.mjs');
if (isMain) {
  const arg = (k, d = null) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? (process.argv[i + 1] ?? true) : d;
  };
  const saveName = arg('--save', null);
  const headed = process.argv.includes('--headed');
  const h = await launch({ headless: !headed });
  try {
    if (saveName) await h.goto(`?debug=1&save=${saveName}`);
    else {
      await h.goto('?debug=1');
      await h.startRun();          // 无存档时从开始界面开一局（顺带验证菜单链路）
    }
    await h.sleep(1500);
    const { fps, renderer } = await h.fps(2000);
    console.log(`帧率 ${fps} fps ｜ WebGL: ${renderer || '(未知)'}`);
    console.log('状态:', JSON.stringify(await h.state(), null, 1));
    console.log('调试回执:', JSON.stringify(await h.log(4)));
    console.log('截图:', await h.shot('harness-check'));
    if (h.errors.length || h.consoleErrors.length) {
      console.log('页面错误:', JSON.stringify([...h.errors, ...h.consoleErrors].slice(0, 5), null, 1));
    }
  } finally {
    await h.close();
  }
}
