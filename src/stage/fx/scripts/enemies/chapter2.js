// 章2 小怪演出内容注册（南孚宫，ENEMY_FX.md 章2 总表——一次一个动作）：
// 逐敌登记 act 起手拍（enemyAct）；命中主题/死亡覆写随所属敌人的迭代一并做。
// 已落：妖蝶振翅鳞粉（洗虚无拍）。bigSlime 沿用章1 史莱姆族语言（在
// chapter1.js 的族循环里接线，同一物种同一语言）。
import { registerEnemyAct } from '../enemyAct.js';
import { scaleDust, arriveDust, unitH } from './fxPieces.js';
import { lampPulse } from '../../spells/blocks.js';

// 妖蝶鳞粉配色与体型档：从立绘派生（墨蓝灰体色提亮为粉紫中间调——过暗色乘
// 乘子会过曝或发闷；灰粉碎斑为暖白闪点；母体紫黑系换冷紫闪点，粉带更宽更慢、
// 粗鳞加量——大蝶不能只是换色）。
const NYMPH_DUST = {
  small: { color: [0.46, 0.42, 0.64], hot: [0.890, 0.824, 0.824] },
  mother: { color: [0.38, 0.30, 0.58], hot: [0.863, 0.776, 1.0], sizeK: 1.4, ms: 760 },
};

// 妖蝶·振翅鳞粉（nymph 系洗虚无拍，章2 迭代#1）：悬停扑翼加速 → 双翅合拍
// （急收-弹开；粉在对拍气流里离体——粗鳞是翅缘甩脱的实物）→ 鳞粉锋飘向玩家
// （scaleDust：瓣团前缘 + 斑驳粉体 + 鳞闪）→ 抵达拍粉晕一蓬闪灭（虚无上身）。
function scaleDustPuff(pal) {
  const { color, hot, sizeK = 1, ms = 680 } = pal;
  return async ({ ctx, deps, unit, player }) => {
    const H = unitH(unit);
    const wing = { x: unit.position.x, y: unit.position.y + H * 0.58, z: unit.position.z ?? 0 };
    ctx.onKill(() => unit.resetPose());
    // ① 扑翼加速（悬停蓄势：扇得越快翅面的粉越松）
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'none',
      onUpdate: (t) => unit.setPose({
        squash: 1 + 0.07 * Math.sin(t * Math.PI * 11),
        widen: 1 - 0.045 * Math.sin(t * Math.PI * 11),
      }),
    });
    // ② 合拍急收（破坏帧）：对拍瞬间的气流把粉挤出翅面
    await ctx.custom(unit.uniqueID, {
      durationMs: 60, ease: 'power2.in',
      onUpdate: (t) => unit.setPose({ widen: 1 - 0.14 * t, squash: 1 + 0.05 * t }),
    });
    // 粗鳞甩脱（两翅缘脱落的大鳞片——甩脱的实物；体型档加量）+ 粉云灯（安静档）
    const flakes = Math.round(3 * sizeK);
    for (const side of [-1, 1]) {
      deps.particles?.spawn?.(wing.x + side * H * 0.32, wing.y, {
        color: 0xd8ccc8, count: flakes, speed: 3.5, size: 0.9, ttl: 0.4, gravity: -12, z: wing.z,
      });
    }
    ctx.spawn((c) => lampPulse(c, deps, {
      at: wing, color: [0.55, 0.48, 0.85], peak: 240, attackMs: 80, decayMs: 320,
    }));
    // 翅弹开与回中（与粉锋行进并行；出口姿态干净）
    const recover = (async () => {
      await ctx.custom(unit.uniqueID, {
        durationMs: 110, ease: 'power3.out',
        onUpdate: (t) => unit.setPose({ widen: 0.86 + 0.26 * t, squash: 1.05 - 0.05 * t }),
      });
      await ctx.custom(unit.uniqueID, {
        durationMs: 190, ease: 'power2.out',
        onUpdate: (t) => {
          const wob = Math.sin(Math.PI * t) * (1 - t * 0.5);
          unit.setPose({ widen: 1.12 - 0.12 * t - 0.05 * wob, squash: 1 + 0.04 * wob });
        },
      });
    })();
    const to = player
      ? { x: player.position.x, y: player.position.y + unitH(player) * 0.45, z: player.position.z ?? 0 }
      : null;
    if (to) {
      const { promise, arriveU } = scaleDust(ctx, deps, {
        from: wing, to, color, hot, height: 5.5 * sizeK, ms,
      });
      // 抵达拂过方向 = 航线前向（从蝶指向玩家，屏幕面内）：粉晕整体再掠 3 单位，
      // 碎粉带斜上初速 + 正重力上飘——粉从脸前扫过的尾劲（不是原地一蓬）
      const fdx = to.x - wing.x, fdy = to.y - wing.y;
      const fl = Math.hypot(fdx, fdy) || 1;
      const fx = fdx / fl, fy = fdy / fl;
      // ③ 抵达拍：锋头过身即刻起（细粉缓落 + 粉晕涨落）——spawn 但收进主协程
      // await（fire-and-forget 会被剧本收场的 onKill 链杀掉，340ms 只剩 206ms）
      const arriveJob = ctx.spawn(async (c) => {
        await c.wait(Math.round(arriveU * ms));
        if (c.killed) return;
        deps.particles?.spawn?.(to.x, to.y + 1, {
          color: 0x9a8ea8, count: 5, speed: 1.2, size: 0.8, ttl: 0.9,
          gravity: 2, vx: fx * 1.6, vy: 1.8, z: to.z,   // 斜上：粉往脸前上方飘
        });
        await arriveDust(c, deps, {
          at: to, color, hot,
          size: (player ? unitH(player) : 20) * 1.15 * sizeK,   // 身周粉晕 ≥ 玩家身高（8 只到 1/3 读不出「沾身」）
          drift: { dx: fx * 3, dy: fy * 3 },
        });
      });
      await promise;
      await recover;
      await arriveJob.promise;
      return;
    }
    await recover;
  };
}

export function registerChapter2EnemyFx() {
  // -- 妖蝶族（鳞粉：虚无洗入；攻击/护盾/滞气走通用，后续迭代）--
  for (const id of ['nymph', 'nymphB', 'nymphC', 'nymphD']) {
    registerEnemyAct(id, async (a) => {
      if (a.kinds.includes('debuff')) return scaleDustPuff(NYMPH_DUST.small)(a);
      return 'generic';
    });
  }
  // 母体：幻象首拍与虚无洗入同为鳞粉致幻语义，共用一动作；召唤/滞气走通用
  registerEnemyAct('motherNymph', async (a) => {
    if (a.kinds.includes('debuff')) return scaleDustPuff(NYMPH_DUST.mother)(a);
    return 'generic';
  });
}
