// 老虎机（slot）：转轮演出 + **恶魔 roll**（银行机超额取款的代价，演在老虎机上）+ **离房安慰奖**。
// 逻辑自 RoomStage 原样下沉——RoomStage 只做通用舞台机制，本模块不认识任何别的机器。
import * as THREE from 'three';
import { createSlotMachineRig } from '../scenes/interactive/slotMachineRig.js';
import { buildSlotPanel } from '../panels/index.js';
import { ChoiceBillboardObject } from '../objects/ChoiceBillboardObject.js';

// 恶魔 roll（银行机超额取款的代价）：灯池染暗红 + 词条卡片按等级分色（占位美术）
const DEMON_LAMP = 0x9a2432;
const DEMON_TIER_TINT = { yellow: 0xb08a3a, red: 0x9a3a3a, black: 0x3a2440 };
const DEMON_TIER_NAME = { yellow: '黄色级', red: '红色级', black: '黑色级' };

/**
 * 老虎机的取景主体（用户定 2026-09-12：**点击后要"屏幕怼脸"**）：只框**三根转轮窗口 + 拉杆**
 * （口径同 restGallery 的 focusMachine——这两件是这台机器的"脸"），不含底座/招牌/操作台，
 * 于是机器顶到脸上、上下自然出画。其它交互物仍按整件包围盒取景（默认）。
 */
function slotSubject(entry) {
  const reels = entry.parts?.reels ?? [];
  const mid = reels[Math.floor(reels.length / 2)];
  if (!mid) return null;
  const c = mid.getWorldPosition(new THREE.Vector3());
  const a = reels[0].getWorldPosition(new THREE.Vector3());
  const b = reels[reels.length - 1].getWorldPosition(new THREE.Vector3());
  const cell = Math.abs(a.x - b.x) / Math.max(1, reels.length - 1);
  let halfW = (Math.abs(a.x - b.x) + cell * 1.35) * 0.5;   // 窗口宽 + 单格余量
  let halfH = cell * 1.05 * 0.5;                            // 窗口高
  const lever = entry.parts?.leverPivot ?? null;
  if (lever) {                                              // 拉杆是侧面极限件，必须入画
    const lb = new THREE.Box3().setFromObject(lever);
    halfW = Math.max(halfW, Math.abs(lb.max.x - c.x), Math.abs(c.x - lb.min.x));
    halfH = Math.max(halfH, Math.abs(lb.max.y - c.y), Math.abs(c.y - lb.min.y));
  }
  // 投料口/计数器（吞噬入口 + 进度）在下半身：不框进来就会被底部操纵条盖住 →
  // 向下扩到它们（横向本来就在窗口宽度内，不会把主体拉宽）
  const crusher = entry.parts?.crusher ?? null;
  if (crusher) {
    for (const o of Object.values(crusher)) {
      if (!o?.isObject3D) continue;
      const cb = new THREE.Box3().setFromObject(o);
      halfH = Math.max(halfH, Math.abs(c.y - cb.min.y));
    }
  }
  return new THREE.Box3(
    new THREE.Vector3(c.x - halfW, c.y - halfH, c.z - 2),
    new THREE.Vector3(c.x + halfW, c.y + halfH, c.z + 2),
  );
}

/** 拉杆结果的落面：中奖让三根一致（读得出"中了"），未中奖随机——后端只给档位，没有符号概念。 */
function symbolsForTier(tier) {
  if (tier === 'major') return [1, 1, 1];   // 三个 7
  if (tier === 'minor') return [0, 0, 0];   // 三个樱桃
  return null;                              // 未中奖：随机面
}

export function createSlotMachine(ctx) {
  let gift = null;              // 安慰奖二选一演出件（惰性；见 _playGift）
  let demon = null;             // 恶魔 roll 状态机（见 _stepDemonRoll）
  let slotSpinId = null;        // 正在播的拉杆轮次 id（防重绘重播）
  let slotPoll = null;          // 转轮播完的轮询定时器

  /** 快照出现新的 spinning → 让机器自己转；播完回执 slotAnimDone（后端才揭示结果）。 */
  function _syncSpin() {
    // 「继续前进」的明度在 RoomStage._tick 里逐帧算（模态覆盖层/房间欠账两档），这里不再重复设置
    const s = ctx.snap()?.slot;
    const rig = ctx.rigs().get('slot');
    if (!s || !rig) return;
    // 计数器（翻牌）与进度满的"嘴张开"直接由快照驱动
    if (s.devour) rig.setDevour?.(s.devour);
    const spinning = s.spinning ?? null;
    if (!spinning) { slotSpinId = null; return; }
    if (spinning.id === slotSpinId) return;   // 同一轮已开播（重绘不重播）
    slotSpinId = spinning.id;
    const tier = spinning.tier ?? 'none';   // 'major' | 'minor' | 'none'（不是奖项种类）
    rig.pull({ tier, symbols: symbolsForTier(tier) });
    clearInterval(slotPoll);
    slotPoll = setInterval(() => {
      if (rig.isBusy()) return;
      clearInterval(slotPoll);
      slotPoll = null;
      slotSpinId = null;
      ctx.intent({ action: 'slotAnimDone', id: spinning.id });
    }, 120);
  }

  // ---- 恶魔 roll（银行机超额取款的代价）----
  // 用户定 2026-09-12：超额取款 → **视角立刻切到老虎机** → 机器切恶魔形态（关闸 → 换暗红盘
  // → 开闸，灯池同时染暗红）→ 自动开转 → 停稳后弹出三张词条卡片 → 点选其一 → 退场
  // （换回普通盘、灯效复原）→ 回银行机并回执宿主播"奖励到手"特写（那笔超额取款的金币）。
  // 状态机由 tick 推进（dt 驱动，与所有演出同一时基；不用定时器，免得被 rAF 节流坑）。
  function _syncDemonRoll() {
    const pr = ctx.snap()?.bank?.pendingRoll ?? null;
    const rig = ctx.rigs().get('slot');
    if (!rig) return;
    if (pr && !demon) _startDemonRoll(pr);
    else if (!pr && demon) {
      // 词条已选（快照里 pendingRoll 没了）→ 退场。若卡片还挂着（占位面板按钮选的）先收掉
      if (demon.phase !== 'exit') { demon.phase = 'exit'; demon.started = false; }
    }
  }

  function _startDemonRoll(pr) {
    demon = {
      phase: 'enter', started: false,
      gold: pr.gold, tier: pr.tier,
      options: (pr.options ?? []).map(o => ({ id: o.id, name: o.name, desc: o.desc, tier: o.tier })),
      picks: null,     // 选择阶段挂上的转轮热区 [{ id, optionId }]
    };
    // ① 视角立刻切到老虎机（玩家此刻站在银行机面板前）——推到位的回调里机器才开始关闸换盘
    if (ctx.focused() !== 'slot') ctx.focusMachine('slot');
    // ② 灯池染暗红 + 机器进恶魔风格（换盘本身由 demonEnter 的"关闸 → 换盘 → 开闸"时序做）
    ctx.room()?.lighting?.setLampTint?.(DEMON_LAMP, 1);
    ctx.rigs().get('slot')?.setDemonStyle?.(1);
  }

  /** 帧驱动相位推进：enter（关闸换盘）→ spin（自动开转）→ choose（转轮上等点选）→ exit（换回普通盘）。 */
  function _stepDemonRoll(dt) {
    const d = demon;
    if (!d) return;
    const rig = ctx.rigs().get('slot');
    if (!rig) { demon = null; return; }
    if (d.phase === 'enter') {
      if (!d.started) { if (rig.isBusy() || !rig.demonEnter?.()) return; d.started = true; return; }
      if (rig.isBusy()) return;
      d.phase = 'spin'; d.started = false;
    } else if (d.phase === 'spin') {
      if (!d.started) {
        // 恶魔 roll 不是中奖：tier 'none'（不亮中奖灯），三根盘各落一面
        if (!rig.pull({ tier: 'none', symbols: null })) return;
        d.started = true;
        return;
      }
      if (rig.isBusy()) return;
      d.phase = 'choose';
      _armDemonChoice(d);
    } else if (d.phase === 'exit') {
      if (!d.started) {
        _disarmDemonChoice();
        if (rig.isBusy() || !rig.demonExit?.()) return;
        d.started = true;
        return;
      }
      if (rig.isBusy()) return;
      rig.setDemonStyle?.(0);
      ctx.room()?.lighting?.setLampTint?.(null, 0);
      demon = null;
      if (ctx.markers().some(m => m.name === 'bank')) ctx.focusMachine('bank');   // 回到取钱的那台
      ctx.intent({ action: 'demonAnimDone' });                                    // 宿主播奖励特写
    }
  }

  /**
   * 恶魔 roll 的选择：**轮盘本身就是选项**（用户定 2026-09-13）。
   * 三根转轮各认一个词条——"轮盘转出来的东西就是诅咒本身"，所以悬停转轮弹该词条的 tooltip、
   * 点转轮即承受。此前是机器身前另浮出三张卡片，与转盘割裂，操纵条里又列一遍同样的信息
   * （用户报"重复呈现"）。取景用 `ctx.focusMachine('slot')` 的怼脸机位（slotSubject 已框住转轮窗），
   * 不再另拉一次相机。
   */
  function _armDemonChoice(d) {
    const machine = ctx.entryOf('slot');
    const reels = ctx.rigs().get('slot')?.demonTargets?.() ?? [];
    if (!machine || !reels.length || !ctx.picker()) return;
    const s = machine.scale ?? 1;
    const fwd = new THREE.Vector3(Math.sin(machine.ry ?? 0), 0, Math.cos(machine.ry ?? 0));
    // 机器"正面"平面沿 fwd 的距离：转轮鼓在机柜里，压边框/镜片都挡在它前面，
    // 所以隐形拾取面必须整体放到**整机最前沿之外**，否则射线先打到机身（kind:'machine'）。
    const bb = new THREE.Box3().setFromObject(machine.object);
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    const halfAlong = (Math.abs(size.x * fwd.x) + Math.abs(size.z * fwd.z)) / 2;
    d.picks = [];
    reels.forEach((reel, i) => {
      const o = d.options[i];
      if (!o) return;
      const rel = reel.getWorldPosition(new THREE.Vector3()).sub(center);
      const lateral = rel.addScaledVector(fwd, -rel.dot(fwd));   // 垂直分量（含竖直），保住转轮的左右/高低
      const at = center.clone().add(lateral).addScaledVector(fwd, halfAlong + 0.9 * s);
      // 与转轮同宽（单格 cellW≈0.8）不越界；透明面不参与视觉——用 opacity 0 而不是
      // visible:false，因为 Picker 会把 invisible 的对象滤掉（那就永远点不到了）。
      const proxy = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78 * s, 1.15 * s),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      proxy.name = `demonPick:${i}`;
      proxy.position.copy(at);
      proxy.lookAt(at.clone().add(fwd));
      proxy.userData.token = {
        type: 'item',
        payload: {
          title: o.name,
          body: `${o.desc}（恶魔词条 · ${DEMON_TIER_NAME[o.tier] ?? o.tier}）`,
          tint: DEMON_TIER_TINT[o.tier] ?? DEMON_TIER_TINT.black,
        },
      };
      ctx.room()?.group.add(proxy);
      const id = `room:demon:${i}`;
      ctx.picker().addPickable(id, proxy, { kind: 'demon' });
      d.picks.push({ id, optionId: o.id, proxy });
    });
  }

  /** 撤掉转轮热区（含 tooltip token 与隐形拾取面）——选择阶段结束/退场都要走，否则空热区还能点到。 */
  function _disarmDemonChoice() {
    const d = demon;
    for (const p of d?.picks ?? []) {
      ctx.picker()?.removePickable(p.id);
      p.proxy?.parent?.remove(p.proxy);
      p.proxy?.geometry?.dispose();
      p.proxy?.material?.dispose();
    }
    if (d) d.picks = null;
  }

  /** 恶魔 roll 未选就想走：钱已经到手，先把词条领了——镜头拉回老虎机 + 泡泡。 */
  function _nudgeDemonRoll() {
    if (ctx.focused() !== 'slot') ctx.focusMachine('slot');
    const entry = ctx.entryOf('slot');
    if (!entry) return;
    ctx.bubbles().say('room:demon', {
      ...ctx.midAnchorOf(entry, 1.5),
      text: '恶魔 roll 还没选词条呢。',
      kind: 'thought',
      duration: 2.6,
      tint: 0xff9a9a,
    });
  }

  // ---- 离房安慰奖 ----

  /**
   * **离房安慰奖演出**（用户定 2026-09-12）：点「继续前进」且快照里欠着安慰奖时，
   * ① 相机推到**出料口**；② 机器"吐出"两件 billboard（可乐/鸡腿，暂无美术 = 纯色块 + 白字）；
   * ③ 点选其一 → 选中件朝镜头飞出、另一件缩没；④ 播完上行 `slotTakeGift`（宿主结算 +
   * 播获得物特写，**并自动把这次离房接着走完**——用户定 2026-09-13：领取不进任何 UI，
   * 面板里既没有进度也没有按钮，玩家点一次「继续前进」就把整条链走到底）。
   * @returns 是否已接手这次点击（true = 别离房，等演出与获得特写跑完由宿主离房）
   */
  function _playGift() {
    const items = ctx.snap()?.slot?.gift;
    if (!Array.isArray(items) || !items.length) return false;
    if (gift) return true;                             // 已在演：吞掉重复点击
    const machine = ctx.entryOf('slot');
    if (!machine) return false;
    // 取景以**两件货**为主体：摆位 = 机器腰高、身前 6.5（贴出料口摆会被底部操纵条盖住，
    // 且镜头对着出料口时两件货在画面外），机器留在背景里当上下文
    const { spot, dist, fwd } = _billboardStage(machine, items.length * 3.0 + 4.35);
    const position = spot.clone().addScaledVector(fwd, dist);
    const m = new THREE.Matrix4().lookAt(position, spot, new THREE.Vector3(0, 1, 0));
    ctx.startCamTween(
      { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) },
      0.5,
      () => _spawnGift(items, spot),
    );
    // 演出期间抑制机器常驻抖动（怼脸看细节）
    for (const rig of ctx.rigs().values()) rig.setFocus?.(false);
    return true;
  }

  /**
   * 机器前"摆一排 billboard"的取景处方（安慰奖两件 / 恶魔词条三张共用）：
   * @returns { spot, dist, fwd } spot = 卡片组的中心落点（机器腰高、身前 6.5），
   *   dist = 相机距离（**按卡片组总宽反解**：三张一排比两张宽，不按宽度退远会切边），
   *   fwd = 机器朝向（相机沿它后退）。
   */
  function _billboardStage(machine, totalW) {
    const fwd = new THREE.Vector3(Math.sin(machine.ry ?? 0), 0, Math.cos(machine.ry ?? 0));
    const mbox = new THREE.Box3().setFromObject(machine.object);
    const mid = mbox.getCenter(new THREE.Vector3());
    const spot = new THREE.Vector3(machine.x, mid.y + 0.5, machine.z).addScaledVector(fwd, 6.5);
    const vFov = THREE.MathUtils.degToRad(ctx.camera()?.fov ?? 24);
    const aspect = ctx.camera()?.aspect || (16 / 9);
    const distW = (totalW * 1.18) / (2 * Math.tan(vFov / 2) * aspect);
    const dist = Math.max(18, distW, mbox.getSize(new THREE.Vector3()).y * 1.15);
    return { spot, dist, fwd };
  }

  /** 生成两件占位货（机器腰高、身前；每一件面向相机漂浮），并登记拾取。 */
  function _spawnGift(items, spot) {
    if (gift) return;
    gift = new ChoiceBillboardObject({
      items: items.map(it => ({ id: it.id, name: it.name, sub: it.effect, tint: it.tint })),
      size: 3.0,
      onPick: (id) => {
        ctx.intent({ action: 'slotTakeGift', choice: id });
        _removeGift(0.5);
      },
    });
    gift.position.copy(spot);
    ctx.room()?.group.add(gift);
    gift.attachPicker(ctx.picker());
  }

  function _removeGift() {
    if (!gift) return;
    ctx.room()?.group.remove(gift);
    gift.dispose();
    gift = null;
  }

  function _onExit() {
    clearInterval(slotPoll);
    slotPoll = null;
  }

  return {
    kinds: ['slot'],
    createRig: (entry) => createSlotMachineRig({ object: entry.object, parts: entry.parts }),
    // 怼脸处方：主体（转轮窗 + 拉杆 + 下半身的投料口/计数器）占屏 0.88，底边抬到 0.26
    // ——窗口顶到上缘、操作区露在操纵条之上（操纵条占屏幕下沿 ~25%）
    focusOf: () => ({ fracH: 0.88, bottom: 0.26, pad: 0.92, subject: slotSubject }),
    panel: (name, snap) => buildSlotPanel(snap, { sceneChoice: true }),

    /** 老虎机正面的**投料口/计数器**热区（rig 给的可点件）：点它就是"粉碎物品"入口。 */
    registerPickables() {
      const slotRig = ctx.rigs().get('slot');
      (slotRig?.crusherTargets?.() ?? []).forEach((obj, i) => {
        ctx.addPickable(`room:crusher:${i}`, obj, { kind: 'machine' });
      });
    },

    /** 快照 → rig/演出状态（恶魔 roll 起止 + 拉杆轮次）。 */
    sync() {
      _syncDemonRoll();
      _syncSpin();
    },

    /** 帧驱动：恶魔相位机 + 安慰奖 billboard 面向相机 + 浮动。 */
    tick(dt) {
      _stepDemonRoll(dt);
      gift?.update(dt, ctx.camera());
    },

    /** 吞掉型 hover：安慰奖演出中只认两件货。 */
    handleHover(hit) {
      if (!gift?.active) return false;
      gift.onHover(hit);
      return true;
    },

    /** pointerUp 点选（先于 pickerKit 路由）：安慰奖演出中选一件货。 */
    handlePointerUp(hit) {
      if (!gift?.active) return false;
      const id = gift.pickIndexOf(hit);
      if (id) gift.choose(id);
      return true;
    },

    /** 吞掉型点击：恶魔词条（转轮热区）+ 投料口。 */
    handleClick(hit) {
      // 恶魔 roll 选择阶段：点**转轮本身**即承受那根盘对应的词条（转出来的就是诅咒）
      if (hit?.kind === 'token' && demon?.phase === 'choose' && hit.id?.startsWith('room:demon:')) {
        const pick = demon.picks?.find(p => p.id === hit.id);
        if (pick) ctx.intent({ action: 'bankPick', id: pick.optionId });
        return true;
      }
      // 投料口：进度满 = 直接进"粉碎物品"链（对话 → 选卡/遗物）；没满就先聚焦机器（看得出还差几次）
      if (hit?.id?.startsWith('room:crusher:')) {
        const rig = ctx.rigs().get('slot');
        if (rig?.devourReady?.()) { ctx.intent({ action: 'requestDevour' }); return true; }
        ctx.focusMachine('slot');
        return true;
      }
      return false;
    },

    /** 义务门贡献：恶魔 roll 挂着 = 硬拦离房（'demon'）；产出没处理完也拦（'prize'，
     *  2026-09-22 qa 修：此前 pending 挂着照样能离房，产出静默丢弃成幽灵奖项）。 */
    pendingDuty: () => (ctx.snap()?.bank?.pendingRoll ? 'demon'
      : (ctx.snap()?.slot?.pending ? 'prize' : null)),

    /** 点「继续前进」时接管：恶魔词条未选 → 拉回镜头提示；产出未处理 → 同样拉回提示；
     *  安慰奖未领 → 演完再离房。 */
    onContinue() {
      if (ctx.snap()?.bank?.pendingRoll) { _nudgeDemonRoll(); return true; }
      if (ctx.snap()?.slot?.pending) {
        if (ctx.focused() !== 'slot') ctx.focusMachine('slot');
        const entry = ctx.entryOf('slot');
        if (entry) ctx.bubbles().say('room:slot', {
          ...ctx.midAnchorOf(entry, 1.5),
          text: '机器还吐着一份奖励呢——收下或者放弃它。',
          kind: 'thought',
          duration: 2.6,
          tint: 0xffd75e,
        });
        return true;
      }
      if (_playGift()) return true;
      return false;
    },

    /**
     * 播一次**粉碎演出**（编排器在吞噬结算后调用）：把镜头拉回老虎机（粉碎口在下半身，
     * 玩家可能正看着别的机器/面板）→ rig 咬合 + 迸币。纯表现，不影响结算。
     */
    playCrush() {
      const rig = ctx.rigs().get('slot');
      if (!rig?.crush) return false;
      if (ctx.focused() !== 'slot') ctx.focusMachine('slot');
      ctx.startCamTween(ctx.focusPoseFor('slot'), 0.45, () => rig.crush());
      return true;
    },

    onExit() { _onExit(); },
    dispose() {
      _onExit();
      _removeGift();
      _disarmDemonChoice();
    },
  };
}
