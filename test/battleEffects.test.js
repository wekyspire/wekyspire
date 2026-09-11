import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import * as THREE from 'three';
import Player from '../src/core/state/player.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { createBridge, EventNames } from '../src/bridge/index.js';
import { StageManager } from '../src/stage/StageManager.js';
import { BattleStage } from '../src/stage/stages/BattleStage.js';

// 演出测试：发动展示幽灵卡（弹出→停留→收走）、受伤闪红震动 + 粒子爆发、
// 冷却/powerUp 的 non-blocking 牌面脉冲。

// 灌注·台：给另一张手牌 +2 威力（验证 powerUp 脉冲链路）
registerSkill({
  id: 'empowerFx', name: '灌注·台', cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    const other = sctx.battleState.zones.hand.find(c => c.uniqueID !== sctx.self.uniqueID);
    if (other) other.power += 2;
    return true;
  },
});

function manualTween() {
  const pending = [];
  const records = [];
  const apply = (obj, to) => {
    if (to.x != null) obj.position.x = to.x;
    if (to.y != null) obj.position.y = to.y;
    if (to.z != null) obj.position.z = to.z;
    if (to.scale != null) obj.scale.set(to.scale, to.scale, 1);
  };
  const tween = (obj, to, opts = {}) => {
    records.push({ obj, to });
    pending.push(() => { apply(obj, to); opts?.onComplete?.(); });
    return { kill() {} };
  };
  tween.records = records;
  tween.completeNext = () => pending.shift()?.();
  tween.completeAll = () => { while (pending.length) pending.shift()(); };
  return tween;
}

const fakeBake = () => ({ texture: new THREE.Texture(), hitRegions: [], width: 200, height: 270 });
const fakeBakeLabel = () => ({ texture: new THREE.Texture(), width: 100, height: 30 });

function make(deck = ['punch', 'punch', 'punch', 'punch']) {
  const runState = createRunState({
    player: new Player({ maxHp: 30, maxMana: 3, maxActionPoints: 3 }),
  });
  runState.player.deck = deck.map(d => createSkillRuntime(d));
  const bridge = createBridge({
    runState,
    enemies: [getEnemyDefinition('slime').createUnit()],
    seed: 1,
  });
  const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
  sm.attach({});
  sm.resize(1000, 1000);
  const tween = manualTween();
  const stage = new BattleStage({
    bridge, stageManager: sm, bakeFace: fakeBake, bakeLabel: fakeBakeLabel, tween,
  });
  return { bridge, stage, tween };
}

describe('演出', () => {
  it('发动展示：卡本体飞中央放大→停留→同一对象衔接离场飞行回牌库（无替身）', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const deckBefore = stage._piles.deck.count; // 差值断言：deck 计数含牌库原有卡

    const first = bridge.getProjection().hand[0];
    bridge.intents.playCard(first.uniqueID);

    // 展示用本体：同 uniqueID 飞向中央放大（不存在替身对象）
    expect(stage.animator.getObject('ghost:skill-used')).toBeNull();
    const display = tween.records.find(r => r.obj.uniqueID === first.uniqueID && r.to.x === 0 && r.to.y === -2 && r.to.scale === 1.15);
    expect(display).toBeTruthy();

    tween.completeAll(); // 停留 → 衔接离场弧线飞行（淡出）→ 停车
    // 全程同一视觉实体：展示对象 == 终态视图，弧线落位牌库图标
    const view = stage._views.get(first.uniqueID);
    expect(view).toBe(display.obj);
    expect(view.position.x).toBe(80);
    expect(view.position.y).toBe(-55);
    // 展示结束后不回手牌跟踪（无折返）：展示记录之后没有 hand 锚点记录
    const cardRecords = tween.records.filter(r => r.obj.uniqueID === first.uniqueID);
    const iDisplay = cardRecords.indexOf(display);
    expect(cardRecords.slice(iDisplay + 1).some(r => r.to.containerKey === 'hand')).toBe(false);
    expect(stage.animator.getObject(first.uniqueID)).toBe(display.obj); // 停车留存：注册健在
    expect(stage._piles.deck.count).toBe(deckBefore + 1); // 非消耗打出卡回牌库底
  });

  it('受伤：敌人闪红震动两段补间 + 粒子爆发，粒子寿命尽归零', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();

    const slime = bridge.battle.battleState.enemies[0];
    const first = bridge.getProjection().hand[0];
    bridge.intents.playCard(first.uniqueID);
    tween.completeAll(); // 幽灵卡三段播完 → 伤害动画启动并播完

    // 震动两段：击退 → 归位
    const shake = tween.records.filter(r => r.obj.uniqueID === slime.uniqueID && r.to.x != null);
    expect(shake.length).toBeGreaterThanOrEqual(2);
    expect(stage.particles.activeCount).toBeGreaterThan(0); // 伤害粒子已爆发
    // 伤害数字文本粒子：从受伤源迸射（受重力、出生弹跳）
    const dmgText = stage.particles._spritePool.find(p => p.text === '-6');
    expect(dmgText).toBeTruthy();
    expect(dmgText.vy).toBeGreaterThan(0);   // 向上迸射
    expect(dmgText.gravity).toBeLessThan(0); // 受重力下坠
    expect(stage.animator.getState(slime.uniqueID)).toBe('idle'); // 震动结束回 idle

    stage.particles.update(1.0); // 超过寿命
    expect(stage.particles.activeCount).toBe(0);
    expect(stage.particles.activeSpriteCount).toBe(0); // 文本粒子同样寿命尽回收
  });

  it('死亡：立牌倾倒扬尘 + 焚毁收殓（状态绘制隐藏、整体退场）', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const slime = bridge.battle.battleState.enemies[0];
    // 连续出牌打死（20 血 / 6 伤 ≈ 4 拳，牌只够 3 拳+抽牌，直接打空 AP 即可看到 death 或非 death；
    // 这里用两张牌验证不死时无灰色爆发，随后补刀验证死亡演出）
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    tween.completeAll();
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    tween.completeAll();
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    tween.completeAll();
    expect(slime.isDead()).toBe(false); // 18 伤害（AP 只够 3 拳），史莱姆 20 血，未死
    bridge.intents.endTurn(); // 敌人行动 + 新回合：AP 刷新、抽牌
    tween.completeAll();
    bridge.intents.playCard(bridge.getProjection().hand[0].uniqueID);
    tween.completeAll();
    expect(slime.isDead()).toBe(true);
    expect(stage.particles.activeCount).toBeGreaterThan(0); // 落地扬尘 + 焚毁余烬
    const unit = stage._units.get(slime.uniqueID);
    expect(unit.getObjectByName('hpBar').visible).toBe(false); // 焚毁前置：尸体不再读数
    expect(unit.visible).toBe(false); // 焚毁收殓：整体隐藏退场（manual tween 无 onUpdate，倾倒角不推进，只验终态）
  });

  it('冷却 tick：正向=绿色脉冲；立即回 finish 不占节拍；updateFx 推进回程后熄灭', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const first = bridge.getProjection().hand[0];
    const obj = stage._views.get(first.uniqueID);

    const finishes = [];
    const onFinish = p => finishes.push(p.id);
    bridge.frontendBus.on(EventNames.ANIMATION_INSTRUCTION_FINISHED, onFinish);
    stage._direct(EventNames.ANIM_COOLDOWN_TICK, { skill: { uniqueID: first.uniqueID }, delta: 1, _animId: 'cd1' });
    bridge.frontendBus.off(EventNames.ANIMATION_INSTRUCTION_FINISHED, onFinish);

    // 立即 finish（non-blocking）+ 特效层脉冲已点亮（放大态，待 updateFx 推进收回）
    expect(finishes).toEqual(['cd1']);
    expect(obj.fx.pulseVisible).toBe(true);
    expect(obj.fx.pulseColor).toBe(0x66ff99);

    obj.updateFx(0.25); // 超过脉冲时长（220ms），时间线走完即隐藏
    expect(obj.fx.pulseVisible).toBe(false);
  });

  it('冷却 tick：衰败反向（delta<0）= 暗红脉冲（与 named 术语「衰败」同色）', () => {
    const { bridge, stage, tween } = make();
    bridge.start();
    tween.completeAll();
    const first = bridge.getProjection().hand[0];
    const obj = stage._views.get(first.uniqueID);

    const finishes = [];
    const onFinish = p => finishes.push(p.id);
    bridge.frontendBus.on(EventNames.ANIMATION_INSTRUCTION_FINISHED, onFinish);
    stage._direct(EventNames.ANIM_COOLDOWN_TICK, { skill: { uniqueID: first.uniqueID }, delta: -1, _animId: 'cd2' });
    bridge.frontendBus.off(EventNames.ANIMATION_INSTRUCTION_FINISHED, onFinish);

    expect(finishes).toEqual(['cd2']); // 同样 non-blocking
    expect(obj.fx.pulseVisible).toBe(true);
    expect(obj.fx.pulseColor).toBe(0xc87070);
    obj.updateFx(0.25);
    expect(obj.fx.pulseVisible).toBe(false);
  });

  it('powerUp：威力提升的手牌触发金色脉冲（non-blocking）', () => {
    const { bridge, stage, tween } = make(['empowerFx', 'punch', 'punch', 'punch']);
    bridge.start();
    tween.completeAll();

    const empower = bridge.getProjection().hand.find(c => c.defId === 'empowerFx');
    const target = bridge.getProjection().hand.find(c => c.defId === 'punch');
    bridge.intents.playCard(empower.uniqueID);
    expect(target.uniqueID).not.toBe(empower.uniqueID);

    // 威力提升随 sync 节拍应用（状态差分驱动），金色脉冲 non-blocking
    tween.completeAll();
    const obj = stage._views.get(target.uniqueID);
    expect(obj.fx.pulseColor).toBe(0xffd34c);
    obj.updateFx(0.25); // 脉冲时间线走完即隐藏
    expect(obj.fx.pulseVisible).toBe(false);
  });
});
