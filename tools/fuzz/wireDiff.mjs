// wire 流比对（P0 防回归基建）：比对 wireFuzz 录制的两份指令流（重构前后 A/B）。
//
// 用法：node tools/fuzz/wireDiff.mjs tmp/wire/before.json tmp/wire/after.json [--verbose]
//
// 比对口径：按局（seed 对齐）逐条比 (event, payload)——payload 深比较（JSON 规范化）。
// meta（日期等）不比。默认只报前 5 处差异与汇总；--verbose 报 20 处。
// 退出码：一致 0；有差异 / 局数不齐 1。

import { readFileSync } from 'node:fs';

const [, , fileA, fileB, ...rest] = process.argv;
const VERBOSE = rest.includes('--verbose');
if (!fileA || !fileB) {
  console.error('用法：node tools/fuzz/wireDiff.mjs <before.json> <after.json> [--verbose]');
  process.exit(1);
}

const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const A = load(fileA).streams;
const B = load(fileB).streams;

let diffs = 0;
const show = (limit) => diffs <= limit;
const report = (msg) => { if (show(VERBOSE ? 20 : 5)) console.error(`  差异#${diffs}：${msg}`); };

if (A.length !== B.length) {
  console.error(`局数不齐：${fileA} ${A.length} 局 vs ${fileB} ${B.length} 局`);
  process.exit(1);
}

for (let g = 0; g < A.length; g++) {
  const a = A[g], b = B[g];
  if (a.seed !== b.seed) { diffs++; report(`局 #${g} seed 不匹配（${a.seed} vs ${b.seed}）`); continue; }
  if (a.result !== b.result) { diffs++; report(`局 #${g}（seed=${a.seed}）终局 ${a.result} → ${b.result}`); }
  const n = Math.max(a.records.length, b.records.length);
  for (let i = 0; i < n; i++) {
    const ra = a.records[i], rb = b.records[i];
    if (!ra || !rb) { diffs++; report(`局 #${g} 第 ${i} 条：${ra ? 'after 缺失' : 'before 缺失'}（${(ra ?? rb).event}）`); continue; }
    if (ra.event !== rb.event) {
      diffs++; report(`局 #${g} 第 ${i} 条事件改名：${ra.event} → ${rb.event}`);
      continue;
    }
    const pa = JSON.stringify(ra.payload ?? null);
    const pb = JSON.stringify(rb.payload ?? null);
    if (pa !== pb) {
      diffs++;
      // 定位第一个分叉字段，报告短摘要
      let key = '?';
      try {
        const oa = ra.payload ?? {}, ob = rb.payload ?? {};
        key = Object.keys(oa).find((k) => JSON.stringify(oa[k]) !== JSON.stringify(ob[k])) ?? '?';
      } catch { /* 非 JSON 形状 */ }
      report(`局 #${g} 第 ${i} 条 ${ra.event} 载荷字段「${key}」分叉`
        + `${VERBOSE ? `\n    before=${pa.slice(0, 200)}\n    after =${pb.slice(0, 200)}` : ''}`);
    }
  }
}

const totalA = A.reduce((n, g) => n + g.records.length, 0);
const totalB = B.reduce((n, g) => n + g.records.length, 0);
console.log(`wireDiff：${A.length} 局，before ${totalA} 条 / after ${totalB} 条指令，差异 ${diffs} 处`);
if (diffs > 0) {
  console.error('结果：FAIL——重构改变了指令流（确认有意则重新录制基线）');
  process.exit(1);
}
console.log('结果：PASS（指令流等价）');
