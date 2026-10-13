// 性能探针（dev 工具，不进构建产物）：对塔楼层（MapStage/prep）与战斗房间（BattleStage）
// 跑实验矩阵，输出 CPU/GPU 瓶颈归因报告。
//
// 用法：
//   node tools/perfProbe.mjs --scene map|battle|both [--save prof-prep] [--battle-save prof-battle]
//        [--headed] [--capped] [--measure-ms 3000]
//
// 方法论：
//   · 帧率解锁（--disable-frame-rate-limit，缺省开）跑成本——ms.mean = 真实每帧总成本，
//     不被 vsync 的 16.7ms 量化；--capped 可切回真实 vsync 口径。
//   · 分辨率阶梯（720p→2160p，DPR=1）测 GPU 斜率：帧成本随像素数线性增长 = 填充率瓶颈。
//   · CPU 节流（CDP ×2/×4）测 CPU 斜率：帧成本随节流倍数线性增长 = 主线程瓶颈。
//   · 主线程采样（CDP Profiler 0.5ms）归并 self 时间：top 函数 + 桶占比 + jsPct 占用率。
//   · 链路开关逐项测（fxPost / 月光 low / 渲染背板帽 720p）：差值 = 该链路成本。
// 报告：控制台表格 + JSON 落 tmp/perf/<scene>-<时间戳>.json + 基线截图。
import { launch } from './browserHarness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'tmp', 'perf');

const MP = { r720: 0.92, r1080: 2.07, r1440: 3.69, r2160: 8.29 }; // 16:9 视口的百万像素数
const VIEWPORTS = { r720: [1280, 720], r1080: [1920, 1080], r1440: [2560, 1440], r2160: [3840, 2160] };

function parseCli(argv) {
  const a = { scene: 'both', save: 'prof-prep', battleSave: 'prof-battle', headed: false, capped: false, measureMs: 3000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--scene') { a.scene = v; i += 1; }
    else if (k === '--save') { a.save = v; i += 1; }
    else if (k === '--battle-save') { a.battleSave = v; i += 1; }
    else if (k === '--measure-ms') { a.measureMs = Number(v); i += 1; }
    else if (k === '--headed') a.headed = true;
    else if (k === '--capped') a.capped = true;
    else throw new Error(`未知参数：${k}`);
  }
  return a;
}

async function setupMap(h, save) {
  await h.goto(`?debug=1&save=${save}`);
  await h.waitStage('prep');
  await h.togglePanel(false);
  await h.waitFor(() => {
    const ms = window.__shell.stageManager._stage;
    return ms && ms._riseTween == null;
  }, { timeout: 30000 });
  await h.sleep(2500);
}

async function setupBattle(h, save) {
  await h.goto(`?debug=1&save=${save}`);
  await h.waitStage('prep');
  await h.togglePanel(false);
  await h.eval(() => window.__shell.ctrl.value.startBattle());
  await h.waitBattle();
  await h.waitFor(() => {
    const bs = window.__shell.ctrl.value.getBattleStage();
    return bs?._snapshot?.turn?.side === 'player';
  }, { timeout: 30000 });
  await h.sleep(3000);
}

const fmt = (label, r) => '  '
  + label.padEnd(16)
  + String(r.fps).padStart(7) + ' fps'
  + `  ms ${String(r.ms.mean).padStart(7)}/${String(r.ms.p50).padStart(7)}/${String(r.ms.p95).padStart(7)}/${String(r.ms.max).padStart(8)}`
  + `  draws ${String(r.drawsPerFrame).padStart(5)}  pass ${String(r.passesPerFrame).padStart(4)}  cs ${String(r.computePerFrame).padStart(3)}`
  + `  tris ${(r.trisPerFrame / 1000).toFixed(0).padStart(5)}k  pts ${(r.pointsPerFrame / 1000).toFixed(0).padStart(4)}k`
  + `  lt ${String(r.longTasks).padStart(3)}`;

async function runMatrix(h, scene) {
  const M = args.measureMs;
  const rows = [];
  const measure = async (label) => {
    const r = await h.perf(M);
    rows.push({ label, ...r });
    console.log(fmt(label, r));
    return r;
  };

  console.log(`\n== ${scene}：主线程采样（CDP Profiler，1080p 基线）==`);
  const cpu = await h.cpuProfile(Math.max(4000, M));
  const groups = Object.entries(cpu.groups).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join('  ');
  console.log(`  主线程 JS 占用 ${cpu.jsPct}%（${cpu.jsMs.toFixed(0)}ms / ${cpu.wallMs}ms，GC ${cpu.gcMs.toFixed(0)}ms）`);
  console.log(`  桶分布：${groups}`);
  for (const t of cpu.top.slice(0, 12)) console.log(`    ${String(t.selfMs).padStart(7)}ms  ${t.fn}  (${t.loc.replace(/^.*\/(src|deps)\//, '')})`);

  console.log(`\n== ${scene}：分辨率阶梯（GPU 斜率）==`);
  for (const [label, [w, hh]] of Object.entries(VIEWPORTS)) {
    await h.page.setViewportSize({ width: w, height: hh });
    await h.sleep(700);
    await measure(label);
  }
  await h.page.setViewportSize({ width: 1920, height: 1080 });
  await h.sleep(700);

  console.log(`\n== ${scene}：CPU 节流（CPU 斜率）==`);
  await measure('base-1080p');
  for (const rate of [2, 4]) {
    await h.cpuThrottle(rate);
    await h.sleep(900);
    await measure(`cpu${rate}x-1080p`);
  }
  await h.cpuThrottle(1);
  await h.sleep(600);

  console.log(`\n== ${scene}：链路开关（1080p）==`);
  const withSettings = async (fn) => h.eval(async (src) => {
    const { settings } = await import('/src/shell/settings.js');
    const src2 = eval(src);
    return src2(settings);
  }, fn.toString());

  await withSettings((s) => { s.fxPost = false; });
  await h.sleep(700);
  await measure('fxpost-off');
  await withSettings((s) => { s.fxPost = true; });
  await h.sleep(700);

  await h.eval(() => window.__shell.stageManager.setRenderQuality('low'));
  await h.sleep(700);
  await measure('moon-low');
  await h.eval(() => window.__shell.stageManager.setRenderQuality('high'));
  await h.sleep(700);

  await h.eval(() => window.__shell.stageManager.setMaxRenderHeight(720));
  await h.sleep(700);
  await measure('rs720-1080p');
  await h.eval(() => window.__shell.stageManager.setMaxRenderHeight(Infinity));
  await h.sleep(700);

  // 末尾复测：与开头 base-1080p 对照，差值 = 实验期间场景自身的漂移（泄漏/累积）
  await measure('base-1080p-end');

  return { rows, cpu };
}

function verdict(rows, cpu) {
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  const pts = Object.keys(MP).filter((k) => by[k]).map((k) => ({ x: MP[k], y: by[k].ms.mean }));
  let slope = 0, intercept = 0;
  if (pts.length >= 2) {
    const n = pts.length;
    const sx = pts.reduce((a, p) => a + p.x, 0), sy = pts.reduce((a, p) => a + p.y, 0);
    const sxx = pts.reduce((a, p) => a + p.x * p.x, 0), sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    intercept = (sy - slope * sx) / n;
  }
  const base = by['base-1080p']?.ms.mean ?? by.r1080?.ms.mean ?? null;
  const cpu4 = by['cpu4x-1080p']?.ms.mean ?? null;
  const fx = by['fxpost-off']?.ms.mean ?? null;
  const moon = by['moon-low']?.ms.mean ?? null;
  const rs = by['rs720-1080p']?.ms.mean ?? null;
  const out = [`帧成本(1080p) ${base?.toFixed(2)}ms；GPU 斜率 ${slope.toFixed(2)}ms/Mpx（1080p 填充成本 ≈ ${(slope * MP.r1080).toFixed(2)}ms，截距 ≈ ${intercept.toFixed(2)}ms）`];
  if (cpu4 != null && base != null) out.push(`CPU 节流 ×4 → ${cpu4.toFixed(2)}ms（每 ×1 增量 ${((cpu4 - base) / 3).toFixed(2)}ms；CPU 主导份额 ≈ ${base ? (100 * (cpu4 - base) / 3 / base).toFixed(0) : '?'}%）`);
  out.push(`主线程 JS 占用 ${cpu.jsPct}%`);
  if (fx != null && base != null) out.push(`fxPost 关 → 省 ${(base - fx).toFixed(2)}ms（${(100 * (base - fx) / base).toFixed(0)}%）`);
  if (moon != null && base != null) out.push(`月光 low → 省 ${(base - moon).toFixed(2)}ms（${(100 * (base - moon) / base).toFixed(0)}%）`);
  if (rs != null && base != null) out.push(`背板 720p → 省 ${(base - rs).toFixed(2)}ms（${(100 * (base - rs) / base).toFixed(0)}%）`);
  return out;
}

const args = parseCli(process.argv.slice(2));
const t0 = Date.now();
const h = await launch({
  headless: !args.headed,
  viewport: { width: 1920, height: 1080 },
  unlockFps: !args.capped,
});
try {
  console.log(`性能探针：scene=${args.scene}  measure=${args.measureMs}ms  fps=${args.capped ? 'capped' : 'unlocked'}`);
  console.log('适配器:', JSON.stringify(await h.adapterInfo()));
  const report = {};
  if (args.scene === 'map' || args.scene === 'both') {
    await setupMap(h, args.save);
    await h.shot(`perf-map-baseline`);
    const { rows, cpu } = await runMatrix(h, 'map');
    report.map = { rows, cpu, verdict: verdict(rows, cpu) };
  }
  if (args.scene === 'battle' || args.scene === 'both') {
    await setupBattle(h, args.battleSave);
    await h.shot(`perf-battle-baseline`);
    const { rows, cpu } = await runMatrix(h, 'battle');
    report.battle = { rows, cpu, verdict: verdict(rows, cpu) };
  }
  for (const [scene, r] of Object.entries(report)) {
    console.log(`\n==== ${scene} 归因 ====`);
    for (const line of r.verdict) console.log('  ' + line);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${Object.keys(report).join('-')}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.json`);
  writeFileSync(file, JSON.stringify({ meta: { ...args, ts: new Date().toISOString() }, ...report }, null, 1));
  console.log(`\n报告落盘：${file}（总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  if (h.errors.length || h.consoleErrors.length) {
    console.log('页面错误（前 3 条）:', JSON.stringify([...h.errors, ...h.consoleErrors].slice(0, 3)));
  }
} finally {
  await h.close();
}
