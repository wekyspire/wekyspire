// 指针输入域（BattleStage 原型混入，this = BattleStage 宿主）：
import { setCardShiftDown } from '../../objects/CardObject.js';
// hover/拖拽/瞄准/Shift 详情/滚轮 + 目标池与判定。App.vue 指针路由进 handlePointer*；
// 输入态存宿主字段（_hoveredCardId/_dragging/_aiming/_shiftDown 等），与视图/同步域共享。

/** 出牌线（世界 y）：拖拽过此线松手 = 打出（免目标卡）。 */
export const PLAY_LINE_Y = -20;

/** 瞄准箭头所在平面：高于手牌扇（静息 z≤15，悬浮抬升后 ≤36），viewer（z=80）打开时 aiming 不可达 */
export const ARROW_Z = 45;

export const inputBeats = {
  handlePointerMove(x, y) {
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    // 查看器模态：悬浮照常走 Picker（卡面 token → tooltip:*、整卡 → hover 抬升，
    // 与手牌同链路），但屏蔽瞄准/拖拽等战斗交互
    if (this._viewer.opened) {
      const hit = this.picker.hover(x, y);
      this._syncButtonHover(null);
      // 卡面 token（富文本/S 标）视作仍在悬浮所属卡：画廊抬升不中断（与手牌同语义）
      this._viewer.setHovered(this._viewer.ownsHit(hit) ? hit.id : null);
      this._setOverCard(hit);
      return;
    }
    // 瞄准模式：卡留手牌不动，箭头从卡牌延伸到指针；掠过存活敌人 → 高亮 + 箭头变色
    if (this._aiming) {
      this._syncButtonHover(null);
      const obj = this._views.get(this._aiming.id);
      if (!obj) { this._cancelAiming(); return; } // 卡在瞄准中离场（异常路径）：收尾
      const world = this._worldAt(x, y, ARROW_Z);
      this._arrow.update(obj.position, world);
      const hit = this.picker.pick(x, y, { kinds: ['unit'] });
      const targetId = this._targetableAimId(hit, this._aiming.mode);
      this._setDragTarget(targetId);
      this._arrow.setTargetValid(!!targetId);
      return;
    }
    if (this._dragging) {
      this._syncButtonHover(null);
      const world = this._worldAt(x, y, 30); // 与拖拽卡同深（z=30），防透视视差
      const obj = this._views.get(this._dragging.id);
      if (obj) obj.position.set(world.x, world.y, 30);
      this._dragging.moved = true;
      // 拖牌掠过存活敌人 → 目标标注高亮（排除拖拽中的卡自身遮挡）
      const hit = this.picker.pick(x, y, { kinds: ['unit'], excludeIds: [this._dragging.id] });
      this._setDragTarget(this._targetableEnemyId(hit));
      return;
    }
    const hit = this.picker.hover(x, y);
    // 全屏选卡（战后删卡机会）：悬浮交它（候选卡抬起 + 卡面 hover）。
    // ⚠ 必须排在面板之前：选卡界面是**盖在面板之上的全屏层**，交给面板的话候选卡既不抬起
    // 也不弹卡面预览（点击仍走选卡，hover/click 语义会打架）。
    if (this._pickerKit.routeHover(hit, x, y)) { this._syncButtonHover(null); return; }
    // 面板模态中（战后奖励）：hover 只给面板（背板之外的战场物件不再响应）
    if (this._panel) { this._panel.onHover(hit); this._syncButtonHover(null); return; }
    this._syncButtonHover(hit);
    this._setOverCard(hit);
  }

  /**
   * 战斗常驻按钮（结束回合 / 换卡）的悬停态。这两枚是**直接挂在舞台上**的 CardObject，
   * 不像休息房面板按钮那样走 `PanelObject.onHover → ButtonObject.setHovered` —— 漏喂就完全
   * 没有 hover 反馈（实报"结束回合和换卡没有 hover 效果"）。悬停走按钮面的
   * active 主题（淡蓝底），与整套 `bakeButtonFace` 按钮同一套语言；传 null 清空
   * （模态/拖拽/瞄准期间不该留高亮）。
   */,
  _syncButtonHover(hit) {
    const id = hit?.kind === 'button' ? hit.id : null;
    this._setButtonHover('main', id === 'btn:main');
    this._setButtonHover('swap', id === 'btn:swap');
  },
  _setButtonHover(key, on) {
    if (!!this._btnHover[key] === on) return;
    this._btnHover[key] = on;
    this._setButtonState(key);   // 用缓存的上一次数据重烘（hover 已进签名）
    if (key === 'main') this._updateDoomMarks();
  },
  handlePointerDown(x, y) {
    if (this._viewer.opened) return; // 查看器内无按压语义（抬起时统一判定开/关）
    if (this._pick) return;          // 选卡覆盖层：点按语义在抬起时统一处理（不瞄准/不拖拽）
    if (this._pickerKit.cardPicker?.opened) {   // 全屏选卡（战后删卡机会）：滚动条拖拽从按下开始
      this._pickerKit.routePointerDown?.(this.picker.pick(x, y), x, y);
      return;
    }
    if (this._panel) return;         // 面板模态中：只走面板自己的点按（不拖牌/不瞄准）
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    const hit = this.picker.pick(x, y);
    const proj = this._snapshot;
    // 点了「因手牌压力发动不了」的咏唱卡：灰卡本身没说原因，这里补一次明确反馈
    if (hit.kind === 'card') {
      const clicked = proj?.hand.find(c => c.uniqueID === hit.id);
      if (clicked?.blocked === 'chantPressure') {
        this._handPressureHint('手牌太多，咏唱发动不了！');
        return;
      }
    }
    // 弃牌模式下点手牌是"切换选中"，不进入拖拽/瞄准
    // 回合过渡锁（_endTurnRequested）：锁定期手牌不发起任何出牌交互
    if (hit.kind === 'card' && !proj?.pendingInput && !this._dumpMode && !this._endTurnRequested) {
      // 前端拒绝以显示态为准：渲染为灰（disabled）的卡不可发起交互——显示态落后
      // 于后端（动画积压期）时，玩家看到什么就是什么，不可能"抢先"后端出牌
      const displayPlayable = this._views.get(hit.id)?.visualState !== 'disabled';
      if (displayPlayable && this.bridge.intents.canPlayCard(hit.id)) {
        // 按投影 targetMode 分流：选目标卡进瞄准（卡留手牌），免目标卡旧式拖拽（卡随指针）。
        // **可选目标只剩一个时不进瞄准**：退化成免目标卡的拖拽交互（拖过出牌线即打出，
        // 目标自动取那唯一的候选人）——用户定 单目标也**不要**"点一下就出牌"，
        // 出牌手势必须一致（"点按"在手牌里没有语义，误触代价太大）。
        const targetMode = proj?.hand.find(c => c.uniqueID === hit.id)?.targetMode ?? 'none';
        const solo = (targetMode === 'enemy' || targetMode === 'ally')
          ? this._soloTargetId(targetMode) : null;
        if (targetMode !== 'none' && !solo) {
          this._aiming = { id: hit.id, mode: targetMode };
          this._arrow.show(this._views.get(hit.id).position);
          this._arrow.setTargetValid(false);
          this._layoutAndTrack(); // 瞄准卡高亮 + 撑开两侧
        } else {
          // 免目标卡，或"选目标卡但只有一个候选人"：拖拽出牌（soloTarget 在松手时补上目标）
          this._dragging = { id: hit.id, moved: false, soloTarget: solo };
          this.animator.enterDragging(hit.id);
        }
      }
      // 咏唱卡无特殊点按语义：双态开关统一走出牌（拖拽过线 = 发动/免费解除）
    }
  },
  handlePointerUp(x, y) {
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    if (this._viewer.opened) {
      // 点卡（或卡面 token）= 读卡，保持打开；点背板/其余任意处关闭
      if (!this._viewer.ownsHit(this.picker.pick(x, y))) this._closeViewer();
      return;
    }
    // 全屏选卡 / 面板模态：只由它们自己处理点击（背板外的战场物件一律不响应）
    if (this._pickerKit.routeClick(this.picker.pick(x, y))) return;
    if (this._panel) { this._panel.onClick(this.picker.pick(x, y)); return; }
    const proj = this._snapshot;
    const pending = proj?.pendingInput?.request ?? null;

    // 选卡覆盖层：点候选 = 切换选中（不打出、不瞄准）；上限封顶 max
    if (this._pick && this._pick.request === pending) {
      const hitPick = this.picker.pick(x, y);
      const uid = hitPick?.kind !== 'card' ? null
        : (this._pick.mode === 'hand' ? hitPick.id : this._pick.temp.get(hitPick.id)?.uniqueID);
      if (uid && this._pick.ids.includes(uid)) {
        const sel = this._pick.selection;
        const i = sel.indexOf(uid);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length < this._pick.max) sel.push(uid);
        this.reconcile();   // 同一 request 幂等 → 只刷新选中态与按钮
        return;
      }
    }

    // 瞄准松手：指针在存活敌人身上 → 指定目标打出；否则取消（卡本就在锚点，只清状态）。
    // 提交前再验显示态：瞄准中途节拍推进可能已把卡压灰（如结算期），灰卡不打
    if (this._aiming) {
      const { id } = this._aiming;
      const hit = this.picker.pick(x, y, { kinds: ['unit'] });
      const targetId = this._targetableAimId(hit, this._aiming.mode);
      this._cancelAiming();
      if (targetId && !this._endTurnRequested && this._views.get(id)?.visualState !== 'disabled') {
        this.bridge.intents.playCard(id, targetId);
      }
      return;
    }

    if (this._dragging) {
      const { id, soloTarget } = this._dragging;
      this._dragging = null;
      this._setDragTarget(null);
      const world = this._worldAt(x, y, 30); // 出牌线判定与拖拽同深
      // 松手点在存活敌人身上 → 指定目标打出；否则**过出牌线**才打出（与免目标卡同一条闸）。
      // `soloTarget`（选目标卡但场上只有一个候选人）只在过线时补上目标——不能拿它当"已指定
      // 目标"用，否则原地松手也会出牌，又变回"点一下就打出"了。
      // 显示态门：拖拽中途被节拍压灰的卡不提交（回原位），防"认知先于动画节拍"的误操作
      const hit = this.picker.pick(x, y, { kinds: ['unit'], excludeIds: [id] });
      const droppedOn = this._targetableEnemyId(hit);
      const pastLine = world.y > PLAY_LINE_Y;
      const targetId = droppedOn ?? soloTarget ?? null;
      const displayPlayable = this._views.get(id)?.visualState !== 'disabled';
      // 回合过渡锁：拖拽发起后若锁落下（如锁内显示态尚未重刷的兜底），提交一并关闭
      const played = displayPlayable && !this._endTurnRequested && (droppedOn || pastLine)
        && this.bridge.intents.playCard(id, targetId);
      if (!played) this.animator.enterIdle(id); // 弹簧收养：从松手位平滑滑回锚点
      return;
    }

    const hit = this.picker.pick(x, y);
    if (hit.kind === 'pile') {
      this._openViewer(hit.id.slice(5)); // 'pile:deck' → 'deck'
      return;
    }
    if (hit.kind === 'button' && hit.id === 'btn:swap') {
      // 弃牌按钮：模式开关（再点一次取消）；可用性以按钮面当前状态为准
      if (this._dumpMode) this._setDumpMode(false);
      else if (this._buttons.swap.cardData?.enabled) this._setDumpMode(true);
      return;
    }
    if (hit.kind === 'card' && this._dumpMode) {
      // D3 一键全弃：弃牌模式下点手牌无逐张挑选语义（进模式已全选）；
      // 确认走主按钮，取消走再点弃牌按钮。回合过渡锁期间模式已退，这里是兜底
      return;
    }
    if (hit.kind === 'button' && hit.id === 'btn:main') {
      // 显示态门：按钮面为灰（结算期未就绪/终局/已点过结束回合）时不分发任何意图——
      // 灰按钮必须真的点不动，杜绝"显示灰但后端已可结算"的抢先操作
      if (!this._buttons.main.cardData?.enabled) return;
      if (this._dumpMode) {
        // 弃牌提交：付一次阶梯费弃掉全部手牌（D3 一键全弃）；失败保持模式便于重试
        if (this.bridge.intents.dumpCards([...this._dumpSel])) this._setDumpMode(false);
      } else if (this._pick) this.bridge.interaction.respond([...this._pick.selection]);
      else if (pending?.kind === 'confirm') this.bridge.interaction.respond(true);
      else {
        // 结束回合：点完**立刻**上灰（不等 sync 节拍），直到下一回合
        // 开始；后端同步结算，所以动画积压期点也不会丢意图。下发失败（回合已过/终局）
        // 则回滚标记，避免按钮假死。
        // 同时进入**手牌交互锁**：锁 key 记下点击时快照的回合轨道，
        // 解锁只认新的玩家回合快照（见 _applySnapshot）；reconcile 让锁态立刻上手
        this._endTurnRequested = true;
        this._endTurnLockKey = `${this._snapshot?.turn?.side ?? '?'}:${this._snapshot?.turn?.count ?? -1}`;
        const ok = this.bridge.intents.endTurn();
        if (!ok) this._endTurnRequested = false;
        this._syncButtons(this._snapshot);
        this.reconcile();   // 整手立刻压灰、换卡模式退出（不等下一拍 sync）
      }
      return;
    }
    if (hit.kind === 'card' && pending?.kind?.startsWith('select')) {
      // 手牌单选：点牌即应答。多选不在这里（已由 _pick 覆盖层接管，见 _openPick——
      // 「逐张累加再点确认」的私有通道已删，它只认旧 count 字段，是二重花刀卡死的根因）
      if (!pending.candidates || pending.candidates.includes(hit.id)) {
        const lo = pending.min ?? 1; const hi = pending.max ?? lo;
        if (lo === 1 && hi === 1) this.bridge.interaction.respond([hit.id]);
      }
    }
  },
  _worldAt(x, y, planeZ = 0) {
    // 射线与指定 z 平面求交（拖拽出牌用 planeZ=30 与卡面同深，避免透视视差）；
    // 卡牌在 UI pass → 必须用 uiCamera 反投影，否则世界相机的斜视会把落点算歪
    return this.picker._sm.screenToWorld(x, y, planeZ, this.picker._sm.uiCamera);
  },
  // 瞄准收尾：清状态 + 藏箭头 + 重排手牌（去高亮/收撑开）。卡全程未离锚点，无需归位
  _cancelAiming() {
    this._aiming = null;
    this._arrow.hide();
    this._setDragTarget(null);
    this._layoutAndTrack();
    this._updatePendingPips();
  },
  // 拖牌/瞄准可指定的目标池：按显示态快照取（尸体不算；'none' 等模式回空池）。
  // 显示态即玩家看到的东西——节拍积压期也不会选中已经倒下的单位。
  _targetPool(mode) {
    const pool = mode === 'enemy' ? this._snapshot?.enemies
      : mode === 'ally' ? this._snapshot?.allies
        : null;
    return (pool ?? []).filter(u => !u.isDead);
  },
  // 拖牌目标：pick 命中存活敌人才作数（尸体/友方/玩家不算；按显示状态快照判定）
  _targetableEnemyId(hit) {
    if (hit?.kind !== 'unit') return null;
    return this._targetPool('enemy').some(u => u.uniqueID === hit.id) ? hit.id : null;
  },
  // 瞄准目标：按当前瞄准模式取池（enemy → 敌方 / ally → 友方）
  _targetableAimId(hit, mode) {
    if (hit?.kind !== 'unit') return null;
    return this._targetPool(mode).some(u => u.uniqueID === hit.id) ? hit.id : null;
  }

  /**
   * 目标选择模式下的**唯一候选**：恰有一个存活目标时返回它的 uniqueID，否则 null。
   * 用途：① 单目标时把选目标卡退化成免目标卡的拖拽交互（松手时自动补上这个目标）；
   * ② 判断是否需要进入瞄准流程（多目标才需要）。
   */,
  _soloTargetId(mode) {
    const pool = this._targetPool(mode);
    return pool.length === 1 ? pool[0].uniqueID : null;
  },
  // 目标标注：最多一个单位高亮，随拖拽移动切换/清除
  _setDragTarget(uniqueID) {
    if (this._dragTargetId === uniqueID) return;
    this._dragTargetId = uniqueID;
    for (const [id, unit] of this._units) unit.setHighlight(id === uniqueID);
  },
  _setHoveredCard(uniqueID) {
    if (this._viewer.hasCard(uniqueID)) return; // 查看器卡悬浮由画廊自管，不进手牌撑开/资源点链路
    if (this._hoveredCardId === uniqueID) return;
    this._hoveredCardId = uniqueID;
    this._layoutAndTrack(); // 弹簧层软收敛到新目标，无 kill/重启的顿挫
    this._updatePendingPips();
  }

  // ========== Shift 详情卡面（应用描述 ↔ 未应用描述临时切换） ==========

  /** Shift 键态入口（单测直调；window 监听已由 CardObject 模块级通用件接管）。 */,
  setShiftDown(on) {
    on = !!on;
    this._shiftDown = on;   // 本地镜像（排查读数用），生效走全局通用态
    setCardShiftDown(on);
  },
  // 指针压卡跟踪：整卡或卡面 token 都算"压着"——详情态悬到 S 方标（token）上也不得闪切回
  _setOverCard(hit) {
    const id = (hit?.kind === 'card' || hit?.kind === 'token') ? hit.id : null;
    if (this._overCardId === id) return;
    this._overCardId = id;
    this._refreshShiftFace();   // 喂悬停（详情面由卡内 shift×hover 合成）
    // 容量珠 hover 联动：指针压着的卡 → slot 按 card 主匹配，它占用的珠/迷你竖线改 HDR 色
    this._capacityBeads.setHover(id);
  }

  /**
   * 卡 → 容量珠足迹：按快照手牌序走一遍占用账（激活咏唱按权重占蓝珠段、
   * 迷你卡占幻影竖线、其余占绿珠），返回该卡的落位；不在手牌（查看器画廊等）→ null。
   */,
};
