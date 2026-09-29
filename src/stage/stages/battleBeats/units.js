// 战斗单位演出族（BattleStage 原型混入，this = BattleStage 宿主）：
// 受击/姿态/生死五件。节拍表（battleBeats.js）经 stage._xxxBeat 调用到这里；
// 方法间共享宿主状态（_units/_snapshot/particles/shake 等），this 前缀即宿主。

import * as THREE from 'three';
import { damageSeverity } from '../../objects/screenImpactFX.js';
import { slotTransform } from '../../scenes/index.js';
import { resolveDamageRecipe } from '../../fx/recipes.js';
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
          // 通用击退（敌方/主角）：幅度随伤害缩放（与震荡同语言）——轻伤轻晃、重伤踉跄
          const knock = 1.1 + Math.min(dealt, 20) * 0.055;
          await ctx.tween(unit.uniqueID, { x: x0 + dir * knock }, { durationMs: 80, ease: 'power1.in' });
          await Promise.all([
            ctx.tween(unit.uniqueID, { x: x0 }, { durationMs: 120 }),
            recover ?? Promise.resolve(),
          ]);
          if (flashed) unit.restoreColor?.();
          return;
        }
        if (flashed) unit.restoreColor?.();
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
  // 倾倒作用于 billboard 的 X 轴（YXZ 序下与 faceCamera 的 yaw 正交组合，逐帧
  // yaw 不吃掉倾倒角），旋转轴过脚底——立牌物理感的根源；牌面立面底部锚定，
  // 绕原点转即天然「栽倒」而非「缩没」。
  _unitDeathBeat(unit, payload, finish) {
    const id = unit.uniqueID;
    // 假死分支（将复苏：春风/复苏系，补前端假死/复活语义）——
    // 倒地留尸不焚毁：复苏时 ANIM_UNIT_SPAWN 从倒地姿态重新立起。判据读 **payload
    // 里 core unit 的复活倒计时**（结算内同步挂上，实时）；不能用本舞台快照——
    // unitDied 是「先 anim 后 sync」，死亡节拍播放时快照还是旧投影（reviving 未至），
    // 误判走真死焚毁链（病灶：复苏后立起的是焚毁透明立牌）。
    if ((payload?.unit?._reviveCountdown ?? 0) > 0) return this._unitFakeDeathBeat(unit, finish);
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
  // 假死演出：与死亡同语言的倾倒+落尘，但**就地停住**——不焚毁不隐藏（尸体可见、
  // 影子保留），状态条与意图隐藏（尸体不读数）。复苏节拍（ANIM_UNIT_SPAWN）从这
  // 个 82° 倒地姿态直接起立；若它在到达前战斗结束，尸体随舞台销毁一起退场。
  _unitFakeDeathBeat(unit, finish) {
    const billboard = unit.billboard;
    unit.hideIntention();
    unit.hideStatus();
    const TIP = THREE.MathUtils.degToRad(82);
    const { x: px, y: py, z: pz } = unit.position;
    this.animator.animateCustom(unit.uniqueID, {
      durationMs: 470,
      ease: 'power2.in',
      onUpdate: (t) => { billboard.rotation.x = -TIP * t; },
      onComplete: () => {
        this.particles.spawn(px, py + 0.8, { count: 14, color: 0x8fa06a, speed: 7, ttl: 0.7, gravity: -6, size: 2.0, z: pz });
        this.particles.spawn(px, py + 0.5, { count: 8, color: 0x6d7a4f, speed: 12, ttl: 0.45, gravity: -12, size: 1.3, z: pz });
        finish(); // 停在倒地态：等复苏（或战斗结束）
      },
    });
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
};
