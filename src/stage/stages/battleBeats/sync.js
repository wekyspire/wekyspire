// 视图同步域（BattleStage 原型混入，this = BattleStage 宿主）：
// 显示状态快照 → 视图对账（单位/卡牌区/按钮/名单标记）。两套状态设计的消费端——
// 后端状态即时变、显示状态随 ANIM_STATE_SYNC 节拍变，时序由 sync 指令位置表达。

import * as THREE from 'three';
import { UnitObject } from '../../objects/UnitObject.js';
import { CardObject } from '../../objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from '../../objects/cardMetrics.js';
import { slotTransform } from '../../scenes/index.js';
import { resolveUnitAuras } from '../../fx/recipes.js';
import { AuraHost } from '../../fx/aura.js';
import { attachOrbs } from '../../fx/orbs.js';
import { getEnemyDefinition } from '../../../core/enemies/registry.js';
import { unitHeightFactor, STANDEE_BASE_HEIGHT } from '../../art/unitArt.js';

export const syncBeats = {
  // 显示状态只在 ANIM_STATE_SYNC 节拍推进：应用快照 + reconcile，立即 finish。
  // 快照带显示时刻序号（bridge 投影重算序号），应用记录单调推进——
  // 早于已应用时刻的历史快照直接丢弃（见 applyProjection 的说明）
  _applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.seq != null && snapshot.seq < this._snapshotSeq) return;
    if (snapshot.seq != null) this._snapshotSeq = snapshot.seq;
    this._snapshot = snapshot;
    // 终局那拍（verdict 落定）直接压暗常驻 HUD 按钮：终局后 sync 停更，停在最后
    // 一拍的按钮态是"玩家回合亮态"（奖励模态有 setPanel 压暗兜着，败北面板是
    // Vue 层不走 setPanel——夜测 r2路2 实测败北侧按钮全亮可点样式误导）。
    if (snapshot.verdict != null) {
      for (const btn of Object.values(this._buttons)) btn?.setVisualState?.('disabled');
    }
    // 换回合解锁「结束回合」的已点标记：**只认新的玩家回合**（'player:N' 变化）。
    // 敌方侧快照（side 变 'enemy'）不能解锁——否则敌方阶段的动画积压期手牌提前解禁，
    // 又能"抢着"打出下一回合的牌（实报的误操作窗口）
    const key = `${snapshot.turn?.side ?? '?'}:${snapshot.turn?.count ?? -1}`;
    if (this._endTurnRequested && snapshot.turn?.side === 'player' && key !== this._endTurnLockKey) {
      this._endTurnRequested = false;
    }
    // 弃牌选择集随快照对账：已不在手牌的 id 摘除（已弃/已打出/被效果移走）；
    // 已激活咏唱同样摘除（咏唱不可弃。迷你卡照常可弃——只管手牌计数）
    if (this._dumpSel.size) {
      const freeIds = new Set(
        snapshot.hand?.filter(c => !c.isActivated)
          .map(c => c.uniqueID) ?? []);
      for (const id of [...this._dumpSel]) if (!freeIds.has(id)) this._dumpSel.delete(id);
    }
    this.reconcile();
  }

  /** 直接应用投影快照（不经动画队列）：幕间黑幕预载用——黑幕后即建好单位/卡牌
   *  视图（预取已热的素材同步命中），揭幕所见即成品。预载把显示状态推到"现在"，
   *  此后队列重放的更早 sync 节拍（如 battleStart 在起手抽牌前捕获的空手牌快照）
   *  被单调守卫丢弃；同刻/更新的快照重放幂等无副作用。 */,
  applyProjection(snapshot) {
    this._applySnapshot(snapshot);
  },
  reconcile() {
    const proj = this._snapshot;
    if (!proj) return;
    this._closeViewer(); // 状态已变，查看器内容失效
    const overlayReq = proj.pendingInput?.request?.picker === 'overlay' ? proj.pendingInput.request : null;
    if (overlayReq) this._openPick(overlayReq);   // 幂等（同一 request 不重建）
    else this._closePick();
    this._syncUnits(proj);
    this._syncCardZones(proj);
    this._syncCardContents(proj);
    this._syncButtons(proj);
    this._resources.ap.setValue(proj.player.actionPoints, proj.player.maxActionPoints);
    this._resources.mana.setValue(proj.player.mana, proj.player.maxMana);
    // 状态栏血量：角色取投影玩家；瑞米区取投影盟友（当前内容只有 remi；血量走
    // 盟友实时值，攻/盾横幅暂走状态栏展示常量——行为定义未暴露面板数值）
    this._statusBar.setPlayerHp(proj.player.hp, proj.player.maxHp);
    this._statusBar.setPlayerShield(proj.player.shield);
    const remi = proj.allies.find(a => a.defId === 'remi');
    this._statusBar.setRemi(remi ? { present: true, hp: remi.hp } : { present: false });
    this._piles.deck.setCount(proj.counts.deck);
    this._capacityBeads.setValue(proj.handCapacity); // 灯珠（批次 13）：与投影同口径，旧快照无此字段时静默跳过
    this._capacityBeads.setHover(this._capFootprintOf(this._overCardId)); // 手牌变动后 hover 足迹重算（珠位随占用重排）
    this._layoutAndTrack();
    this._updatePendingPips(); // 悬浮卡可能已离场/资源已变，重算高亮
    this._refreshShiftFace();  // 详情态目标可能已离场（差分自动还原）
    this._updateDoomMarks();   // 将弃名单随快照变化（新视图补挂/离场视图摘除）
    this._updateLockMarks();   // 锁定名单随快照变化（常驻标记，同上对账）
  },
  _syncUnits(proj) {
    const seen = new Set();
    // count = 整排数量（含已阵亡者）：槽位按数量均分，倒下不挪位（见 scenes/index.js）
    const place = (unitProj, side, index, count = 1) => {
      seen.add(unitProj.uniqueID);
      let obj = this._units.get(unitProj.uniqueID);
      if (!obj) {
        obj = new UnitObject({
          uniqueID: unitProj.uniqueID, side,
          standeeHeight: STANDEE_BASE_HEIGHT * unitHeightFactor(unitProj.defId, side),
          bakeLabel: this._bakeUnitLabel,
          textureAnisotropy: Math.min(8, this._smMaxAnisotropy()),
        });
        obj._defId = unitProj.defId;
        // L0 本体补丁由 UnitFxLayer 在 UnitObject 构造时挂好（VFX Phase 2 收口）
        this._units.set(unitProj.uniqueID, obj);
        this.scene.add(obj);
        this.animator.register(unitProj.uniqueID, obj);
        this.picker.addPickable(unitProj.uniqueID, obj, { kind: 'unit' });
        this._applyUnitArtTo(obj);
        // 多部件挂接（fx Phase 5）：敌人 def 声明 orbs → 环绕火球部件（'orbs'，剧本可寻址）
        if (side === 'enemy') {
          const orbsDef = getEnemyDefinition(unitProj.defId)?.orbs;
          if (orbsDef) attachOrbs(obj, orbsDef); // headless 无画布返回 null，跳过即安
        }
      }
      // cast 命名寻址登记（幂等；同句柄重登不告警）
      this._cast.register(`unit:${unitProj.uniqueID}`, obj);
      if (side === 'player') this._cast.register('role:player', obj);
      // 战线轴槽位：位置/缩放/z 由 scene 定义换算（假透视：近大远小、近处压远处）。
      // 死亡单位不重放 scale——否则 reconcile 会把死亡收殓补间踩回去
      const tr = slotTransform(this._sceneDef, side, index, count);
      obj.position.set(tr.x, tr.y, tr.z);
      obj._baseScale = tr.scale;
      if (!unitProj.isDead) obj.scale.set(tr.scale, tr.scale, 1);
      // 失明（银行机恶魔词条）：敌人意图不可见 → 清空意图条（玩家只能靠猜）
      obj.setUnit(proj.blind && side === 'enemy' ? { ...unitProj, intention: null } : unitProj);
      // 常驻 aura 对账（显示状态 diff 驱动）：燃烧等状态光环随投影挂上/摘除
      let auras = this._unitAuras.get(unitProj.uniqueID);
      if (!auras) {
        auras = new AuraHost({ object3D: obj });
        this._unitAuras.set(unitProj.uniqueID, auras);
      }
      const resolved = resolveUnitAuras(
        // ⚠ 真死单位解空效果表（在挂 aura 走 exit 收殓）——否则尸体隐藏后 aura 仍活，
        // 燃烧发射器在尸体锚点上永远撒火星（验收 agent 抓：烧死的怪原地
        // 喷火星 15s+）。时机天然对齐：死亡节拍「先演后变」，快照带上 isDead 时尸体
        // 恰好收殓隐藏。假死（reviving）不在此列——复苏后仍在烧，aura 保持。
        unitProj.isDead && !unitProj.reviving ? [] : unitProj.effects,
        { particles: this.particles, unit: obj, gpu: this._burnLink });
      auras.set(resolved);
      // 存续 aura 的强度追层数：set() 只管增删，burn level 等随 stacks 的更新走
      // def.update（stacks 3→7 火焰随旺；无 update 钩的 def 不受影响）
      for (const [key, def] of resolved) {
        const aura = auras.get(key);
        if (aura && typeof def.update === 'function') {
          def.update(aura, unitProj.effects.find((e) => e.effectId === key));
        }
      }
    };
    place(proj.player, 'player', 0, 1);
    proj.allies.forEach((a, i) => place(a, 'ally', i, proj.allies.length));
    proj.enemies.forEach((e, i) => place(e, 'enemy', i, proj.enemies.length));
    this._syncPlayerSwordArt(proj);
    // L0 本体补丁程序入场预热：首个同步批就把变体编好（compileAsync 走
    // KHR_parallel_shader_compile 不冻主线程——charBurn 的 715ms 教训；单位本体是
    // MeshBasicMaterial 小 shader，但一次性成本照样不留进演出）
    if (!this._bodyFxWarmed && this._units.size > 0) {
      this._bodyFxWarmed = true;
      const r = this._sm?._renderer;
      const warm = r?.compileAsync?.(this.scene, this._sm.camera);
      if (!warm) r?.compile?.(this.scene, this._sm.camera);
    }
    for (const [id, obj] of this._units) {
      if (!seen.has(id)) {
        this.picker.removePickable(id);
        this.animator.unregister(id);
        this._cast.unregister(`unit:${id}`, this._units.get(id));
        this._unitAuras.get(id)?.dispose(); // 单位视图消亡：aura 瞬收（不播 exit）
        this._unitAuras.delete(id);
        this.scene.remove(obj);
        obj.dispose();
        this._units.delete(id);
      }
    }
  }

  /**
   * 尸体稳态收殓：把「快照已判死、视图却仍站着」的单位直接落到死后稳态（隐藏）。
   * 正常路径不受影响（死亡演出播毕已隐藏，本方法幂等跳过）。
   * 用途：**中途接入/跳段的播放端**——死亡演出节拍不在队列里，只剩快照的 isDead，
   * 不补的话尸体会带着 0/xx 血条一直站着（观战端重放/接入已见）。
   * 与「动画不可序列化 → 读档/恢复落到稳态」同一口径，故实现在 Stage 而非某个页面。
   * @returns 本次收殓的尸体数
   */,
  settleCorpses() {
    const snap = this._snapshot;
    if (!snap) return 0;
    let n = 0;
    const all = [...(snap.enemies ?? []), ...(snap.allies ?? [])];
    for (const u of all) {
      if (!u?.isDead) continue;
      const view = this._units.get(u.uniqueID);
      if (!view || view.visible === false) continue;
      view.hideIntention?.();
      view.hideStatus?.();
      if (u.reviving) {
        // 假死稳态：落到 82° 倒地留尸（跳段/中途接入端与实时端同一稳态语言）
        view.billboard.rotation.x = -THREE.MathUtils.degToRad(82);
        continue;
      }
      view.visible = false; // 稳态 = 焚毁演出终态（整体退场；reconcile 不重置 visible）
      n++;
    }
    return n;
  },
  // 全 zone 对账（持久模型）：新卡建条目+建视图（各一次），zone 按快照刷新。
  // burnt zone 不参与——焚毁节拍销毁视图/出册后不再重生（未来"焚毁区捞回"机制
  // 到来时由其专属节拍重建）。快照各 zone 与 held 都没有的注册卡 = 上游丢节拍的
  // 绊线（warn + 收尸），正常流程不应触达。
  _syncCardZones(proj) {
    const lists = {
      hand: proj.hand.map(c => c.uniqueID),
      deck: proj.zones.deck.map(c => c.uniqueID),
    };
    const present = new Set();
    for (const [zone, ids] of Object.entries(lists)) {
      for (const id of ids) {
        present.add(id);
        this._setCardZone(id, zone);
      }
    }
    // 结算区（pending，发动中的卡）：模型标 'held'（展示位停留，不回手牌锚点）——
    // 纯标签直写（同 _skillDisplay 的 held 分支），不走 _setCardZone 的隐形停车分支
    for (const id of proj.pending ?? []) {
      present.add(id);
      if (this.model.getZone(id) !== 'held') {
        this.model.setZone(id, 'held');
        this.springs.release(id); // 离手即摘弹簧目标：不被拉回手牌锚点
        this.picker.removePickable(id);
      }
    }
    for (const id of this.model.cards.keys()) {
      if (present.has(id) || this.model.getZone(id) === 'held') continue;
      console.warn('[stage] 注册卡不在任何显示 zone（上游丢节拍？）', id, this.model.getZone(id));
      this._destroyView(id);
      this.model.removeCard(id);
    }
  },
  // zone 迁移：模型推进（状态权威）+ 视图随动。进牌库 = 隐形停车 +
  // 摘除拾取；进手牌的显形与烘面在 _syncCardContents（惰性）。
  _setCardZone(id, zone) {
    // 'held'（展示毕待离场）是 hand 的显示位精化：sync 对账不得解除停留，
    // 解除只属于离场节拍（届时写入真正的去向 zone）或咏唱回手节拍
    // （ANIM_CHANT_TOGGLED——卡结算后回手牌，非离场）——否则折返跟踪复活
    if (this.model.getZone(id) === 'held' && zone === 'hand') return;
    const change = this.model.setZone(id, zone);
    const view = this._ensureView(id);
    if (!change) return;
    if (zone !== 'hand') {
      // 离手即摘弹簧目标（同 _skillDisplay 的 held 分支）：目标表只在 sync 节拍
      // 重算，不即刻摘除的话空窗期 idle 卡会被拉回手牌锚点（回归病灶）
      this.springs.release(id);
      view.visible = false;
      this.picker.removePickable(id);
    } else if (change.from !== 'held') {
      // 入场（牌库 → 手牌）：标记待飞——锚点在 _layoutAndTrack 算出后起飞
      this._entering.add(id);
    }
  },
  // 视图惰性建：停在牌库 pile 锚点（scale 0.5、隐形）——抽牌"从牌库长开飞入"
  // 的入场视觉由其后的跟踪补间天然给出；牌库中的卡永不烘面（省 canvas）。
  _ensureView(id) {
    let view = this._views.get(id);
    if (view) return view;
    view = new CardObject({ uniqueID: id, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace });
    const anchor = this.layout.getNamedAnchor('deck');
    view.position.set(anchor.x, anchor.y, 0);
    view.scale.set(0.5, 0.5, 1);
    view.visible = false;
    this._views.set(id, view);
    this.uiScene.add(view);
    this.animator.register(id, view);
    return view;
  },
  // 视图终结（焚毁 / 绊线收尸）：出视图表 + 摘拾取 + 注销 + 销毁
  _destroyView(id) {
    const view = this._views.get(id);
    if (!view) return;
    this._views.delete(id);
    this.picker.removePickable(id);
    this.animator.unregister(id);
    this.springs.release(id); // 弃管即刻化：不等弹簧 update 的惰性清理
    this.uiScene.remove(view);
    view.dispose();
  },
  // 在场卡（手牌）内容同步：显形 + 惰性烘面 + 拾取注册 + 激活流光 + 威力脉冲 + 冷却盖纱
  _syncCardContents(proj) {
    const present = new Map();
    for (const c of proj.hand) present.set(c.uniqueID, { card: c, zone: 'hand' });

    for (const [id, { card, zone }] of present) {
      const entry = this.model.get(id);
      if (!entry) continue; // _syncCardZones 先行保证了存在；缺席即绊线已 warn
      const view = this._views.get(id);
      view.visible = true;
      this.picker.addPickable(id, view, { kind: 'card', cardObject: view, space: 'ui' });
      const sig = JSON.stringify([card.defId, card.name, card.power, card.text, card.textAlt, card.isActivated, card.cost]);
      if (entry.faceSig !== sig) {
        entry.faceSig = sig;
        // defId 变化 = 转化/进阶（如斩→裂石斩）：走变换演出（手牌内的转化路径，
        // 展示位/持有位的转化另走 ANIM_CARD_TRANSFORMED 节拍）——叠层双脸过渡
        // 接管换脸（落幕一刻才 applyBakedFace，见 fx/cardTransform.js），不经 setCard
        const defChanged = entry.prevDefId != null && entry.prevDefId !== card.defId;
        if (defChanged) {
          this._transformFx(id, card);
        } else {
          view.setCard(card);
          // 威力提升 → 金色脉冲（non-blocking，不进动画队列）
          if (entry.prevPower != null && (card.power ?? 0) > entry.prevPower) {
            this._pulseCard(id, 0xffd34c);
          }
        }
      }
      entry.prevDefId = card.defId;
      entry.prevPower = card.power ?? 0;
      // 咏唱激活态 → 边缘流光（双态开关：手牌中的 isActivated 卡，幂等）
      view.setActiveGlow(zone === 'hand' && !!card.isActivated);
      // 冷却薄纱（特效层持久指示，高度 = 剩余冷却比例：全灰=刚入冷、半灰=冷了一半）+
      // 剩余拍数水印（第三版视觉）；衰败推深超基准 = 暗红薄纱
      const max = card.charges?.max ?? Infinity;
      const cdTurns = card.charges?.cooldownTurns ?? 0;
      const cooling = card.remainingUses < max;
      const decayed = cooling && card.currentCooldown > cdTurns;
      let coolFrac = 0;
      if (cooling && cdTurns > 0) {
        const beatsLeft = (card.currentCooldown ?? 0)
          + (max === Infinity ? 0 : Math.max(0, max - 1 - card.remainingUses) * cdTurns);
        coolFrac = Math.min(1, beatsLeft / ((max === Infinity ? 1 : max) * cdTurns));
      }
      view.fx.setCooling(decayed ? 'decayed' : (cooling ? 'cooling' : null),
        card.currentCooldown ?? 0, coolFrac);
    }
  },
  _syncButtons(proj) {
    const pending = proj.pendingInput?.request ?? null;
    // 「在玩家的回合里」：**按回合轨道判定而非 waitingPlayerInput**。
    // waitingPlayerInput 是"内核当下是否挂着玩家回合的 WAIT"——一次出牌的结算过程中
    // 会瞬间为 false（演出节拍捕获的快照因此把它拍成 false），于是**动画积压期按钮是灰的**，
    // 玩家打完牌想收尾只能干等动画放完。改用 turn.side/count（整回合稳定不变）+ 已点标记：
    //   · count ≥ 1 才认（开局发牌那一拍 count=0，不给你"还没看到牌就把回合结束掉"）；
    //   · 点过结束回合 → 立刻上灰，直到下一回合的快照落定才解锁；
    //   · verdict 置位（终局演出中）后不再可点。
    const inPlayerTurn = proj.turn?.side === 'player' && (proj.turn?.count ?? 0) >= 1
      && proj.verdict == null;

    // 主按钮：结束回合；弃牌模式/结算期退化为确认/选择提示
    let label = '结束回合';
    let enabled = inPlayerTurn && !pending && !this._endTurnRequested;
    if (this._dumpMode) {
      // 弃牌模式：主按钮 = 确认全弃（付一次阶梯费弃掉全部手牌，D3 改制）
      const n = this._dumpSel.size;
      label = n > 0 ? `弃掉全部${n}张` : '弃牌';
      enabled = n >= 1;
    } else if (this._pick) {
      const n = this._pick.selection.length;
      const { min, max } = this._pick;
      const need = min === max ? `${min}` : `${min}~${max}`;
      label = `确认(${n}/${need})`;
      enabled = n >= min && n <= max;   // 到 min 即可提交（「至多 N」的上限由收集侧封顶）
    } else if (pending?.kind === 'confirm') { label = '确认'; enabled = true; }
    else if (pending?.kind?.startsWith('select')) {
      // 多选（max>1）一律走覆盖层（`_pick` 分支在上，见 _openPick）；落到这里的只可能是
      // 单手牌点选 —— 无按钮语义，点牌即应答（min/max 是规范字段，勿再读已废弃的 count）
      label = '选择目标'; enabled = false;
    }
    this._setButtonState('main', { label, enabled });

    // 弃牌模式只在玩家的自由行动窗存活：窗口关闭（结算输入/回合外/回合过渡锁）自动退出
    // （直接摘旗，不走 _setDumpMode——它内部会重入本函数）
    if (!inPlayerTurn || pending || this._endTurnRequested) { this._dumpMode = false; this._dumpSel.clear(); }
    const cost = proj.swapCost;
    // 弃牌同样按回合轨道判定（动画期可点）；费用用显示态估算，真正的可用性由 core 的
    // canDumpCards 兜底（点不动就静默失败）。反复点按钮只是"进入/取消模式"的开关（无害）。
    // 回合过渡锁（_endTurnRequested）期间弃牌一并关闭——与打牌同一把锁
    const canDump = inPlayerTurn && !pending && !this._endTurnRequested && proj.hand.length > 0
      && proj.player.actionPoints >= cost;
    this._setButtonState('swap', {
      label: '弃牌', sublabel: `⚡${cost}`, enabled: canDump, active: this._dumpMode,
    });
  },
  // 按钮数据/悬停签名去抖：内容不变不重烘（牌面烘焙有 canvas 成本）。
  // `data` 缺省 = 复用上一次的数据（悬停态变化时只改 active，不必让调用方重算整套数据）。
  _setButtonState(key, data) {
    if (data) this._btnData[key] = data;
    const base = this._btnData[key];
    if (!base) return;
    const hover = !!this._btnHover[key];
    const sig = JSON.stringify({ ...base, hover });
    if (this._buttonSigs[key] === sig) return;
    this._buttonSigs[key] = sig;
    const btn = this._buttons[key];
    // 悬停 → 按钮面走 active 主题（与面板按钮 hover 同一条路）；disabled 主题优先，灰按钮不亮
    btn.setCard({ ...base, active: !!base.active || hover });
    btn.setVisualState(base.enabled ? 'normal' : 'disabled');
  },
  // 「将弃」预告（Three 层特效）：hover 结束回合按钮时，给 P9 会被
  // 尾弃的手牌挂红色呼吸描边（CardFxLayer.setDoomed）。名单来自投影 overflowVictims
  // （与核心清理同一算法），只在玩家自由行动窗展示——已点结束回合（锁）/结算期都不亮
  _updateDoomMarks() {
    const victims = (!!this._btnHover.main
      && this._snapshot?.turn?.side === 'player'
      && !this._snapshot?.pendingInput
      && !this._endTurnRequested
      && (this._snapshot?.overflowVictims?.length ?? 0) > 0)
      ? new Set(this._snapshot.overflowVictims) : null;
    for (const [id, view] of this._views) {
      const on = !!victims?.has(id);
      if (!!view._doomOn !== on) { view._doomOn = on; view.setDoomMark(on); }
    }
  },
  // 「锁定」标记（无人战体「解除威胁/反反反反制」）：被锁定的手牌挂琥珀四角括号
  // （CardFxLayer.setLocked）——常驻展示（区别于将弃的 hover 触发：锁定持续整个回合，
  // 玩家要看着它决定打出还是留下）。名单来自投影 hand[].locked。
  _updateLockMarks() {
    const locked = this._snapshot?.hand?.filter(c => c.locked) ?? null;
    const set = locked?.length ? new Set(locked.map(c => c.uniqueID)) : null;
    for (const [id, view] of this._views) {
      const on = !!set?.has(id);
      if (!!view._lockOn !== on) { view._lockOn = on; view.setLockMark(on); }
    }
  },
};
