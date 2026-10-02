// 战斗动画节拍表（BattleStage 的 _dispatchAnim 域）：ANIM_* 事件 → 节拍执行器。
// 职责边界：本表只做「分发表」——逐事件的编排逻辑仍是 BattleStage 上的
// `_xxxBeat` 方法（共享舞台状态的宿主）；加新演出 = 在表里登记一行 + 宿主实现方法，
// 不再到 _dispatchAnim 的 if 链里插分支。
// handler 签名：(stage, payload, finish)——stage 即 BattleStage 宿主；任何分支
// 抛异常由 _direct 兜底强制 finish（节拍卫生，坏节拍不得冻结显示链）。

import { EventNames } from '../../bridge/events.js';

/** 单位行动姿态配方（_poseBeat 用）：squash/widen 绕脚底压扁撑宽（乘数）、lean 绕脚
 *  前倾（符号在节拍内按朝向算）、flash 为立牌染色（restoreColor 复原）、in/hold/out 三段时长。
 *  攻击姿态不在此表：它是「突进位移 + 前倾」，编排在 _damageHit 里（接触瞬间 = 命中演出）。 */
export const UNIT_POSES = Object.freeze({
  // 防御：蜷缩支撑（压扁 + 撑宽 = 沉住马步），蓝闪
  defend: { squash: 0.78, widen: 1.16, lean: 0, flash: 0x8fc3ff, inMs: 110, holdMs: 110, outMs: 190 },
  // 增强：拔地而起（拔高 + 收窄 = 气势上行），金闪
  buff: { squash: 1.18, widen: 0.94, lean: 0, flash: 0xffd34c, inMs: 130, holdMs: 90, outMs: 200 },
  // 削弱：佝偻前倾（压扁 + 微倾 = 气势受挫），紫闪；lean 朝向对方阵营（节拍内按 side 赋号）
  debuff: { squash: 0.84, widen: 1.06, lean: 0.1, flash: 0xb26ee8, inMs: 130, holdMs: 80, outMs: 190 },
});

// ---- 卡牌族 ----

function departureBeat(stage, payload, finish, type) {
  // 卡牌离场节拍（弃/焚/迁移）：播放该卡的离场飞行并阻塞本节拍——
  // 离场时序完全由 sequencer 编排（sync 节拍排在离场之后，牌库数字飞进才 +1）
  const id = payload?.card?.uniqueID ?? payload?.skill?.uniqueID ?? payload?.uniqueID ?? null;
  return stage._departureBeat(id, type, payload, finish);
}

function drawnBeat(stage, payload, finish) {
  // 入手抽牌：视觉由状态差分完成（新卡从牌库长开+跟踪飞入），这里只脉冲区域图标打节拍。
  // 因手牌上限没抽到牌（core 在载荷里分开记了 blockedByHandLimit 与 deckEmpty）：
  // 给一次明确的视觉反馈——整手牌红色脉冲 + 骑士头顶提示文字（实报）
  if (payload?.blockedByHandLimit) stage._handPressureHint();
  return stage._pulsePile('deck', finish);
}

// ---- 单位族 ----

// 治疗/护盾/效果：目标脉冲 + 对应色粒子（双色主次爆发，亮度经系统内抖动分层）；
// 治疗追加 +N 绿色文本粒子（无重力上飘）。
// 护盾/效果另接**行动姿态**（非主角行动要有身体语言）——
// 护盾 = 防御蜷缩、效果按 type 分增强拔起/削弱佝偻；治疗保持通用脉冲（治疗者姿态未定义，不硬造）。
const STATUS_FX = Object.freeze({
  [EventNames.ANIM_HEAL]:   { color: 0x66ff9e, accent: 0xd0ffe0, gravity: 18 },
  [EventNames.ANIM_SHIELD]: { color: 0x8fc3ff, accent: 0xeaf4ff, gravity: -8 },
  [EventNames.ANIM_EFFECT]: { color: 0xffd34c, accent: 0xffedb0, gravity: -6 },
});

function statusBeat(type) {
  return (stage, payload, finish) => {
    const target = stage._findAnimTarget(payload);
    if (!target) return finish();
    const fx = STATUS_FX[type];
    stage.particles.spawn(target.position.x, target.position.y, { count: 16, color: fx.color, speed: 10, ttl: 0.6, size: 1.4, gravity: fx.gravity, z: target.position.z ?? 0 });
    stage.particles.spawn(target.position.x, target.position.y, { count: 8, color: fx.accent, speed: 16, ttl: 0.45, size: 1.0, gravity: fx.gravity, z: target.position.z ?? 0 });
    if (type === EventNames.ANIM_HEAL && (payload?.healed ?? 0) > 0) {
      const p = stage._unitToUI(target, (Math.random() - 0.5) * 3, 4);
      stage.particles.spawnText(
        p.x, p.y,
        `+${payload.healed}`,
        {
          fontSize: Math.min(30 + payload.healed * 2, 72), color: '#4ade80',
          vx: (Math.random() - 0.5) * 6, vy: 14,
          gravity: 0, drag: 1.2, ttl: 1.0, scalePop: 0.4,
          space: 'ui',
        },
      );
    }
    if (type === EventNames.ANIM_SHIELD) return stage._poseBeat(target, UNIT_POSES.defend, finish);
    // 效果姿态只摆「获得/叠层」：层数衰减/扣尽（燃烧跳完 -1 等）读作消退，
    // 不配「被施加」的强姿态——回落下方通用脉冲（旧行为）
    if (type === EventNames.ANIM_EFFECT && (payload?.delta ?? 1) > 0) {
      return stage._poseBeat(target, payload?.type === 'debuff' ? UNIT_POSES.debuff : UNIT_POSES.buff, finish);
    }
    return genericPulseBeat(stage, payload, finish, target);
  };
}

/** 兜底通用脉冲：放大→平滑回程→finish（不硬切 scale）。单位带槽位 baseScale（假透视），
 *  脉冲围绕 baseScale 起伏；还在桌上的卡重回跟踪（补间回锚点，含悬浮 scale）。 */
function genericPulseBeat(stage, payload, finish, targetPre = null) {
  const target = targetPre ?? stage._findAnimTarget(payload);
  if (!target) { finish(); return; }
  const targetId = target.uniqueID;
  const bs = target._baseScale ?? 1;
  stage.animator.animate(targetId, { scale: bs * 1.15 }, {
    durationMs: 150,
    onComplete: () => {
      const zone = stage.model.getZone(targetId);
      if (zone === 'hand') {
        finish(); // 弹簧层自动收养（动画已落定回 idle），从脉冲位滑回锚点
      } else {
        stage.animator.animate(targetId, { scale: bs }, { durationMs: 120, onComplete: finish });
      }
    },
  });
}

// ---- 咏唱族 ----

function chantToggledBeat(stage, payload, finish) {
  // 咏唱双态翻转（发动点亮 / 关停·离手熄灭）：激活表达由边缘流光（状态差分）承担；
  // 独有职责 = 解除 held 停留位（卡结算后回手牌——sync 对账的 held 守卫不解禁，
  // 结算期选牌（强制换）路径卡会停在展示位，须由本专属节拍放行回扇形）。
  // 发动点亮且卡带激活能力（载荷 anim 描述符，core 按 def.activated 判定）时，
  // 先在展示位播激活演出再放行——「这张卡被点亮了」要看得见。
  const id = payload?.skill?.uniqueID ?? null;
  const release = () => {
    if (id != null && stage.model.getZone(id) === 'held' && stage._views.has(id)) {
      stage.model.setZone(id, 'hand');
      stage._entering.add(id); // 从展示位飞回扇形锚点
    }
  };
  if (payload?.on && payload?.anim) {
    return stage._chantActivateBeat(id, payload.anim, () => { release(); finish(); });
  }
  release();
  return finish();
}

function cooldownTickBeat(stage, payload, finish) {
  // 冷却推进/反向（payload.delta 带方向）：正向=绿、衰败=暗红（与 named 术语「衰败」同色）。
  // ⚠ 判据必须是「视图可见」（= 卡在手牌），不是 _views 是否命中——牌库中的卡视图保留
  // 但 visible=false，打在它上面的脉冲肉眼不可见（障：斩弃回牌库看不到冷却动画，
  // 脉冲全喂给了隐藏视图）。不可见即改在牌库图标上播；队列定序保证入库那拍
  // 紧跟 cardMoved 飞入落定之后，脉冲正好衔接飞入完成那一刻。立即 finish——non-blocking。
  const delta = payload?.delta ?? 1;
  const id = payload?.skill?.uniqueID ?? null;
  const view = id != null ? stage._views.get(id) : null;
  if (view?.visible) {
    stage._pulseCard(id, delta < 0 ? 0xc87070 : 0x66ff99);
  } else if (delta > 0) {
    stage._pulseDeckPile(0x66ff99); // 反向（衰败）只可能在手牌，无退路需求
  }
  return finish();
}

/** ANIM_* → 节拍执行器。未登记的类型走 genericPulseBeat 兜底。 */
export const ANIM_BEATS = {
  // 状态同步：显示状态在此推进（应用快照 + reconcile），立即 finish
  [EventNames.ANIM_STATE_SYNC]: (stage, payload, finish) => {
    stage._applySnapshot(payload?.snapshot);
    return finish();
  },
  [EventNames.ANIM_CARD_DISCARDED]: (stage, payload, finish) => departureBeat(stage, payload, finish, EventNames.ANIM_CARD_DISCARDED),
  [EventNames.ANIM_CARD_BURNT]: (stage, payload, finish) => departureBeat(stage, payload, finish, EventNames.ANIM_CARD_BURNT),
  [EventNames.ANIM_CARD_MOVED]: (stage, payload, finish) => departureBeat(stage, payload, finish, EventNames.ANIM_CARD_MOVED),
  [EventNames.ANIM_CARD_DRAWN]: drawnBeat,
  // 造牌入库：卡面生成 → 飞入牌库 → 计数随其后 sync 跳增（_addCardBeat）
  [EventNames.ANIM_CARD_ADDED]: (stage, payload, finish) => stage._addCardBeat(payload, finish),
  // 弃牌动作节拍（动作级）：牌堆脉冲——弃置本体由每张卡的 ANIM_CARD_DISCARDED 承担
  [EventNames.ANIM_CARDS_DUMPED]: (stage, payload, finish) => stage._pulsePile('deck', finish),
  // 结算宾语展示（转化前半）：从原位飞到中央展示位（高于发动展示位，避免叠卡）
  [EventNames.ANIM_CARD_SHOWCASE]: (stage, payload, finish) => stage._showcaseBeat(payload, finish),
  // 转化闪变（后半）：换脸 + 金色迸发 + 尺寸脉冲——宾语变化的生效反馈主体
  [EventNames.ANIM_CARD_TRANSFORMED]: (stage, payload, finish) => stage._transformBeat(payload, finish),
  [EventNames.ANIM_SKILL_USED]: (stage, payload, finish) => stage._skillDisplay(payload, finish),
  // 资源消耗/获取（魏启/AP 数字跳动）：数字由 syncState 承担；消耗粒子是纯装饰
  // 并行拍——立即 finish 不占队列。卡费消耗（skillUniqueID 归属）的爆散+汇聚
  // 已在 _skillDisplay 编排（先汇聚后发动），此处只补非卡来源的纯爆散
  [EventNames.ANIM_RESOURCE]: (stage, payload, finish) => stage._resourceBeat(payload, finish),
  [EventNames.ANIM_CHANT_TOGGLED]: chantToggledBeat,
  [EventNames.ANIM_COOLDOWN_TICK]: cooldownTickBeat,
  // 卡面反应（公共节拍）：受益/副作用发动播体系专属 shader 演出（C0 配方，
  // 见 cardBodyFx.cbfReact）+ 小放缩 —— 手牌由弹簧层收养弹回，展示位卡自己补回。
  [EventNames.ANIM_CARD_REACT]: (stage, payload, finish) => stage._cardReactBeat(payload, finish),
  // 通用剧本闸口（fx 架构）：剧本自寻址（cast/unitById），不走 target 投影
  [EventNames.ANIM_SCRIPT]: (stage, payload, finish) => stage._scriptBeat(payload, finish),
  [EventNames.ANIM_DAMAGE]: (stage, payload, finish) => {
    const target = stage._findAnimTarget(payload);
    if (target) return stage._damageHit(target, payload, finish);
    return finish();
  },
  [EventNames.ANIM_UNIT_DEATH]: (stage, payload, finish) => {
    const target = stage._findAnimTarget(payload);
    if (target) return stage._unitDeathBeat(target, payload, finish);
    return finish();
  },
  [EventNames.ANIM_UNIT_SPAWN]: (stage, payload, finish) => {
    const target = stage._findAnimTarget(payload);
    if (target) return stage._unitSpawnBeat(target, finish);
    return finish();
  },
  [EventNames.ANIM_HEAL]: statusBeat(EventNames.ANIM_HEAL),
  [EventNames.ANIM_SHIELD]: statusBeat(EventNames.ANIM_SHIELD),
  [EventNames.ANIM_EFFECT]: statusBeat(EventNames.ANIM_EFFECT),
};

/** 表 miss（未登记类型）的兜底：通用脉冲。 */
export function dispatchAnimBeat(stage, type, payload, finish) {
  const beat = ANIM_BEATS[type];
  if (beat) return beat(stage, payload, finish);
  return genericPulseBeat(stage, payload, finish);
}
