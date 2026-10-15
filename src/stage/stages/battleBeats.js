// 战斗动画节拍表（BattleStage 的 _dispatchAnim 域）：ANIM_* 事件 → 节拍执行器。
// 职责边界：本表只做「分发表」——逐事件的编排逻辑仍是 BattleStage 上的
// `_xxxBeat` 方法（共享舞台状态的宿主）；加新演出 = 在表里登记一行 + 宿主实现方法，
// 不再到 _dispatchAnim 的 if 链里插分支。
// handler 签名：(stage, payload, finish)——stage 即 BattleStage 宿主；任何分支
// 抛异常由 _direct 兜底强制 finish（节拍卫生，坏节拍不得冻结显示链）。

import { EventNames } from '../../bridge/events.js';
import { getSkillDefinition } from '../../core/skills/registry.js';
import { cardTheme } from '../richtext/appearance.js';
import { glowTexture } from '../fx/orbs.js';
import { playGainSweep, playShieldRings } from '../fx/gainFx.js';

/** 「获得」反馈配色（与意图条图标同语言：强化绿 / 削弱紫 / 护盾蓝） */
const GAIN_COLORS = Object.freeze({ buff: 0x5ecb6e, debuff: 0xb26ee8 });

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
  // 给一次明确的视觉反馈——整手牌红色脉冲 + 骑士头顶提示文字
  if (payload?.blockedByHandLimit) stage._handPressureHint();
  return stage._pulsePile('deck', finish);
}

// ---- 单位族 ----

// 治疗：目标脉冲 + 绿色主次爆发（治疗不在「获得反馈重做」三件内，维持原样）
// + 恢复量的绿色文本粒子（无重力上飘）。
// 护盾/效果 = 「获得」反馈三件（fx/gainFx.js）：结构化光取代旧的整面染色+放缩——
// 护盾 → 脚下双环扩散（罩体凝实脉冲由 shieldDome 差分自播）；效果 → 剪影扫描光带
// （增益上行/减益下行）。节拍只短阻塞（90~110ms）让光起读，余段后台播完。
function statusBeat(type) {
  return (stage, payload, finish) => {
    const target = stage._findAnimTarget(payload);
    if (!target) return finish();
    if (type === EventNames.ANIM_HEAL) {
      stage.particles.spawn(target.position.x, target.position.y, { count: 16, color: 0x66ff9e, speed: 10, ttl: 0.6, size: 1.4, gravity: 18, z: target.position.z ?? 0 });
      stage.particles.spawn(target.position.x, target.position.y, { count: 8, color: 0xd0ffe0, speed: 16, ttl: 0.45, size: 1.0, gravity: 18, z: target.position.z ?? 0 });
      if ((payload?.healed ?? 0) > 0) {
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
      return genericPulseBeat(stage, payload, finish, target);
    }
    if (type === EventNames.ANIM_SHIELD) {
      playShieldRings(target);
      stage.animator.animate(target.uniqueID, {}, { delayMs: 90, onComplete: finish });
      return;
    }
    // 效果获得/叠层（delta>0）：扫描光带；衰减/扣尽读作消退——回落通用脉冲
    if ((payload?.delta ?? 1) > 0) {
      const debuff = payload?.type === 'debuff';
      playGainSweep(target, debuff ? GAIN_COLORS.debuff : GAIN_COLORS.buff, { dir: debuff ? -1 : 1 });
      stage.animator.animate(target.uniqueID, {}, { delayMs: 110, onComplete: finish });
      return;
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
  // 咏唱双态翻转（发动点亮 / 关停·离手熄灭）：激活表达由边缘流光（状态差分）承担。
  // 回手放行不归本节拍——zone 单门（model.setZone → card-zone）在 sync 对账把卡
  // 翻回 hand 时弹簧自动收养滑回扇形；解除打出（on:false 'played'）的卡随后由
  // CARD_MOVED 离场节拍接管，本节拍不碰跟踪层——在此直写 hand+_entering
  // 会与离场飞行对撞（「解除咏唱回手闪烁」的根因）。
  // 发动点亮且卡带激活能力（载荷 anim 描述符，core 按 def.activated 判定）时，
  // 在展示位播激活演出——「这张卡被点亮了」要看得见。
  const id = payload?.skill?.uniqueID ?? null;
  // 沉默熄灭（'silenced'）：被摁灭的咏唱从卡面升起一缕体系色残光，沿屏幕拉向
  // 主角（拖拽减速 + 淡出 = 被吸走收进盾里）——每张独立成拍，sequencer 串行
  // 天然排队；打出侧的骤冷起手在 silenceCast（施术拍），盾落点归 ANIM_SHIELD。
  if (!payload?.on && payload?.reason === 'silenced' && id != null) {
    const view = stage._views.get(id);
    const playerId = stage._snapshot?.player?.uniqueID;
    const player = playerId != null ? stage._units.get(playerId) : null;
    if (view?.visible && player) {
      const to = stage._unitToUI(player, 0, 2);
      const dx = to.x - view.position.x;
      const dy = to.y - view.position.y;
      const d = Math.hypot(dx, dy) || 1;
      let color = '#c3cee0';   // 淡蓝灰兜底（def 反查失败时残光仍读得出）
      try { color = cardTheme(getSkillDefinition(payload.skill?.defId)); } catch (_) { /* 兜底 */ }
      stage.particles.spawnSprite(view.position.x, view.position.y, {
        texture: glowTexture(color), width: 5, height: 5,
        vx: (dx / d) * 210, vy: (dy / d) * 210,
        gravity: 0, drag: 0.45, ttl: 0.6, fadeIn: true, space: 'ui',
      });
    }
  }
  if (payload?.on && payload?.anim) {
    return stage._chantActivateBeat(id, payload.anim, finish);
  }
  return finish();
}

function cooldownTickBeat(stage, payload, finish) {
  // 冷却推进/反向（payload.delta 带方向）：正向=绿、反向=暗红。
  // ⚠ 判据必须是「视图可见」（= 卡在手牌），不是 _views 是否命中——牌库中的卡视图保留
  // 但 visible=false，打在它上面的脉冲肉眼不可见（斩弃回牌库的卡即此情形，
  // 脉冲会全喂给隐藏视图）。不可见即改在牌库图标上播；队列定序保证入库那拍
  // 紧跟 cardMoved 飞入落定之后，脉冲正好衔接飞入完成那一刻。立即 finish——non-blocking。
  const delta = payload?.delta ?? 1;
  const id = payload?.skill?.uniqueID ?? null;
  const view = id != null ? stage._views.get(id) : null;
  if (view?.visible) {
    // 正向冷却推进 = 涌动（能量涌出）；反向衰败 = 汇聚（能量被抽走内坍）
    stage._pulseCard(id, delta < 0 ? 0xc87070 : 0x66ff99, { mode: delta < 0 ? 1 : 0, intensity: 0.9 });
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
