// 合并房陈设（营地·训练场）：篝火 / 训练桩——**没有 rig 的交互物样板**（浮标 + 拾取 + 推近）。
// 逻辑自 RoomStage 原样下沉：本模块只提供取景/面板/义务门，机器 rig 的创建交给默认（null）。
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
  let nudged = false;   // 「还没在火边歇过」的提示只弹一次（再点继续即离房）

  /** 还没在火边歇过就想走：把镜头拉回**篝火**并给一句泡泡（训练不做无妨，不再拦）。 */
  function _nudgeCampRest() {
    const name = ctx.markers().some(m => m.name === 'camp') ? 'camp' : 'training';
    const entry = ctx.entryOf(name);
    if (entry && ctx.focused() !== name) ctx.focusMachine(name);
    else if (entry) ctx.openPanel(name);
    if (!entry) return;
    ctx.bubbles().say('room:campHint', {
      ...ctx.midAnchorOf(entry, 1.5),
      text: '还没在火边歇过呢。',
      kind: 'thought',
      duration: 2.6,
      tint: 0xffe0b0,
    });
  }

  /** 强绑抓牌未领时点「继续前进」：把镜头拉到训练桩并冒一句泡泡（"先挑卡"）——比"按钮没反应"清楚。 */
  function _nudgeForcedPick() {
    const target = ctx.markers().some(m => m.name === 'training') ? 'training' : ctx.focused();
    if (target) ctx.focusMachine(target);
    const entry = ctx.entryOf('training');
    const anchor = entry ?? ctx.markers()[0]?.entry;
    if (anchor) {
      ctx.bubbles().say('room:hint', {
        ...ctx.midAnchorOf(anchor, 1.5),
        text: '还没把挑好的卡放进牌组呢。',
        kind: 'thought',
        duration: 2.6,
        tint: 0xe8ecfa,
      });
    }
  }

  return {
    // 陈设型：无 rig（不设 createRig）
    kinds: ['camp', 'training'],
    // 篝火（营地·训练场的交互物）：主体 = **火盆 + 火焰**（不含三足）——整件取景时腿占了半屏，
    // 火苗顶到画外；换成"看火"，机器一般怼近一点（用户定 2026-09-12 的交互节奏）。
    // 训练桩没有覆盖（null = 默认整件取景）。
    focusOf: (entry) => (entry.kind === 'camp'
      ? { fracH: 0.6, bottom: 0.38, pad: 0.9, subject: bowlSubject }
      : null),
    // 合并房（营地·训练场）：**点谁开谁的面板**（用户定 2026-09-12 修正）——篝火只给营地选项、
    // 训练桩只给训练选项。早期版本两件都开同一份"营地+训练"合并面板，用户报"点了没区别、
    // 交互物形同虚设"；两件东西各司其职，玩家点哪件就知道自己在处理哪半边。
    panel: (name, snap) => (name === 'camp' ? buildCampPartPanel(snap) : buildTrainingPartPanel(snap)),

    /**
     * 义务门贡献（null = 这段不欠事）：
     *   · 'forced' —— 升级后的强绑抓牌（硬拦）；
     *   · 'camp'   —— 休整是**可选收益**（训练同理，用户定 2026-09-12），属软提示（见 onContinue）。
     */
    pendingDuty(snap) {
      if (!snap) return null;
      if (snap.training?.forced) return 'forced';                  // 升级后的强绑抓牌
      if (snap.room !== 'campTraining') return null;
      const c = snap.camp ?? {};
      if (!c.used && (c.options?.length ?? 0) > 0) return 'camp';
      return null;
    },

    /**
     * 点「继续前进」时接管：强绑抓牌未领 → 拉镜头提示；营地没歇过 → **只提示一次**再点即离房
     * （软提示而非硬拦——玩家想省下这层收益是他的自由，不能被按着头点）。
     */
    onContinue() {
      const snap = ctx.snap();
      if (snap?.training?.forced) { _nudgeForcedPick(); return true; }
      if (snap?.room === 'campTraining') {
        const c = snap.camp ?? {};
        if (!c.used && (c.options?.length ?? 0) > 0 && !nudged) { nudged = true; _nudgeCampRest(); return true; }
      }
      return false;
    },
  };
}
