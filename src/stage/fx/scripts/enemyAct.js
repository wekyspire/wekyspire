// 敌方行动起手剧本：core aiAct stage0 经
// presenter.playScript({ script: 'enemyAct', unit, kinds, hits }) 触发，意图快照
// （kinds/hits 标量）在此分流模板。纯攻击类不演（起手 = _damageHit 的突进编排）；
// 纯施法类给施法者一拍「进架」语言——命中侧反馈（受方姿态/粒子/护盾罩）由
// ANIM_EFFECT/ANIM_SHIELD 等既有节拍承接，本剧本只补施法者的动作侧。
// 攻击类的命中特效在 enemyHitFx.js（伤害拍）。
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../core/intentKinds.js';
import { gatherFocus, curseBolt } from './enemies/families.js';
import { playEdgeSurge } from './enemies/fxPieces.js';

// 逐敌专属起手（Boss 主题化）：defId → async ({ctx, deps, args, unit, player, kinds})。
// 返回 'generic' = 落回通配模板，其余（含 undefined）= 已消费（攻击拍静默、或
// 该拍已有别的演出语言——转段剧本/命中 beat）。注册口给 fx/scripts/bosses/
// 一文件一 Boss（内容归属原则），替代旧的 SKIP_ACT_FX 整体跳过名单。
const ENEMY_ACT_BEATS = new Map();
export function registerEnemyAct(defId, fn) { ENEMY_ACT_BEATS.set(defId, fn); }

// 施法增益式（增强自身或友军）：聚能缩配（汇流纹小号向胸口收束，buff/治疗
// 的内汇语义）；防御/召唤走低亮剪影边光一拍——结果侧已有护盾罩/召唤立起，
// 起手不抢戏。增益落点（受方 buff 扫描光带）由后续节拍承接
async function empowerCast(ctx, deps, { unit, light = false, heal = false }) {
  if (light) {
    playEdgeSurge(unit, 0x9ecbff, { durMs: 400 });
    await ctx.wait(180);
    return;
  }
  await gatherFocus({
    vein: heal ? [0.48, 0.78, 0.48] : [0.62, 0.55, 0.40],
    moteColor: heal ? 0x7ac87a : 0xd8c8a0,
    size: 9.5, motes: 4,
  })({ ctx, deps, unit });
}

export function registerEnemyActScript(registerScript) {
  registerScript('enemyAct', async ({ ctx, args, cast, particles, shake, unitById, scene, uiScene, releaseBeat }) => {
    const unit = unitById(args?.unit);
    if (!unit || unit._dead) return;
    const kinds = args?.kinds ?? [];
    const deps = { scene, uiScene, particles, cast, shake };
    // Boss 专属起手优先（内容归属：fx/scripts/bosses/ 注册）——attack 拍通常也由
    // Boss beat 自己静默吞掉（起手 = 突进 + 命中主题 beat）
    const custom = ENEMY_ACT_BEATS.get(unit._defId);
    if (custom && await custom({
      ctx, deps, args, unit, player: cast.get('role:player') ?? null, kinds, releaseBeat,
    }) !== 'generic') return;
    // 攻击族（attack/heavy/execute/fixedAttack，含攻击+buff/debuff 混合拍）：
    // 起手 = 突进，不叠加施法演出
    if (kinds.some(isAttackKind)) return;
    if (kinds.some(isDebuffKind)) {
      await curseBolt(ctx, deps, { unit, player: cast.get('role:player') ?? null });
      return;
    }
    if (kinds.some(isBuffKind) || kinds.includes('heal')) {
      await empowerCast(ctx, deps, { unit, heal: !kinds.some(isBuffKind) });
      return;
    }
    // 防御/召唤：轻量版（结果侧已有护盾罩/蜷缩姿态/召唤立起，起手只给一闪）
    if (kinds.includes('defend') || kinds.includes('summon')) {
      await empowerCast(ctx, deps, { unit, light: true });
    }
  });
}
