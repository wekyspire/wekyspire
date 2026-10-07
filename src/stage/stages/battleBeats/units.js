// 战斗单位演出族（BattleStage 原型混入，this = BattleStage 宿主）：
// 受击/姿态/生死五件。节拍表（battleBeats.js）经 stage._xxxBeat 调用到这里；
// 方法间共享宿主状态（_units/_snapshot/particles/shake 等），this 前缀即宿主。

import * as THREE from 'three';
import { damageSeverity } from '../../objects/screenImpactFX.js';
import { slotTransform } from '../../scenes/index.js';
import { resolveDamageRecipe } from '../../fx/recipes.js';
import { resolveDamageFx, runDamageBeat } from '../../fx/spells/index.js';
import { resolveEnemyHitFx, runEnemyHitBeat } from '../../fx/spells/enemyHitFx.js';
import { trackedGate, ownedGate } from '../../fx/spells/projectileTrack.js';
import { runScript } from '../../fx/script.js';

export const unitBeats = {
  // 本函数只剩编排，参数一律读表不写魔法数）：按伤害落点分流——
  //   攻击方姿态（非主角行动要有身体反馈）：主级伤害的来源单位
  //     （敌人/盟友；主角除外——其反馈由卡牌演出承担）向目标「蓄势后拉 → 发力突进」，
  //     锋尖抵近那一帧 = 受击演出（火花/数字/震荡）起点；收势回位与受击方击退并行。
  //     附级 tick（燃烧/中毒）与环境伤害不摆（无身体语言，减法即丰富）。
  //   生命值受伤（dealt>0）：闪色 + 火花簇 + 伤害数字 + 击退（节拍阻塞，幅度随伤害缩放；
  //     盟友受击是生动版——击退 + 向后小跳几步再跳回槽位）；
  //   附级伤害（type='minor'，燃烧/中毒/荆棘 tick 等）：配方降规格——小数字、无翻红、
  //     无击退、无震荡、短节拍（减法即丰富：tick 不再每次满屏红闪）；
  //   致命击（killed）：配方加重——震荡加成 + 数字放大；
  //   护盾吸收（absorbed>0）：蓝色火花 + 灰色吸收数字（较小、偏移开）；
  //     吸穿护盾的最后一击（显示盾量 - 吸收 ≤ 0）追加破碎粒子——破碎只由伤害驱动，
  //     自然消失（回合开始清零）只是保护框随 sync 静默隐去；
  //   无生命值伤害不翻红不击退，节拍短停即收。
  // HP/盾量数字的显示状态变化在本节拍后的 sync 才应用——先演后变
  _damageHit(unit, payload, finish) {
    const dealt = payload?.dealt ?? 0;
    const absorbed = payload?.shieldAbsorbed ?? 0;
    const r = resolveDamageRecipe(payload);

    // 攻击方突进解算：来源 → 目标的方向 / 步长 / 前倾角（standee 绕脚转，符号 = 目标方向）
    const srcId = payload?.source?.uniqueID ?? null;
    const src = srcId != null ? (this._units.get(srcId) ?? null) : null;
    // 瑞米冲撞（核心陪伴角色，协战要有专属身体演出）：它的补刀在
    // core 是附级（不吃加成/不触发受击响应），通用路径因此不给突进——这里按来源特判
    // 放行，并把配方升回「有击退有撞击感」（只动演出参数，core 语义不变）。
    const remiCharge = !!src && src._defId === 'remi' && !src._dead;
    if (remiCharge) {
      r.knockback = true;
      if (r.flash == null) r.flash = 0xfff2d8; // 物理撞击的淡暖白闪（非伤害红闪）
    }
    const lunging = !!src && srcId !== this._snapshot?.player?.uniqueID
      && !src._dead && ((payload?.type ?? 'major') === 'major' || remiCharge);
    const sx = src?.position.x ?? 0;
    const sy = src?.position.y ?? 0; // 地板高度（冲锋跳弧的基准——别裸写 0，slotTransform 的 y 是地板）
    const sz = src?.position.z ?? 0;
    const ddx = unit.position.x - sx;
    const ddz = unit.position.z - sz;
    const dist = Math.hypot(ddx, ddz) || 1;
    const ux = ddx / dist;
    const uz = ddz / dist;
    const reach = Math.min(Math.max(dist * 0.42, 2.5), 8); // 步长随间距，留身位不贴脸
    const strikeLean = -Math.sign(ddx || 1) * 0.18;
    // 瑞米冲撞参数：全距离贴身（留 4.2 身位间隙防穿模）；前倾角加大（小身板大动作才读得出）
    const chargeTravel = Math.max(dist - 4.2, dist * 0.55);
    const chargeLean = -Math.sign(ddx || 1) * 0.30;

    const h = runScript(async (ctx) => {
      // 命中演出（伤害节拍驱动，2026-09-30 泛化）：伤害量/攻击来向在这里才有真值——
      // 尺寸随伤害缩放、方向语义按卡名/体系（刀光斩向、拳面镜像、火系落点爆）；
      // 多段伤害逐拍触发 = 连击/乱拳的密集命中白送。fire-and-forget
      // （_fxRunScript 舞台寿命锚）：不占本节拍时序，受击既有演出（突进/击退/闪光）照常。
      const dmgFx = dealt > 0 ? resolveDamageFx(payload?.skillDefId) : null;
      // 敌方来源回落（五模板通配）：玩家技能表查不到的 major 伤害交给敌方三式
      // （普攻撞击/连击小快/重击大冲击）——判据与配方在 enemyHitFx.js。
      // 意图 = 本次行动预告（伤害拍时点尚未刷新）：重击/连击按怪的出力口径判
      let enemyFx = null;
      if (dealt > 0 && !dmgFx) {
        const srcIntention = srcId != null
          ? (this._snapshot?.enemies ?? []).find(e => e.uniqueID === srcId)?.intention ?? null
          : null;
        enemyFx = resolveEnemyHitFx(this, payload, dealt, srcIntention);
      }
      // 投射物抵达门（CPU 权威，projectileTrack.js）：tracked = 施术拍发射的飞行
      // （火球/点火链）等真实抵达；owned = 本拍自持发射（火花乱射——runDamageBeat
      // 弹出后落定回报）。主受击拍与命中爆点共用同一承诺（双 await 同一 p，
      // 不双消费 FIFO）——「受伤」与「火花炸裂」由抵达同刻触发。
      let projSync = null;
      if (dmgFx?.proj === 'tracked') projSync = trackedGate(this._projectiles, unit);
      else if (dmgFx?.proj === 'owned') projSync = ownedGate();
      if (dmgFx) {
        this._fxRunScript((c) => runDamageBeat(c, this._spellDeps(), {
          fx: dmgFx, unit, dealt,
          fromX: src?.position.x ?? null,   // 拳面镜像：攻击来向
          projSync,
        }));
      } else if (enemyFx) {
        this._fxRunScript((c) => runEnemyHitBeat(c, this._spellDeps(), {
          fx: enemyFx, unit, dealt,
          fromX: src?.position.x ?? null,
        }));
      }
      if (projSync) await projSync.gate();   // 投射物卡：受击演出自抵达帧起
      if (lunging && remiCharge) {
        // 冲撞四拍：蹲伏蓄势 → 全距离冲刺（小跳弧+前扑）→ 撞击 → 高弹后跳+二跳回家。
        // 被打断（收拍/拆台）经 onKill 归位归零，不晾在半路上（正常结束也过这，幂等）。
        ctx.onKill(() => { src.position.x = sx; src.position.y = sy; src.position.z = sz; src.resetPose?.(); });
        // ① 蹲伏蓄势（下压 + 撑宽 + 微后仰）
        await ctx.custom(srcId, {
          durationMs: 170, ease: 'power2.out',
          onUpdate: (t) => {
            src.position.x = sx - ux * 1.2 * t;
            src.position.z = sz - uz * 1.2 * t;
            src.setPose({ squash: 1 - 0.30 * t, widen: 1 + 0.25 * t, lean: -chargeLean * 0.35 * t });
          },
        });
        // ② 冲锋（弹起拉长 → 前扑：低跳弧全距离压进）——锋尖抵近即接触，受击演出自此起
        await ctx.custom(srcId, {
          durationMs: 200, ease: 'power2.in',
          onUpdate: (t) => {
            src.position.x = sx - ux * 1.2 + ux * (chargeTravel + 1.2) * t;
            src.position.z = sz - uz * 1.2 + uz * (chargeTravel + 1.2) * t;
            src.position.y = sy + Math.sin(Math.PI * t) * 1.3;
            src.setPose({
              squash: 0.70 + 0.38 * t,          // 回弹拉长（跃起流线）
              widen: 1.25 - 0.37 * t,
              lean: -chargeLean * 0.35 + chargeLean * 1.35 * t, // 后仰 → 前扑
            });
          },
        });
        // ③ 撞击瞬间：挤进身位 + 撞扁（起手帧，命中段与④并行接上）
        src.setPose({ squash: 0.82, widen: 1.14, lean: chargeLean });
      } else if (lunging) {
        // 突进被打断（收拍/拆台）不许把攻击方晾在半路上：归位 + 姿态清零（正常结束也过这，幂等）
        ctx.onKill(() => { src.position.x = sx; src.position.z = sz; src.resetPose?.(); });
        // ① 蓄势后拉（反向微仰）
        await ctx.custom(srcId, {
          durationMs: 70, ease: 'power1.out',
          onUpdate: (t) => {
            src.position.x = sx - ux * 1.2 * t;
            src.position.z = sz - uz * 1.2 * t;
            src.setPose({ lean: -strikeLean * 0.5 * t });
          },
        });
        // ② 发力突进（前倾压进）——锋尖抵近即接触，受击演出自此起
        await ctx.custom(srcId, {
          durationMs: 95, ease: 'power2.in',
          onUpdate: (t) => {
            src.position.x = sx - ux * 1.2 + ux * (reach + 1.2) * t;
            src.position.z = sz - uz * 1.2 + uz * (reach + 1.2) * t;
            src.setPose({ lean: -strikeLean * 0.5 + strikeLean * 1.5 * t });
          },
        });
      }
      // ③ 收势回位：不起新 await 链——与受击方演出并行，末尾统一等齐
      const recover = lunging
        ? remiCharge
          ? (async () => {
            // ④ 反弹跳回：高弧后跳（被撞开的上弹感，后仰渐回）→ 低弧二跳回家
            const cx = sx + ux * chargeTravel, cz = sz + uz * chargeTravel;
            const mx = sx + ux * chargeTravel * 0.45, mz = sz + uz * chargeTravel * 0.45;
            await ctx.custom(srcId, {
              durationMs: 200, ease: 'power1.out',
              onUpdate: (t) => {
                src.position.x = cx + (mx - cx) * t;
                src.position.z = cz + (mz - cz) * t;
                src.position.y = sy + Math.sin(Math.PI * t) * 2.6;
                src.setPose({
                  squash: 0.82 + 0.18 * t, widen: 1.14 - 0.14 * t,
                  lean: chargeLean - chargeLean * 1.75 * t, // 前扑 → 后弹仰身
                });
              },
            });
            await ctx.custom(srcId, {
              durationMs: 240, ease: 'power1.inOut',
              onUpdate: (t) => {
                src.position.x = mx + (sx - mx) * t;
                src.position.z = mz + (sz - mz) * t;
                src.position.y = sy + Math.sin(Math.PI * t) * 1.4;
                src.setPose({ lean: -chargeLean * 0.75 * (1 - t), squash: 1, widen: 1 });
              },
            });
          })()
        : ctx.custom(srcId, {
          durationMs: 220, ease: 'power2.out',
          onUpdate: (t) => {
            src.position.x = sx + ux * reach * (1 - t);
            src.position.z = sz + uz * reach * (1 - t);
            src.setPose({ lean: strikeLean * (1 - t) });
          },
        })
        : null;

      // 全屏受击演出（命中瞬间；non-blocking 旁路，不占队列节拍）：烈度 = 基础烈度 ×
      // 配方震荡系数（附级 = 0）+ 致命加成；收击方是友军（主角/盟友）追加视角边缘压暗压红渐晕
      const severity = Math.max(
        damageSeverity(dealt, absorbed) * r.shakeScale + (dealt > 0 ? r.shakeBonus : 0),
        remiCharge && dealt > 0 ? 1.2 : 0, // 冲撞贴脸一击要有「咚」的落地感（附级配方本无震荡）
      );
      if (severity > 0) {
        this.shake.impulse(severity);
        if (unit.side !== 'enemy') this._vignette.pulse(severity);
        // 重击落地 → PCG 场景件被动响应（火盆震颤等；阈值 4 ≈ 中伤以上，附级 tick 不触发）。
        // 单向 fire-and-forget：不进节拍、不读回值
        if (severity >= 4) {
          this.notify('impact', {
            at: { x: unit.position.x, z: unit.position.z },
            severity,
          });
        }
      }

      if (absorbed > 0) {
        // 点粒子是真 3D：z 必须取单位实际深度（缺省 z=70 是旧 2D 特效层，斜相机下投影错位）
        this.particles.spawn(unit.position.x, unit.position.y + 2, {
          count: 20, color: 0x9ccfff, speed: 18, ttl: 0.6, size: 1.5, z: unit.position.z,
        });
        const p = this._unitToUI(unit, 2.5 + (Math.random() - 0.5) * 2, 3);
        this.particles.spawnText(p.x, p.y, `-${absorbed}`, {
          fontSize: Math.min(26 + absorbed * 1.6, 48), color: '#8fb3d9',
          vx: (Math.random() - 0.5) * 8, vy: 16 + Math.random() * 6,
          gravity: -50, ttl: 0.85, scalePop: 0.3,
          space: 'ui',
        });
        // 护盾罩受击/破碎演出（先演后变：此处 display 盾量还是扣前值）——
        // 未破打着弹点涟漪，打破打爆闪溃散；罩件随 sync 的 setUnit 推 level/自清
        const dome = unit._fxLayer?.get?.('shieldDome');
        if (dome && !dome.dying) {
          const fromRight = src ? src.position.x > unit.position.x : true;
          if (this._displayShieldOf(unit.uniqueID) - absorbed > 0) dome.hit(fromRight);
          else dome.shatter();
        }
        if (this._displayShieldOf(unit.uniqueID) - absorbed <= 0) this._shieldBreakFx(unit);
      }

      if (dealt > 0) {
        const flashed = r.flash != null;
        if (flashed) unit.flash?.(r.flash);
        for (const s of r.sparks) {
          this.particles.spawn(unit.position.x, unit.position.y + 2, { ...s, z: unit.position.z });
        }
        // 伤害数字：UI 前景层读数（恒定屏幕尺寸、不被场景遮挡），从受伤源向上迸射、受重力下坠
        const p = this._unitToUI(unit, (Math.random() - 0.5) * 3, 4 + Math.random() * 1.5);
        this.particles.spawnText(p.x, p.y, `-${dealt}`, {
          fontSize: Math.min(r.number.base + dealt * r.number.per, r.number.max) * r.numberScale,
          color: r.number.color,
          vx: (Math.random() - 0.5) * 10, vy: r.number.vy + Math.random() * 8,
          gravity: -65,
          ttl: Math.min(r.number.ttlBase + dealt * r.number.ttlPer, r.number.ttlMax),
          scalePop: r.number.scalePop,
          space: 'ui',
        });
        if (r.knockback) {
          const x0 = unit.position.x;
          const srcX = payload?.source?.uniqueID != null
            ? (this._units.get(payload.source.uniqueID)?.position.x ?? null) : null;
          // 击退方向 = 远离伤害源（旧版恒 +x：敌方恰好正确，我方被打成"迎着攻击踉跄"）；
          // 无来源（环境/附级）按阵营默认：我方朝左、敌方朝右
          const dir = srcX != null
            ? (Math.sign(x0 - srcX) || (unit.side === 'enemy' ? 1 : -1))
            : (unit.side === 'enemy' ? 1 : -1);
          if (unit.side === 'ally') {
            // 盟友（瑞米）受击要生动：冲击击退 → 向后小跳两步
            // （y 弧线 + 后撤步进，后仰逐跳回正）→ 一步跳回槽位。
            // 被打断（收拍/拆台）经 onKill 归位归零，不晾在半路上（正常结束也过这，幂等）。
            const y0 = unit.position.y;
            const back = 2.0 + Math.min(dealt, 20) * 0.09; // 冲击击退（随伤害缩放）
            const leanBack = -dir * 0.14;                  // 后仰角：立牌顶倒向远离伤害源
            ctx.onKill(() => { unit.position.x = x0; unit.position.y = y0; unit.resetPose?.(); });
            // ① 冲击：快速击退 + 后仰
            await ctx.custom(unit.uniqueID, { durationMs: 80, ease: 'power2.out', onUpdate: (t) => {
              unit.position.x = x0 + dir * back * t;
              unit.setPose({ lean: leanBack * t });
            } });
            // ② 后撤小跳 ×2（sin 弧线腾空，步进递减——踉跄稳住）
            let fromX = x0 + dir * back;
            let leanFrom = leanBack;
            for (const seg of [{ step: 1.5, h: 1.5, ms: 150, leanTo: leanBack * 0.55 },
              { step: 1.0, h: 1.2, ms: 140, leanTo: leanBack * 0.25 }]) {
              const fx = fromX;
              const lf = leanFrom;
              await ctx.custom(unit.uniqueID, { durationMs: seg.ms, ease: 'none', onUpdate: (t) => {
                unit.position.x = fx + dir * seg.step * t;
                unit.position.y = y0 + seg.h * Math.sin(Math.PI * t);
                unit.setPose({ lean: lf + (seg.leanTo - lf) * t });
              } });
              fromX = fx + dir * seg.step;
              leanFrom = seg.leanTo;
            }
            // ③ 跳回槽位（与攻击方收势并行）
            const fx = fromX;
            const lf = leanFrom;
            const home = ctx.custom(unit.uniqueID, { durationMs: 180, ease: 'none', onUpdate: (t) => {
              unit.position.x = fx + (x0 - fx) * t;
              unit.position.y = y0 + 1.3 * Math.sin(Math.PI * t);
              unit.setPose({ lean: lf * (1 - t) });
            } });
            await Promise.all([home, recover ?? Promise.resolve()]);
            if (flashed) unit.restoreColor?.();
            return;
          }
          // 重击（敌方，2026-10-07 用户定）：击退 + 绕脚后仰 → 衰减摇晃弹回——立牌
          // 「差点被拍倒」的语言（后仰角与死亡倾倒同轴，重击 = 没倒成的死亡前半程）。
          // 致死重击不在此演：后仰/击退归死亡节拍的「撑不住」链，不叠两段
          if (payload?.heavy && unit.side === 'enemy') {
            if (!payload?.killed) {
              const knock = 2.4 + Math.min(dealt, 40) * 0.06;                          // 2.4~4.8
              const lean = THREE.MathUtils.degToRad(16 + Math.min(dealt, 40) * 0.28);  // 16°~27°
              ctx.onKill(() => { unit.position.x = x0; unit.billboard.rotation.x = 0; unit.resetPose?.(); });
              // ① 受击后仰（~110ms）：击退 + 绕脚仰到 lean 角 + 冲击压扁（果冻痛感的重击档）
              await ctx.custom(unit.uniqueID, { durationMs: 110, ease: 'power2.out', onUpdate: (t) => {
                unit.position.x = x0 + dir * knock * t;
                unit.billboard.rotation.x = -lean * t;
                unit.setPose({ squash: 1 - 0.12 * t });
              } });
              // ② 弹回摇晃（~560ms）：后仰角指数衰减 × 余弦摆（起步续仰 → 过冲回弹 →
              // 归零），压扁随摇晃平方缓释，击退位移 quad-out 回槽——「晃着晃着站稳」
              await Promise.all([
                ctx.custom(unit.uniqueID, { durationMs: 560, ease: 'none', onUpdate: (t) => {
                  const decay = Math.exp(-3.4 * t);
                  unit.billboard.rotation.x = -lean * decay * Math.cos(t * Math.PI * 2.6);
                  unit.position.x = x0 + dir * knock * (1 - t) * (1 - t);
                  unit.setPose({ squash: 1 - 0.12 * (1 - t) * (1 - t) });
                } }),
                recover ?? Promise.resolve(),
              ]);
              unit.billboard.rotation.x = 0;
            } else {
              await Promise.all([ctx.wait(r.beatMs), recover ?? Promise.resolve()]);
            }
            if (flashed) unit.restoreColor?.();
            return;
          }
          // 通用击退（敌方/主角）：幅度随伤害缩放（与震荡同语言）——轻伤轻晃、重伤踉跄
          const knock = 1.1 + Math.min(dealt, 20) * 0.055;
          // 果冻痛感（2026-10-07 用户定：任何伤害都要「痛一下」）：受击瞬压扁 →
          // 回弹拉长 → 晃稳（衰减余弦，与召唤起立的 squash-stretch 同语言）——
          // 敌方专属（主角的受击反馈由卡牌演出承担）
          let flinch = null;
          if (unit.side === 'enemy') {
            const amp = 0.07 + Math.min(dealt, 24) * 0.0015;   // 0.07~0.106 随伤害
            ctx.onKill(() => { unit.setPose({ squash: 1 }); });
            flinch = ctx.custom(unit.uniqueID, {
              durationMs: 360, ease: 'none',
              onUpdate: (t) => unit.setPose({
                squash: 1 - amp * Math.cos(t * Math.PI * 2.2) * Math.exp(-2.2 * t),
              }),
            });
          }
          await ctx.tween(unit.uniqueID, { x: x0 + dir * knock }, { durationMs: 80, ease: 'power1.in' });
          await Promise.all([
            ctx.tween(unit.uniqueID, { x: x0 }, { durationMs: 120 }),
            // 致命击不等痛感收尾（不拖死亡节拍——倒下途中微弹更生动，曲线末段自归 1）
            payload?.killed ? Promise.resolve() : (flinch ?? Promise.resolve()),
            recover ?? Promise.resolve(),
          ]);
          if (flinch && !payload?.killed) unit.setPose({ squash: 1 });   // 收尾硬化（阻尼尾巴不残留）
          if (flashed) unit.restoreColor?.();
          return;
        }
        if (flashed) unit.restoreColor?.();
        // 附级 tick 的轻痛感（敌方）：短促小幅度压弹——「任何伤害」口径的下半场
        if (unit.side === 'enemy') {
          const amp = 0.035;
          const flinch = ctx.custom(unit.uniqueID, {
            durationMs: 300, ease: 'none',
            onUpdate: (t) => unit.setPose({
              squash: 1 - amp * Math.cos(t * Math.PI * 2.2) * Math.exp(-2.2 * t),
            }),
          });
          await Promise.all([ctx.wait(r.beatMs), flinch, recover ?? Promise.resolve()]);
          unit.setPose({ squash: 1 });
          return;
        }
        await Promise.all([ctx.wait(r.beatMs), recover ?? Promise.resolve()]); // 附级：短节拍即收
        return;
      }
      // 全吸收：无击退链，短停一拍让吸收数字可读后收节拍
      await Promise.all([ctx.wait(80), recover ?? Promise.resolve()]);
    }, { animator: this.animator });
    this._fxScripts.add(h);
    h.promise.then(() => {
      this._fxScripts.delete(h);
      finish();
    });
  },
  // 行动姿态节拍（防御/增强/削弱）：立牌绕脚「蓄势 → 定势 → 弹回」，
  // 配姿态色立牌染色（flash → 收尾 restoreColor）。取代旧通用缩放脉冲——同等时长量级，
  // 但三种行动各有身体语言。姿态起点恒为中立（节拍串行，上一拍已归位）；
  // 被打断（收拍/拆台）经 onKill 归零姿态 + 复原染色，不留半蹲（正常结束也过这，幂等）。
  _poseBeat(unit, pose, finish) {
    if (unit._dead) { finish(); return; } // 尸体不摆姿态
    // 削弱前倾朝向对方阵营：敌方（右侧）前倾 = 朝左 = +lean；我方 = 朝右 = -lean
    const lean = pose.lean * (unit.side === 'enemy' ? 1 : -1);
    const h = runScript(async (ctx) => {
      ctx.onKill(() => { unit.resetPose?.(); unit.restoreColor?.(); });
      unit.flash?.(pose.flash);
      await ctx.custom(unit.uniqueID, {
        durationMs: pose.inMs, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({
          lean: lean * t,
          squash: 1 + (pose.squash - 1) * t,
          widen: 1 + (pose.widen - 1) * t,
        }),
      });
      await ctx.wait(pose.holdMs);
      // 弹回带一点过冲（back.out）：定势不是硬切回中立，而是松开后微微晃稳
      await ctx.custom(unit.uniqueID, {
        durationMs: pose.outMs, ease: 'back.out(1.7)',
        onUpdate: (t) => unit.setPose({
          lean: lean * (1 - t),
          squash: 1 + (pose.squash - 1) * (1 - t),
          widen: 1 + (pose.widen - 1) * (1 - t),
        }),
      });
    }, { animator: this.animator });
    this._fxScripts.add(h);
    h.promise.then(() => {
      this._fxScripts.delete(h);
      finish();
    });
  },
  // 单位入场演出（召唤）：与死亡倾倒同轴的语言反演——
  // billboard「以脚为轴」从平躺立起（squash-stretch：立起过程中纵向压扁再弹开，
  // 果冻感）→ 立定瞬间落地扬尘（与死亡落尘同粒子语言）→ 两次衰减摇晃站稳
  // （sin 包络 × (1-t)，绕脚底前后微倾）→ 归位 finish。
  // 前置 sync 已把视图建到槽位（入场类次序：sync 先 anim 后），此处只动
  // billboard 局部姿态——place() 的 position/scale 不受干扰，演出后无残留。
  _unitSpawnBeat(unit, finish) {
    const billboard = unit.billboard;
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    // 复活接入（假死尸体起立）：恢复可见/影子/读数/材质（兜底：若走了
    // 焚毁链，restoreBody 把透明焦黑材质复原），从**当前倾角**起立——假死尸停在 82°，
    // 正好以「从地上挣起来」的同一语言复苏；普通召唤 rotation.x≈0 时维持原 78° 平躺起立。
    unit.restoreBody?.();
    unit.showStatus?.();
    const startRad = Math.abs(billboard.rotation.x) > 0.1
      ? Math.abs(billboard.rotation.x)
      : THREE.MathUtils.degToRad(78);

    // ① 立起（~0.38s，power3.out：起得急、临直立减速——「挣起来」的发力感）
    this.animator.animateCustom(unit.uniqueID, {
      durationMs: 380,
      ease: 'power3.out',
      onUpdate: (t) => {
        billboard.rotation.x = -startRad * (1 - t);
        // 果冻展开：前 40% 纵向压扁（贴地铺开），后 60% 弹回全高
        const squash = t < 0.4 ? 0.55 + t : 1 - 0.28 * Math.sin(Math.PI * (t - 0.4) / 0.6);
        billboard.scale.y = squash;
      },
      onComplete: () => {
        billboard.rotation.x = 0;
        billboard.scale.y = 1;
        // 落地扬尘：近处低速大颗粒 + 外围溅尘（死亡落尘同语言）
        this.particles.spawn(px, py + 0.8, { count: 16, color: 0xb59a72, speed: 9, ttl: 0.7, gravity: -6, size: 2.2, z: pz });
        this.particles.spawn(px, py + 0.5, { count: 10, color: 0x857358, speed: 15, ttl: 0.45, gravity: -12, size: 1.4, z: pz });
        // ② 摇晃站稳（~0.75s）：两次前后摆（sin 两周期 × 指数衰减），摆幅 ≈4.5°
        this.animator.animateCustom(unit.uniqueID, {
          durationMs: 750,
          ease: 'none',
          onUpdate: (t) => {
            const decay = Math.exp(-3.2 * t);
            billboard.rotation.x = THREE.MathUtils.degToRad(4.5) * Math.sin(t * Math.PI * 4) * decay;
          },
          onComplete: () => {
            billboard.rotation.x = 0;
            finish();
          },
        });
      },
    });
  },
  // 单位死亡演出：立牌「以脚为轴」向后倾倒（重力加速）→
  // 落地扬尘 + 一次阻尼回弹 → 焚毁（焦黑化 + alphaTest 侵蚀淡出 + 余烬升腾）→
  // 整体隐藏收殓。节拍阻塞至收殓，其后的 sync 才应用 isDead 面色（先演后变）。
  // 倾倒作用于 billboard 的 X 轴（yaw 在 rig 层——2026-10-07 层级重构后两轴分层，
  // 逐帧 yaw 不吃掉倾倒角），旋转轴过脚底——立牌物理感的根源；牌面立面底部锚定，
  // 绕原点转即天然「栽倒」而非「缩没」。
  _unitDeathBeat(unit, payload, finish) {
    const id = unit.uniqueID;
    // 假死分支（将复苏：春风/复苏系，补前端假死/复活语义）——
    // 倒地留尸不焚毁：复苏时 ANIM_UNIT_SPAWN 从倒地姿态重新立起。判据读 **payload
    // 里 core unit 的复活倒计时**（结算内同步挂上，实时）；不能用本舞台快照——
    // unitDied 是「先 anim 后 sync」，死亡节拍播放时快照还是旧投影（reviving 未至），
    // 误判走真死焚毁链（病灶：复苏后立起的是焚毁透明立牌）。
    if ((payload?.unit?._reviveCountdown ?? 0) > 0) {
      this._cleaveSplit?.delete(id);   // 复苏者不裂——标记不跨假死
      return this._unitFakeDeathBeat(unit, payload, finish);
    }
    // 天斩击杀分支（heavenCleave 施术拍挂的断裂标记）：立牌沿斩缝裂成两半
    if (this._cleaveSplit?.delete(id)) return this._unitCleaveSplitBeat(unit, finish);
    // 重击致死分支（heavy 标记）：击退后仰 → 撑不住 → 倒尽（加强版倾倒）
    if (payload?.heavy) return this._unitHeavyDeathBeat(unit, finish);
    const billboard = unit.billboard;
    unit.hideIntention(); // 意图即隐：尸体不再预告下一手
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    // TIP 略欠 90°：完全放平会透视成一条线，82° 平躺仍留一线牌面可读
    const TIP = THREE.MathUtils.degToRad(82);

    // ① 倒下（~0.47s，power2.in 重力加速：越落越快）
    this.animator.animateCustom(id, {
      durationMs: 470,
      ease: 'power2.in',
      onUpdate: (t) => { billboard.rotation.x = -TIP * t; },
      onComplete: () => {
        // 落地扬尘：近处低速大颗粒 + 外围溅尘（加色混合下土色即微光尘雾）
        this.particles.spawn(px, py + 0.8, { count: 18, color: 0xb59a72, speed: 9, ttl: 0.7, gravity: -6, size: 2.2, z: pz });
        this.particles.spawn(px, py + 0.5, { count: 12, color: 0x857358, speed: 16, ttl: 0.45, gravity: -12, size: 1.4, z: pz });
        // ② 回弹（~0.22s）：阻尼单次反弹，sin 包络 × (1-t) 衰减，峰值离地约 2°
        this.animator.animateCustom(id, {
          durationMs: 220,
          onUpdate: (t) => {
            const lift = THREE.MathUtils.degToRad(4) * Math.sin(Math.PI * t) * (1 - t);
            billboard.rotation.x = -(TIP - lift);
          },
          onComplete: () => this._unitBurnAway(unit, finish),
        });
      },
    });
  },
  // 重击前两拍（heavy 标记共用段，2026-10-07 用户定）：① 击退 + 绕脚后仰到 30°
  //（与死亡倾倒同轴——重击 = 差点被拍倒）→ ② 撑不住的挣扎（衰减摇晃 ±7° + 重心
  // 二次缓缓下沉——还想站稳但已经不行了）。拍毕调 onFall（从当前角继续倒）。
  _heavyStruggle(unit, onFall) {
    const id = unit.uniqueID;
    const billboard = unit.billboard;
    const x0 = unit.position.x;
    const KICK = 2.6;                              // 重击致死击退
    const LEAN = THREE.MathUtils.degToRad(30);     // 后仰挣扎角
    this.animator.animateCustom(id, {
      durationMs: 140, ease: 'power2.out',
      onUpdate: (t) => {
        unit.position.x = x0 + KICK * t;
        billboard.rotation.x = -LEAN * t;
        unit.setPose({ squash: 1 - 0.12 * t });   // 冲击深压（果冻痛感的重击档）
      },
      onComplete: () => {
        this.animator.animateCustom(id, {
          durationMs: 600, ease: 'none',
          onUpdate: (t) => {
            const sway = THREE.MathUtils.degToRad(7) * Math.sin(t * Math.PI * 3) * Math.exp(-2.6 * t);
            const sink = THREE.MathUtils.degToRad(9) * t * t;
            billboard.rotation.x = -LEAN + sway - sink;
            unit.setPose({ squash: 1 - 0.12 * (1 - t) * (1 - t) });   // 压扁随挣扎缓释
          },
          onComplete: onFall,
        });
      },
    });
  },
  // 重击致死演出：普通倾倒的加强版——击退后仰 → 挣扎 → 彻底撑不住（余角加速倒尽，
  // 比普通死亡快——重心早已失守）→ 回弹 + 焚毁收殓（后段与 _unitDeathBeat 同语言）。
  _unitHeavyDeathBeat(unit, finish) {
    const id = unit.uniqueID;
    const billboard = unit.billboard;
    unit.hideIntention();
    const TIP = THREE.MathUtils.degToRad(82);   // 与死亡节拍同口径
    this._heavyStruggle(unit, () => {
      const from = billboard.rotation.x;
      const { x: px, y: py, z: pz } = unit.position;
      this.animator.animateCustom(id, {
        durationMs: 320, ease: 'power2.in',
        onUpdate: (t) => { billboard.rotation.x = from + (-TIP - from) * t; },
        onComplete: () => {
          this.particles.spawn(px, py + 0.8, { count: 18, color: 0xb59a72, speed: 9, ttl: 0.7, gravity: -6, size: 2.2, z: pz });
          this.particles.spawn(px, py + 0.5, { count: 12, color: 0x857358, speed: 16, ttl: 0.45, gravity: -12, size: 1.4, z: pz });
          this.animator.animateCustom(id, {
            durationMs: 220,
            onUpdate: (t) => {
              const lift = THREE.MathUtils.degToRad(4) * Math.sin(Math.PI * t) * (1 - t);
              billboard.rotation.x = -(TIP - lift);
            },
            onComplete: () => this._unitBurnAway(unit, finish),
          });
        },
      });
    });
  },
  // 假死演出：与死亡同语言的倾倒+落尘，但**就地停住**——不焚毁不隐藏（尸体可见、
  // 影子保留），状态条与意图隐藏（尸体不读数；假死意图「?」在 rig 层立着）。
  // 重击致死（heavy）走加强版前两拍（击退后仰+挣扎）。复苏节拍（ANIM_UNIT_SPAWN）
  // 从倒地姿态直接起立；若它在到达前战斗结束，尸体随舞台销毁一起退场。
  _unitFakeDeathBeat(unit, payload, finish) {
    const billboard = unit.billboard;
    unit.hideIntention();
    unit.hideStatus();
    const TIP = THREE.MathUtils.degToRad(82);
    const fall = () => {
      const { x: px, y: py, z: pz } = unit.position;
      const from = billboard.rotation.x;
      this.animator.animateCustom(unit.uniqueID, {
        durationMs: payload?.heavy ? 320 : 470,   // 重击：重心已失守，余角加速倒尽
        ease: 'power2.in',
        onUpdate: (t) => { billboard.rotation.x = from + (-TIP - from) * t; },
        onComplete: () => {
          this.particles.spawn(px, py + 0.8, { count: 14, color: 0x8fa06a, speed: 7, ttl: 0.7, gravity: -6, size: 2.0, z: pz });
          this.particles.spawn(px, py + 0.5, { count: 8, color: 0x6d7a4f, speed: 12, ttl: 0.45, gravity: -12, size: 1.3, z: pz });
          finish(); // 停在倒地态：等复苏（或战斗结束）
        },
      });
    };
    if (payload?.heavy) this._heavyStruggle(unit, fall);
    else fall();
  },
  // ③ 焚毁：状态绘制先隐（尸体不再读数），立牌焦黑化 + alphaTest 侵蚀淡出
  // （opacity 压低 alpha 后 0.5 阈值逐像素 discard，边缘呈烧蚀状）+ 余烬/烟升腾；
  // 播毕整体隐藏——place() 不重置 visible，尸体自此退场（后续 sync 幂等保持隐藏）。
  _unitBurnAway(unit, finish) {
    const bodyMat = unit.body.material;
    unit.hideStatus();
    unit.body.castShadow = false; // 深度材质不认 opacity：不关影，影子会在淡出期赖在地板上
    bodyMat.transparent = true;
    bodyMat.needsUpdate = true;
    const startColor = bodyMat.color.clone();
    const charColor = new THREE.Color(0x1a0f0a);
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    this.particles.spawn(px, py + 1, { count: 26, color: 0xffa040, speed: 8, ttl: 0.6, gravity: 14, size: 1.1, z: pz - 2 });
    this.particles.spawn(px, py + 1, { count: 12, color: 0x6b655e, speed: 4, ttl: 0.9, gravity: 6, size: 2.2, z: pz - 2 });
    this.animator.animateCustom(unit.uniqueID, {
      durationMs: 430,
      ease: 'power1.in',
      onUpdate: (t) => {
        bodyMat.opacity = 1 - t;
        bodyMat.color.copy(startColor).lerp(charColor, Math.min(1, t * 1.3)); // 先焦后散
      },
      onComplete: () => {
        unit.visible = false;
        finish();
      },
    });
  },
  // 天斩击杀专属（断裂标记消费方）：立牌沿竖直斩缝**裂成两半**——本体隐藏，取其
  // 几何参数与立绘贴图做两张「半幅 UV」快照面（普通材质——本体是带 L0 补丁的
  // node 材质，克隆补丁不可靠，尸体将焦化无需补丁），挂 billboard（继承逐帧 yaw，
  // 不吃 standee 呼吸/姿态）。快照面几何 y 平移 +h/2、网格贴地——rotation.x 以
  // **各自脚底**为轴，与正常死亡同一「栽倒」语言。四拍：裂缝迸开（只稍稍错开一
  // 道缝）+ 剖面白热**瞬闪**（随缝收尽，不驻留——拖长会在原地留下一道悬空「刀痕」，
  // 与倒下的裂半脱节）→ 微缝悬停（分离姿态峰值帧）→ 两半错峰绕脚栽倒（落地扬尘
  // + 回弹，同 _unitDeathBeat）→ 焦黑侵蚀淡出（焚毁同语言）。节拍阻塞至收殓（同死亡链）。
  _unitCleaveSplitBeat(unit, finish) {
    const body = unit.body;
    unit.hideIntention();
    unit.hideStatus();
    const { width = 16, height = 22 } = body.geometry?.parameters ?? {};
    const map = body.material?.map ?? null;
    const startColor = body.material?.color?.clone() ?? new THREE.Color(0xffffff);
    const halves = [0, 1].map((i) => {
      // 半宽几何 + 半幅 UV（各占原位一半，两片拼回原图）：⚠ 不能用全宽几何裁 UV——
      // 那会把半张脸横向拉伸 2 倍且两片重叠成糊（glm-flash 两轮「融化/灰斑」病根）。
      // 几何 y 平移 +h/2：原点挪到半片脚底——rotation.x 即绕脚栽倒（死亡节拍同构）
      const geo = new THREE.PlaneGeometry(width / 2, height);
      geo.translate(0, height / 2, 0);
      const uvAttr = geo.attributes.uv;
      for (let k = 0; k < uvAttr.count; k++) uvAttr.setX(k, i * 0.5 + uvAttr.getX(k) * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        map, color: startColor.clone(), alphaTest: 0.5, transparent: true, fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.name = 'cleaveHalf';
      m.position.set((i === 0 ? -1 : 1) * width * 0.25, 0, 0.15);
      m.castShadow = false;   // 快照面不投影：影子随本体隐去，淡出期不赖地
      unit.billboard.add(m);
      return m;
    });
    // 剖面闪光：切缝处一线白热（HDR 直推过 bloom 阈）——只在迸开/悬停两拍驻留，
    // 栽倒前收尽：缝是「被劈开」的瞬间证据，不是留在原地的疤
    const seam = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.05, height * 1.02),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.6, 2.4, 1.9), transparent: true,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false,
      }),
    );
    seam.name = 'cleaveSeam';
    seam.position.set(0, body.position.y, 0.3);
    seam.renderOrder = 50;
    unit.billboard.add(seam);
    body.visible = false;
    const { x: px, y: py, z: pz } = unit.position;
    const id = unit.uniqueID;
    const cleanHalves = () => {
      for (const m of halves) { unit.billboard.remove(m); m.geometry.dispose(); m.material.dispose(); }
      unit.billboard.remove(seam); seam.geometry.dispose(); seam.material.dispose();
    };
    // 分离量全程很小（峰值 0.16w）——「裂开」靠缝与错缝读，不靠飞开
    const setSep = (sep) => {
      halves[0].position.x = -width * 0.25 - sep;
      halves[1].position.x = width * 0.25 + sep * 0.85;
    };
    const TIP = THREE.MathUtils.degToRad(82);   // 与死亡节拍同口径（90° 透视成线）
    // ①a 裂缝迸开（~0.18s）：弹开一道小缝 + 剖面闪光最亮
    this.animator.animateCustom(id, {
      durationMs: 180, ease: 'power3.out',
      onUpdate: (t) => {
        setSep(t * width * 0.10);
        halves[0].rotation.z = -0.05 * t;
        halves[1].rotation.z = 0.04 * t;
      },
      onComplete: () => {
        // ①b 微缝悬停（~0.26s）：缝缓慢加宽到峰值、微外倾；剖面闪光在此拍收尽
        this.animator.animateCustom(id, {
          durationMs: 260, ease: 'power1.inOut',
          onUpdate: (t) => {
            setSep(width * (0.10 + 0.06 * t));
            halves[0].rotation.z = -0.05 - 0.01 * t;
            halves[1].rotation.z = 0.04 + 0.01 * t;
            seam.material.opacity = 1 - t;
          },
          onComplete: () => {
            seam.visible = false;
            // ② 各自栽倒（~0.56s 主轴线性，半片各自 power2.in + 右半错峰 16%）：
            // 两半像正常敌人一样绕脚向后倒，落地各扬尘一记
            this.particles.spawn(px, py + height * 0.3, { count: 14, color: 0xffe2a8, speed: 13, ttl: 0.45, gravity: -12, size: 1.1, z: pz });
            let dustL = false, dustR = false;
            this.animator.animateCustom(id, {
              durationMs: 560,
              onUpdate: (t) => {
                const pL = Math.min(1, t / 0.84);
                const pR = Math.min(1, Math.max(0, (t - 0.16) / 0.84));
                halves[0].rotation.x = -TIP * pL * pL;
                halves[1].rotation.x = -TIP * pR * pR;
                if (!dustL && pL >= 1) {
                  dustL = true;
                  this.particles.spawn(px - width * 0.33, py + 0.6, { count: 10, color: 0xb59a72, speed: 8, ttl: 0.6, gravity: -6, size: 1.8, z: pz });
                }
                if (!dustR && pR >= 1) {
                  dustR = true;
                  this.particles.spawn(px + width * 0.3, py + 0.6, { count: 10, color: 0x857358, speed: 8, ttl: 0.6, gravity: -6, size: 1.8, z: pz });
                }
              },
              onComplete: () => {
                // ③ 回弹（~0.2s，同死亡节拍阻尼单次反弹）
                this.animator.animateCustom(id, {
                  durationMs: 200,
                  onUpdate: (t) => {
                    const lift = THREE.MathUtils.degToRad(4) * Math.sin(Math.PI * t) * (1 - t);
                    halves[0].rotation.x = -(TIP - lift);
                    halves[1].rotation.x = -(TIP - lift);
                  },
                  onComplete: () => {
                    // ④ 焦黑侵蚀淡出（焚毁同语言：先焦后散，alphaTest 阈值侵蚀出烧蚀边）
                    const charColor = new THREE.Color(0x1a0f0a);
                    this.particles.spawn(px, py + 0.8, { count: 18, color: 0xffa040, speed: 7, ttl: 0.55, gravity: 12, size: 1.0, z: pz - 1 });
                    this.particles.spawn(px, py + 0.8, { count: 10, color: 0x6b655e, speed: 4, ttl: 0.8, gravity: 6, size: 1.9, z: pz - 1 });
                    this.animator.animateCustom(id, {
                      durationMs: 430, ease: 'power1.in',
                      onUpdate: (t) => {
                        for (const m of halves) {
                          m.material.opacity = 1 - t;
                          m.material.color.copy(startColor).lerp(charColor, Math.min(1, t * 1.3));
                        }
                      },
                      onComplete: () => {
                        cleanHalves();
                        unit.visible = false;
                        finish();
                      },
                    });
                  },
                });
              },
            });
          },
        });
      },
    });
  },
};
