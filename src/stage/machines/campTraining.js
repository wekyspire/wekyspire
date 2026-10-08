// 合并房陈设（营地·训练场）：篝火 / 训练桩——**没有 rig 的交互物样板**（浮标 + 拾取 + 推近）。
// 逻辑自 RoomStage 原样下沉：本模块只提供取景/面板/义务门，机器 rig 的创建交给默认（null）。
// 训练改版：训练 = 必做阶段且先于篝火——「继续前进」的硬门相应换成
// 未训练 / 尾款升级未清（可重复拦，直到清完）。篝火休整是可选收益，不设任何门。
import * as THREE from 'three';
import { buildCampPartPanel, buildTrainingPartPanel } from '../panels/index.js';

/** 取一件物的**上段**（火盆/火焰这种"脸在上半身"的物件）：从高度份额 `from` 到顶。 */
function upperSubject(entry, from = 0.35, topPad = 0.22) {
  const box = new THREE.Box3().setFromObject(entry.object);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // ⚠ 顶面留余量：火焰粒子是**场景粒子**（不在道具包围盒里），不留白会把火苗切在画外
  const topY = box.max.y + size.y * topPad;
  return new THREE.Box3(
    new THREE.Vector3(c.x - size.x / 2, box.min.y + size.y * from, c.z - size.z / 2),
    new THREE.Vector3(c.x + size.x / 2, topY, c.z + size.z / 2),
  );
}
function bowlSubject(entry) { return upperSubject(entry, 0.42); }

export function createCampTrainingMachine(ctx) {
  /** 把镜头拉到训练桩并冒一句泡泡（训练没开始 / 尾款未清时的硬门提示）。 */
  function _nudgeTraining(text) {
    const name = ctx.markers().some(m => m.name === 'training') ? 'training' : ctx.focused();
    if (name && ctx.focused() !== name) ctx.focusMachine(name);
    const entry = ctx.entryOf('training') ?? ctx.markers()[0]?.entry;
    if (!entry) return;
    ctx.bubbles().say('room:trainingHint', {
      ...ctx.midAnchorOf(entry, 1.5),
      text,
      kind: 'thought',
      duration: 2.6,
      tint: 0xe8ecfa,
    });
  }

  return {
    // 陈设型：无 rig（不设 createRig）
    kinds: ['camp', 'training'],
    // 篝火（营地·训练场的交互物）：主体 = **火盆 + 火焰**（不含三足）——整件取景时腿占了半屏，
    // 火苗顶到画外；换成"看火"，机器一般怼近一点（的交互节奏）。
    // 训练桩没有覆盖（null = 默认整件取景）。
    focusOf: (entry) => (entry.kind === 'camp'
      ? { fracH: 0.6, bottom: 0.38, pad: 0.9, subject: bowlSubject }
      : null),
    // 合并房（营地·训练场）：**点谁开谁的面板**（正）——篝火只给营地选项、
    // 训练桩只给训练选项。早期版本两件都开同一份"营地+训练"合并面板，用户报"点了没区别、
    // 交互物形同虚设"；两件东西各司其职，玩家点哪件就知道自己在处理哪半边。
    // （篝火面板在训练未收尾时显示锁定行——快照 camp.locked。）
    panel: (name, snap) => (name === 'camp' ? buildCampPartPanel(snap) : buildTrainingPartPanel(snap)),

    /**
     * 义务门贡献（null = 这段不欠事）：只剩训练两项硬拦——
     *   · 'train'          —— 训练没开始（训练必做且先于篝火）；
     *   · 'pendingUpgrade' —— 抓卡后的尾款升级。
     * 篝火休整是可选收益（2026-10-07 用户定：不再提示也不再拦，点继续直接推进）。
     */
    pendingDuty(snap) {
      if (!snap) return null;
      const t = snap.training ?? {};
      if (snap.room === 'campTraining' || snap.room === 'training') {
        if (!t.started) return 'train';
        if (t.pendingUpgrade) return 'pendingUpgrade';
      }
      return null;
    },

    /**
     * 点「继续前进」时接管：训练没开始 / 尾款未清 → 拉镜头提示（硬拦，每次都拦）；
     * 篝火没歇过 → 直接放行离房（可选收益，不是必做项）。
     */
    onContinue() {
      const snap = ctx.snap();
      if (!snap) return false;
      const t = snap.training ?? {};
      if (snap.room === 'campTraining' || snap.room === 'training') {
        if (!t.started) { _nudgeTraining('先开始训练，才能继续赶路。'); return true; }
        if (t.pendingUpgrade) { _nudgeTraining('抓到的卡还欠一次升级呢。'); return true; }
      }
      return false;
    },
  };
}
