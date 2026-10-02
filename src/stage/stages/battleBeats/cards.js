// 卡牌演出族（BattleStage 原型混入，this = BattleStage 宿主）：
// 离场/焚毁/造牌/飞行/发动展示/资源/转化五件。节拍表（battleBeats.js）经
// stage._xxxBeat 调用到这里；方法间共享宿主状态（_views/animator/springs 等）。

import * as THREE from 'three';
import gsap from 'gsap';
import { EventNames } from '../../../bridge/events.js';
import { CardObject } from '../../objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from '../../objects/cardMetrics.js';
import { playCardTransform } from '../../fx/cardTransform.js';
import { DRAIN_FLIGHT_MS } from '../../fx/gpu/resourceDrainFx.js';
import { runSpellFx, resolveSpellFx } from '../../fx/spells/index.js';
import { nextCardSpot } from '../../cardSpot.js';

/** 牌堆图标摆位（deck 锚；宿主 layout/pile 建档也用）。 */
export const PILE_POSITIONS = {
  deck: { x: 80, y: -55 },      // 牌库图标（手牌右侧下；扇形手牌卡中心右界 64，避让开）
};                               // FIFO 单循环区：无弃牌堆，离场非消耗卡一律飞回牌库

/** 焚毁燃烧总时长（ms）：离场节拍阻塞至此——发动 → 效果 → 燃烧殆尽 → 状态同步 */
export const CARD_BURN_MS = 750;

export const cardBeats = {
  // 离场节拍：播放该卡的离场演出（弃/回库=飞行停车；焚毁=原地燃烧殆尽）并
  // **阻塞本节拍**（onDone 才回 finish）——"发动 → 效果 → 离场"的次序由
  // sequencer 队列编排（sync 节拍在离场之后，牌库数字因此飞进才+1）。
  // zone 在节拍时点即推进（显示状态由节拍权威）；落点取自节拍载荷（toZone），
  // 不读投影——显示状态此时尚未同步，投影里卡还在原地。
  _departureBeat(id, type, payload, finish) {
    const view = id != null ? this._views.get(id) : null;
    if (!view) { // 无载体（未来机制/异常）：脉冲落点图标打节拍
      if (type === EventNames.ANIM_CARD_BURNT) return finish();
      return this._pulsePile('deck', finish);
    }
    this.picker.removePickable(id);
    if (type === EventNames.ANIM_CARD_BURNT) {
      // 牌库来源的焚毁（腐食甲虫啃牌库顶）：视图停在牌库堆上且隐形、从未烘面——
      // 先烘面显形、飞到中央展示位（宾语展示同机位），落定再原地燃尽；
      // 否则焚毁整场演给一张隐形空白卡（"吃卡没感觉"的病根）。手牌卡维持原地烧。
      if (!view.visible && payload?.cardView) {
        view.setCard(payload.cardView);
        view.visible = true;
        const sp = nextCardSpot();   // 中央错位：与停靠中的宾语展示错开（cardSpot.js）
        return this.animator.animate(id, { x: sp.dx, y: 4 + sp.dy, z: 50, scale: 1.0 }, {
          durationMs: 320,
          onComplete: () => this._burnOut(id, view, finish),
        });
      }
      return this._burnOut(id, view, finish);
    }
    // 回手牌（宾语转化归位/牌库抽卡）：交还手牌跟踪层——_entering 标记待飞，
    // 锚点算出后从当前位（中央展示位）补间飞回扇形（咏唱回手 ANIM_CHANT_TOGGLED
    // 同款 held→hand 放行路径：sync 对账的 held 守卫不解除停留，须由本节拍直写）
    if (type === EventNames.ANIM_CARD_MOVED && payload?.toZone === 'hand') {
      this.model.setZone(id, 'hand');
      this._entering.add(id);
      return finish();
    }
    // FIFO 单循环区：非焚毁离场（打出/弃置/换牌/解除咏唱/迁移）一律回牌库底
    this.model.setZone(id, 'deck'); // 状态在节拍时点推进（模型权威）
    this._flyOut(id, view, { ...PILE_POSITIONS.deck, z: 40, scale: 0.5 }, finish);
  },
  // 焚毁离场：原地燃烧殆尽（着色器自底向上吞蚀 + 前沿余烬 + 火起颤动），
  // 燃尽后牌面已全 discard（不可见）——瞬移落位牌库图标处即销毁收尾，无飞行动画。
  // 焚毁 = 对象终结（唯一销毁路径）：模型出册 + 视图销毁（burnt 不回流，id 不会
  // 重生；未来"焚毁区捞回"机制须自行重建）。
  // 节拍阻塞至燃尽完成，sequencer 队列次序因此是：发动 → 效果 → 燃烧殆尽 → 状态同步。
  _burnOut(id, view, finish) {
    this.model.removeCard(id);
    this._views.delete(id);
    this._burning.add(view);
    view.startBurn({
      durationMs: CARD_BURN_MS,
      onBurnt: () => {
        this._burning.delete(view);
        view.position.set(PILE_POSITIONS.deck.x, PILE_POSITIONS.deck.y, 40); // 不可见瞬移
        this.animator.unregister(id);
        this.uiScene.remove(view);
        view.dispose();
        finish?.();
      },
    });
  },
  // 造牌入库演出：卡面在屏幕中心附近生成（放缩长开）→ 弧线飞入牌库 → 落位销毁；
  // 牌库计数由紧随其后的 sync 节拍跳增（离场类次序：anim → sync）。
  // 造出的卡不在任何显示区（deck 无视觉对象），牌面由 presenter 附带的 cardView 提供。
  // 非入库造牌（toZone 'hand' 等）视觉走状态差分（既有入场类次序），只脉冲图标打节拍。
  _addCardBeat(payload, finish) {
    const view = payload?.cardView;
    if (!view || payload?.toZone !== 'deck') return this._pulsePile('deck', finish);
    const object = new CardObject({
      uniqueID: `spawn:${payload.card.uniqueID}`,
      cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
    });
    object.setCard(view);
    // 高 z 起始（70 > 展示位 60 > 手牌扇 10~40 > 区域图标 5）：生成卡永远盖在
    // 结算中的发动卡（held 于展示位）之上——否则看不到蓄力向牌库加了什么卡；
    // 飞行途中线性降回 40 落位，符合"从高处递进牌库"的空间感
    { const sp = nextCardSpot();   // 中央错位（只取 dx：y=-12 的「自下方递进」带语不动）
      object.position.set(sp.dx * 0.7, -12, 70); }
    object.scale.set(0.05, 0.05, 1);
    object.faceMesh.material.opacity = 0;
    this.uiScene.add(object);
    this._tweenFactory(object, { scale: 1 }, {
      durationMs: 200,
      ease: 'back.out(2)',
      onComplete: () => {
        this._pulsePile('deck');
        // 瞬态对象不在 animator 注册表：直接驱动飞行（同一 _cardFlight 语言）
        const proxyId = `spawn:${payload.card.uniqueID}`;
        this._views.set(proxyId, object); // 借注册表项驱动 _cardFlight，飞完即摘除
        this._cardFlight(proxyId, { ...PILE_POSITIONS.deck, z: 40, scale: 0.5 }, {
          fade: 'out',
          tilt: 0.14,
          ease: 'power1.in',
          durationMs: 340,
          onDone: () => {
            this._views.delete(proxyId);
            this.uiScene.remove(object);
            object.dispose();
            finish();
          },
        });
      },
    });
    // 生成淡入与弹性放缩并行（材质不透明度 0→1）
    this._tweenFactory(object.faceMesh.material, { opacity: 1 }, { durationMs: 200 });
  },
  // 卡牌飞行（区域间移动的统一演出语言）：
  //   * 轨迹 = 二次贝塞尔弧线（控制点在航线中点上方，弧高随距离自适应钳制）
  //   * 姿态 = rotation.z 沿 sin(πt) 倾转（中段峰值、两端归零）+ 落地转正
  //   * 淡入/淡出 = 材质不透明度前/后半程渐变（fade: 'in' | 'out' | null）
  //   * 落地硬化：onComplete 显式写终态——同步注入式 tween（无 onUpdate 采样）
  //     也能正确落位，测试因此确定
  // 注册表内的卡走 animator.animateCustom（状态机感知：飞行中布局跟踪让位）；
  // 瞬态对象（造牌 spawn）未注册则直接用 tween 工厂驱动同一 onUpdate 协议。
  _cardFlight(id, to, { arc = null, tilt = 0, fade = null, durationMs = 340, ease, delayMs = 0, onDone } = {}) {
    const view = this._views.get(id);
    if (!view) { onDone?.(); return; }
    const from = {
      x: view.position.x, y: view.position.y, z: view.position.z,
      scale: view.scale.x, rot: view.rotation.z,
    };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const arcH = arc ?? THREE.MathUtils.clamp(dist * 0.25, 6, 18);
    const ctrl = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + arcH };
    const toScale = to.scale ?? from.scale;
    const toRot = to.rotation ?? 0;
    const toZ = to.z ?? from.z;
    const mat = view.faceMesh.material;
    const sample = (t) => {
      const u = 1 - t;
      view.position.set(
        u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
        from.z + (toZ - from.z) * t,
      );
      const s = from.scale + (toScale - from.scale) * t;
      view.scale.set(s, s, 1);
      view.rotation.z = from.rot + (toRot - from.rot) * t + Math.sin(Math.PI * t) * tilt;
      if (fade === 'in') mat.opacity = Math.min(t / 0.6, 1);
      else if (fade === 'out') mat.opacity = Math.min((1 - t) / 0.5, 1);
    };
    const settle = () => {
      view.position.set(to.x, to.y, toZ);
      view.scale.set(toScale, toScale, 1);
      view.rotation.z = toRot;
      mat.opacity = 1;
      if (fade === 'out') view.visible = false;
      onDone?.();
    };
    const opts = {
      durationMs, ease, delayMs,
      onUpdate: sample,
      onComplete: settle,
    };
    if (this.animator.has(id)) {
      this.animator.animateCustom(id, opts);
    } else {
      this._tweenFactory({ t: 0 }, { t: 1 }, opts);
    }
    if (fade === 'in') {
      view.visible = true;
      mat.opacity = 0; // 起步即零透明：级联延迟期间不闪现
      sample(0);
    }
  },
  // 离场飞行本体：弧线飞往落点（弃/回库）+ 后半程淡出 + 轻微逆旋 → 停车（隐形）→ finish。
  // 持久对象模型下没有销毁、没有 inFlight 交接：sequencer 串行保证后续 sync
  // 应用时飞行必已落地；卡再被抽回时同一视图从停车状态直接显形归位（对象身份
  // 跨 zone 稳定，"入手消失"类 id 跟踪问题在结构上不再可能）。
  _flyOut(id, view, to, finish) {
    this._cardFlight(id, to, {
      fade: 'out',
      tilt: -0.10,
      ease: 'power1.in',
      durationMs: 340,
      onDone: finish,
    });
  }

  // ========== 战后奖励面板宿主（与 MapStage 同名同契约，供 runController 统一下行快照）==========
  /** 面板意图上行出口（runController 注入：Stage 只上报「谁被点了」）。 */,
  // 发动展示（全局唯一卡牌：展示用本体，无替身无瞬移）：
  // 卡本体从当前位置（手牌/松手点）飞到中央放大 → 停留 → 节拍 finish。
  // 收尾分两路：已有离场节拍在排队（正常打出/焚毁）或卡已进结算区（pending，
  // 结算期输入挂起、离场节拍尚未产生）→ 停留展示位等收（不回手牌——它已不是手牌）；
  // 否则（咏唱回手等）→ 回锚点跟踪
  _skillDisplay(payload, finish) {
    const id = payload?.skill?.uniqueID;
    const view = id != null ? this._views.get(id) : null;
    if (!view) { finish(); return; } // 非手牌来源（未来机制）：无展示载体，直接打节拍
    // 卡费消耗粒子（资源消耗汇聚特效）：从资源图标爆散 → 汇聚到此卡边缘 →
    // 汇聚抵达后才起飞发动（DRAIN_FLIGHT_MS 编排延迟）。费用读定义/覆写口径
    // （PRE 修饰的实付偏差只影响粒子数量级，装饰可接受；X 费取当前读数）
    let drainDelay = 0;
    if (this._drainFx) {
      const ov = payload?.skill?.costOverride;
      const rawMana = ov?.mana ?? payload?.def?.cost?.mana ?? 0;
      const rawAp = ov?.actionPoint ?? payload?.def?.cost?.actionPoint ?? 0;
      const mana = rawMana === 'X' ? (this._resources?.mana.current ?? 0) : +rawMana || 0;
      const ap = rawAp === 'X' ? (this._resources?.ap.current ?? 0) : +rawAp || 0;
      if (mana > 0 || ap > 0) {
        this._drainFx.playCardCost({ mana, ap, cardView: view });
        drainDelay = DRAIN_FLIGHT_MS;
        // 徽章辉光：粒子抵达时点亮 → 衰减，与汇聚组成
        // 「能量注入开销标」的闭环。mask 位置已在 _setBakedFace 随卡面烘进 C0 链
        // （costBadges），这里只推强度；与卡牌位移演出正交，直推 uniform。
        const body = view?.fx?.body;
        if (body?.costBadges?.length) {
          gsap.fromTo(body.uCostGlow, { value: 1 }, {
            value: 0, duration: 1.1, delay: DRAIN_FLIGHT_MS / 1000,
            ease: 'power2.out', overwrite: 'auto',
          });
        }
      }
    }
    this._displayCard = { id };
    this.animator.animate(id, { x: 0, y: -2, z: 60, scale: 1.15 }, {
      durationMs: 70,
      delayMs: drainDelay,
      onComplete: () => {
        // 卡面收尾（节拍完成时刻执行——held 分流/弹簧收养都以 notify 时点为准）
        const settle = () => {
          this._displayCard = null;
          finish(); // 发动节拍结束；离场由后续 ANIM_CARD_* 节拍驱动
          if (this._views.has(id)) {
            if (this._hasDepartureBeatQueued(id) || (this._snapshot?.pending ?? []).includes(id)) {
              this.model.setZone(id, 'held'); // 停留位等收（离场节拍在排队 / 结算区卡：正在结算不回手）
              this.springs.release(id); // 离手即摘弹簧目标：空窗期 idle 卡不得被拉回手牌（回归病灶）
            }
            // else：弹簧自动收养——从展示位零速接管，平滑滑回扇形锚点
          }
        };
        // 施术演出模板接管停留窗期间，卡必须停在展示位：held 分流与 springs.release
        // 只在 notify（settle）时点发生，而施术协程把停留窗拉长到数百 ms（BASE 才 100ms）
        // ——卡到位 tween 落定即回落 idle，空窗期 springs 把它当「回手牌的卡」从中途拉回
        // 扇形锚点（2026-10-02 用户报的「动画播一半先回手牌再飞牌库」回归根因）。
        // 根治：命中模板即刻摘弹簧目标 + 预置 held——布局/状态语义本就允许展示期持 held
        // （_setCardZone 的 held 守卫只挡「解除停留」，不挡提前进入），settle 幂等收尾。
        if (resolveSpellFx(payload?.def?.id ?? payload?.skill?.defId ?? null)) {
          this.model.setZone(id, 'held');
          this.springs.release(id);
        }
        // 施术演出模板（fx/spells 动画逻辑生成器）：命中即接管停留窗，notify 时机
        // 由模板自选（小卡全程演完 / 大卡主体落定即通告、余烬后台散尽 / 实体锁强卡
        // 全程 hold）。未命中 = BASE 现行为（100ms 停留窗），零回归。
        const spell = this._runSpellFx(payload, view, settle);
        if (!spell) {
          this.animator.animate(id, {}, { // 停留节拍（纯延迟 tween）
            delayMs: 100,
            onComplete: settle,
          });
        }
      },
    });
  },
  /**
   * 施术演出发起（fx/spells 模板系统的舞台接线）：装 deps 服务袋（世界场景/
   * 粒子门面/灯池/震屏/单位锚/卡面世界点），交 runSpellFx 查决议链跑协程。
   * 目标解析：载荷 target（玩家指定）优先，缺省按显示态全体存活敌（AOE 语言）。
   * @returns {null | { done: Promise }} null = 未命中模板（_skillDisplay 走 BASE）
   */
  /** 施术演出 deps 服务袋的公共段（fx/spells 的舞台能力面）：施术节拍与伤害节拍共用。 */
  _spellDeps() {
    return {
      scene: this.scene,
      uiScene: this.uiScene,
      particles: this.particles,
      // 世界粒子池本体（专用类型组直发 burst——爆裂术爆炸云等「一次性大场面」
      // 不走 particles 门面的参数哈希路径）
      worldPool: this.particles2World ?? null,
      // 敌方阵型（显示态口径）：存活敌视图的质心 + 散布半径——AOE 大场面
      // （爆裂术爆炸云）的锚点，单敌时退化为该敌胸口
      enemyFormation: () => {
        const list = (this._snapshot?.enemies ?? [])
          .map(e => this._units.get(e.uniqueID))
          .filter(v => v && !v._dead);
        if (!list.length) return null;
        let cx = 0, cy = 0, cz = 0;
        for (const v of list) {
          const s = v._baseScale ?? 1;
          cx += v.position.x; cy += v.position.y + 3.4 * s; cz += v.position.z;
        }
        cx /= list.length; cy /= list.length; cz /= list.length;
        let spread = 0;
        for (const v of list) spread = Math.max(spread, Math.hypot(v.position.x - cx, v.position.z - cz));
        return { center: { x: cx, y: cy, z: cz }, spread };
      },
      cast: this._cast,
      shake: this.shake,
      animator: this.animator,
      unitById: (id) => this._units.get(id) ?? null,
      // 主角单位视图（自燃类施术的身体锚——配合 unitAnchor/unitFeet 使用）
      playerUnit: () => {
        const id = this._snapshot?.player?.uniqueID;
        return id != null ? (this._units.get(id) ?? null) : null;
      },
      // 效果层数读取（条件造型：burnSurge 只点燃烧中的单位——快照口径，演出不读真值）
      effectStacksOf: (unit, effectId) => {
        const id = unit?.uniqueID;
        if (id == null) return 0;
        const u = (this._snapshot?.enemies ?? []).find(x => x.uniqueID === id)
          ?? (this._snapshot?.player?.uniqueID === id ? this._snapshot.player : null);
        return u?.effects?.find(e => e.effectId === effectId)?.stacks ?? 0;
      },
      camera: this._sm.cameraDirector,   // 场景参数演出（天斩 fov 压迫/复原）
      markCleaveSplit: (units) => {   // 天斩断裂标记（死亡节拍消费）
        for (const u of units ?? []) this._cleaveSplit?.add(u.uniqueID);
      },
      // 投射物抵达追踪（施术拍登记 / 伤害拍 await——火花自持发射也走这里对齐时刻）
      projectiles: this._projectiles,
      // 主角施术锚 = 抬手高度（2026-10-01 用户定：火弹等投掷物从**主角这儿**飞出来，
      // 不从卡尖起飞——卡面是 UI，主角才是叙事上的施术者）。缺玩家视图时兜底卡尖。
      // （伤害拍自持投射物也用——火花乱射从手上弹出）
      playerAnchor: () => {
        const id = this._snapshot?.player?.uniqueID;
        const v = id != null ? (this._units.get(id) ?? null) : null;
        if (!v) return null;
        const s = v._baseScale ?? 1;
        return { x: v.position.x, y: v.position.y + 4.6 * s, z: v.position.z };
      },
    };
  },

  _runSpellFx(payload, view, notify) {
    const defId = payload?.def?.id ?? payload?.skill?.defId ?? null;
    if (!defId) return null;
    const sm = this._sm;
    const deps = {
      ...this._spellDeps(),
      cardView: view,
      targets: () => {
        const ids = payload?.target ? [payload.target]
          : this._targetPool('enemy').map(u => u.uniqueID);   // 缺省全体存活敌（显示态口径）
        return ids.map(id2 => this._units.get(id2)).filter(Boolean);
      },
      // 单位锚 = 立绘中心（血条同款高度基准 3.4×scale，z 随单位真实深度）
      unitAnchor: (unit) => {
        const s = unit._baseScale ?? 1;
        return { x: unit.position.x, y: unit.position.y + 3.4 * s, z: unit.position.z };
      },
      // 单位脚锚 = 落地爆心（火向上烧的爆发/光柱底部坐这里）
      unitFeet: (unit) => {
        const s = unit._baseScale ?? 1;
        return { x: unit.position.x, y: unit.position.y + 0.6 * s, z: unit.position.z };
      },
      // 卡面（uiScene）→ 世界点：ui 投影回屏再反投世界相机（战线附近深度），
      // 火弹/投射物从这里起飞
      cardTipWorld: () => {
        const p = view.position;
        const px = sm.worldToScreen(p.x, p.y, p.z, sm.uiCamera);
        return sm.screenToWorld(px.x, px.y, 24, sm.camera);
      },
    };
    try {
      return runSpellFx({ defId, deps, notify });
    } catch (err) {
      console.warn('[spellFx] 施术演出发起异常（回落 BASE）：', err);
      return null;
    }
  },

  // 资源消耗/获取节拍：数字跳动由 syncState 承担；消耗粒子是纯装饰并行拍，  // 立即 finish 不占队列。卡费消耗（带 skillUniqueID 归属）的爆散+汇聚已在
  // _skillDisplay 编排（先汇聚后发动），此处只补非卡来源消耗的纯爆散
  _resourceBeat(payload, finish) {
    finish();
    if (!payload || payload.delta >= 0 || !this._drainFx) return;
    if (payload.skillUniqueID) return;
    this._drainFx.playDrain({ kind: payload.kind, amount: -payload.delta });
  },
  // 结算宾语展示（转化前半）：从原位（牌库图标/手牌扇形）飞到中央展示位——
  // 高于发动展示位（y 4 > -2），同屏不叠卡。牌库来源视图常隐形且从未烘面：
  // 先以 bridge 代投影的 cardView 换脸再显形起飞（cardAdded 同款协议）。
  _showcaseBeat(payload, finish) {
    const id = payload?.card?.uniqueID ?? null;
    const view = id != null ? this._views.get(id) : null;
    if (!view) return finish(); // 无载体（异常/未来机制）：直接打节拍
    if (payload?.cardView) view.setCard(payload.cardView);
    view.visible = true;
    const sp = nextCardSpot();   // 中央错位：多宾语/与焚毁飞入错开（cardSpot.js）
    this.animator.animate(id, { x: sp.dx, y: 4 + sp.dy, z: 50, scale: 1.0 }, {
      durationMs: 240,
      onComplete: finish,
    });
  }

  /**
   * 卡牌转化/进阶的变换演出（fx/cardTransform.js，默认 charReveal：焦化→燃烧尾迹→
   * 白光新脸）。入口 = 手牌内被转化的对账路径（_syncCardContents 发现 defId 变化——
   * **换脸由演出接管**（落幕一刻 applyBakedFace，勿先 setCard）；展示/持有位的转化
   * 走 _transformBeat 的完整 staging。mode 参数留给日后多模式（注册表见 cardTransform.js）。
   */,
  _transformFx(id, card = null, onDone = null, mode = 'charReveal') {
    const view = this._views.get(id);
    if (!view || !card) { onDone?.(); return; }
    playCardTransform(view, card, { mode, bakeFace: this._bakeFace, onDone });
    // 体量呼吸裹在演出外（变换的重量感）：缓起 1.08 → 随白光收束回程
    const s0 = view.scale.x || 1;
    this.animator.animate(id, { scale: s0 * 1.08 }, {
      durationMs: 300, ease: 'power1.out',
      onComplete: () => this.animator.animate(id, { scale: s0 }, { durationMs: 420 }),
    });
  },
  // 转化闪变节拍（宾语身份跃迁的生效反馈主体）：蓄势下压 → 谷底起变换演出
  // （charReveal 双脸过渡接管换脸）→ 过冲弹起（演出并行）→ 回稳 → 新脸停留窗。
  // 停留窗对齐演出全长（820ms）：旧版 260ms 窗读不完白光收束后的新脸；且斩系
  // 打出进阶后紧跟 3 张碎铁造牌节拍（生成卡 z=70 刻意压在展示卡之上），不留
  // 停留窗的话新脸唯一的干净阅读时间就是本节拍自身。held/deck 来源卡不经
  // _syncCardContents（只扫手牌），换脸只能由本节拍承担。
  // （只扫手牌），换脸只能由本节拍承担。
  _transformBeat(payload, finish) {
    const id = payload?.card?.uniqueID ?? null;
    const view = id != null ? this._views.get(id) : null;
    if (!view) return finish();
    const s0 = view.scale.x || 1;
    this.animator.animate(id, { scale: s0 * 0.88 }, { // 蓄势下压（吸气）
      durationMs: 110,
      ease: 'power1.in',
      onComplete: () => {
        // 谷底起变换演出（charReveal 接管换脸——不再瞬时 setCard + 金爆，
        // 金光粒子的职责由燃烧尾迹/白光承担）
        if (payload?.cardView) {
          playCardTransform(view, payload.cardView, { bakeFace: this._bakeFace });
        }
        this.animator.animate(id, { scale: s0 * 1.42 }, { // 过冲弹起（跃迁感）
          durationMs: 170,
          ease: 'back.out(2.2)',
          onComplete: () => {
            this.animator.animate(id, { scale: s0 }, { // 回稳
              durationMs: 190,
              onComplete: () => {
                // 新脸停留窗对齐演出全长：谷底起 820ms 的 charReveal 跑完才放后续节拍
                this.animator.animate(id, {}, { delayMs: 460, onComplete: finish });
              },
            });
          },
        });
      },
    });
  },
};
