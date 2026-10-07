// 敌方行动起手剧本（2026-10-06 五模板通配方案）：core aiAct stage0 经
// presenter.playScript({ script: 'enemyAct', unit, kinds, hits }) 触发，意图快照
// （kinds/hits 标量）在此分流模板。纯攻击类不演（起手 = _damageHit 的突进编排）；
// 纯施法类给施法者一拍「进架」语言——命中侧反馈（受方姿态/粒子/护盾罩）由
// ANIM_EFFECT/ANIM_SHIELD 等既有节拍承接，本剧本只补施法者的动作侧。
// 攻击类的命中特效在 enemyHitFx.js（伤害拍）。
import { arcProjectile, lightPillar } from '../spells/blocks.js';

// 自带 act 剧本编排的 Boss（转段 playScript 等）：通用起手会与之叠播，跳过
const SKIP_ACT_FX = new Set(['pyro', 'kardas', 'mefm1']);

// 咒击式（赋予削弱）：暗紫咒弹从施法者胸口划弧飞向玩家，抵达小爆——
// 削弱系（虚弱/中毒/塞牌）的「被下咒」读感主体，后续玩家佝偻姿态接续
async function curseShot(ctx, deps, { unit, player }) {
  const from = { x: unit.position.x, y: unit.position.y + 3.4 * (unit._baseScale ?? 1), z: unit.position.z };
  const to = player
    ? { x: player.position.x, y: player.position.y + 3.4 * (player._baseScale ?? 1), z: player.position.z }
    : null;
  await arcProjectile(ctx, deps, {
    from, to,
    color: [0.62, 0.38, 0.95], hot: [0.95, 0.80, 1.30],
    size: 1.6, ms: 420, arcH: 4.5, stretch: 1.2,
    lampIntensity: 420,
    trail: { color: 0x9a5ae0, speed: 3, size: 0.55, ttl: 0.3 },
  });
  if (to) {
    deps.particles?.spawn?.(to.x, to.y, {
      color: 0xb26ee8, count: 12, speed: 8, size: 0.7, ttl: 0.6, gravity: -4, z: to.z,
    });
  }
}

// 施法增益式（增强自身或友军）：施法者脚下金白光柱 + 上升金粒——「进架施法」，
// 增益落点（受方 buff 姿态/粒子）由后续节拍承接
async function empowerCast(ctx, deps, { unit, light = false }) {
  const at = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  await lightPillar(ctx, deps, {
    at,
    width: light ? 1.6 : 2.4, height: light ? 12 : 18, ms: light ? 400 : 650,
    color: light ? [0.75, 0.85, 1.15] : [1.0, 0.85, 0.50],
    hot: light ? [1.0, 1.1, 1.4] : [1.3, 1.15, 0.80],
  });
  deps.particles?.spawn?.(at.x, at.y + 1.5, {
    color: light ? 0x8fc3ff : 0xffd88a, count: light ? 8 : 14, speed: 4,
    size: 0.8, ttl: 0.9, gravity: -6, z: at.z,
  });
}

export function registerEnemyActScript(registerScript) {
  registerScript('enemyAct', async ({ ctx, args, cast, particles, shake, unitById, scene, uiScene }) => {
    const unit = unitById(args?.unit);
    if (!unit || unit._dead) return;
    if (SKIP_ACT_FX.has(unit._defId)) return;
    const kinds = args?.kinds ?? [];
    // 攻击类（含攻击+buff/debuff 混合拍）：起手 = 突进，不叠加施法演出
    if (kinds.includes('attack')) return;
    const deps = { scene, uiScene, particles, cast, shake };
    if (kinds.includes('debuff')) {
      await curseShot(ctx, deps, { unit, player: cast.get('role:player') ?? null });
      return;
    }
    if (kinds.includes('buff') || kinds.includes('heal')) {
      await empowerCast(ctx, deps, { unit });
      return;
    }
    // 防御/召唤：轻量版（结果侧已有护盾罩/蜷缩姿态/召唤立起，起手只给一闪）
    if (kinds.includes('defend') || kinds.includes('summon')) {
      await empowerCast(ctx, deps, { unit, light: true });
    }
  });
}
