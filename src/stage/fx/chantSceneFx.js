// 咏唱场景演出管理器（呈现层主题，不动 core）：咏唱激活期间把战场推向体系氛围——
// 火焰旋风 = 环境余烬/火屑飘荡 + 场景暖调（后处理 uTint）+ 结构光压暗火光反抬
// （lighting.mood 口径）+ 骑士周身火流环绕（chantOrbitFx）。
// 驱动 = **快照对账**（不依赖 ANIM 事件）：hand 里 isActivated 的卡经主题注册表
// 解析出 (主题, 强度k)，激活集合变化即重定包络目标——读档恢复/观战重连/任何
// 离手熄灭路径天然一致（状态是唯一事实源）。
// 包络单参 k 逐帧缓动，一切输出（mood/uTint/发射器 rate/环绕 level）由 k 派生——
// 强度变化全程连续，无阶梯。注册新体系 = 加一行主题表（defId 逐卡覆写 → series
// 族行 → null 无演出，与 spells 决议链同构）。
import * as THREE from 'three';
import { createChantOrbit } from './chantOrbitFx.js';

// ---- 主题表 ----------------------------------------------------------------
// fireHeat（火系炙热场）：tint = 后处理暖调峰值色（uTint 白→此色按 k 插值）；
// dimDrop/fireGainUp = mood 压结构光/抬火光幅度（×k）；lightWarm = 冷结构灯染色
// 目标（只染 b>r 的冷灯，按 k 插值、熄灭还原——pyro 染灯配方的可逆版，火把本暖
// 不碰）；orbit = 骑士火流环绕参数；drift = 环境余烬/火屑发射器布局（rate ×k）；
// ringAt = 玩家热浪环出现阈值（高级才有的「火气蒸腾」）。
const THEMES = {
  fireHeat: {
    tint: [1.22, 0.9, 0.68],
    dimDrop: 0.24, fireGainUp: 1.6,
    lightWarm: [1.0, 0.48, 0.16], lightWarmK: 0.8,
    orbit: { count: 4, radius: 5.8, speed: 2.9, size: 6.4, heat: 1.0 },
    ringAt: 0.7,
    // 高撒布布局：出生中心 dy（立牌高分数）× 2D 圆盘半径 0.45H → 垂直覆盖
    // dy±0.45H，0.2H~1.3H 从脚底撒到头顶上空（「空中飞荡」）；vby 续升偏置。
    // z 一律贴机位可见带（dz 相对锚偏移）——敌锚纵深 z≈-56，那边的粒子缩成
    // 亚像素尘纯属浪费（首轮验收「空中为零」的病根：半量发射器钉在敌纵深）
    drift: [
      // [锚, dz, 高度分数, 率, 尺寸, 色] —— 锚：self=骑士 / mid=中场
      // 小而亮 = 火星（急升），大而暗红 = 火屑（缓升）——大小两档空中飞荡
      { at: 'self', dz: 0, dy: 0.7, rate: 26, size: 1.9, color: 0xffd9a0, speed: 5, ttl: 3.2, gravity: 4.5, vby: 6 },
      { at: 'self', dz: -14, dy: 0.8, rate: 20, size: 2.2, color: 0xffa050, speed: 4.5, ttl: 3.4, gravity: 4, vby: 7 },
      { at: 'self', dz: 10, dy: 0.5, rate: 18, size: 1.6, color: 0xffe6c0, speed: 6, ttl: 2.6, gravity: 5, vby: 8 },
      { at: 'mid', dz: 10, dy: 0.75, rate: 20, size: 1.8, color: 0xffc080, speed: 4.5, ttl: 3.0, gravity: 4.5, vby: 6 },
      { at: 'mid', dz: -6, dy: 0.9, rate: 16, size: 4.2, color: 0xe05018, speed: 3, ttl: 4.0, gravity: 3, vby: 5 },
      { at: 'mid', dz: -16, dy: 0.6, rate: 12, size: 3.6, color: 0xd04515, speed: 3, ttl: 3.8, gravity: 3.5, vby: 6 },
      // 头顶抽吸带（画面上 1/4 不空）：出生即在头顶上（1.0H~1.9H）+ 强升尾流——
      // 上轮锚 mid 高度 1.25H 仍够不到 y<200 屏区，改锚 self 近机位深度保尺寸
      { at: 'self', dz: -6, dy: 1.45, rate: 14, size: 2.4, color: 0xffe0b0, speed: 3.5, ttl: 4.2, gravity: 3, vby: 10 },
      { at: 'foeAir', dz: 0, dy: 1.2, rate: 8, size: 2.2, color: 0xffd0a0, speed: 3.5, ttl: 3.6, gravity: 3, vby: 9 },  // 右半区高空（撒布不偏左）
    ],
    // 热浪环（≥ringAt 才发）：环周上升热气——参数随主题走（qiFlow = 地气环）
    ring: { color: 0xffa050, speed: 6, size: 1.5, ttl: 1.6, gravity: 5, vby: 8, rate: 30 },
  },
  // qiFlow（体修「气」场）：**贴身主题，不染全场**（2026-10-02 用户定——体修咏唱
  // 作用于自身，非火焰旋风的战场级现象）：tint/mood/染灯三个全场输出一律关掉
  // （null/0 = 主题声明「我没有全场输出」，update 按字段存在性门控）；表现全在
  // 贴身件——环绕气流带 + 自体锚淡雾微点 + 高档（太极 k1.0）地气环。
  qiFlow: {
    tint: null, dimDrop: 0, fireGainUp: 0,
    lightWarm: null, lightWarmK: 0,
    orbit: { count: 3, radius: 5.6, speed: 1.7, size: 6.2, heat: 0.85,
      variant: 'qi', color: [1.0, 1.08, 1.25] },
    ringAt: 0.9,
    drift: [
      // 淡雾微点：大而软、慢而低（贴身气场，只锚自身）
      { at: 'self', dz: 0, dy: 0.35, rate: 16, size: 3.2, color: 0xdde8f8, speed: 1.8, ttl: 4.6, gravity: 1.0, vby: 1.6 },
      { at: 'self', dz: -10, dy: 0.6, rate: 12, size: 2.6, color: 0xcfdcf2, speed: 2.0, ttl: 4.2, gravity: 1.2, vby: 2.0 },
      { at: 'self', dz: 8, dy: 0.2, rate: 12, size: 3.6, color: 0xe6eefb, speed: 1.4, ttl: 5.0, gravity: 0.8, vby: 1.2 },
    ],
    // 地气环（太极档）：淡白慢速环周流转——「气沉丹田，周流不息」
    ring: { color: 0xd8e4f8, speed: 3.2, size: 2.0, ttl: 2.4, gravity: 1.2, vby: 2.0, rate: 18 },
  },
};

// 主题注册表：series 族行（k 按等阶取值，缺档回落 0.5）+ defId 逐卡覆写位。
// 加新体系咏唱 = 在此登记一行（其它族主题件待各自视觉语言定稿后补）。
const SERIES_ROW = {
  fireWhirl: { theme: 'fireHeat', k: { C: 0.5, B: 0.65, A: 0.8, S: 1.0 } },
  magmaArmor: { theme: 'fireHeat', k: { B: 0.5, A: 0.62 } },
};
const CARD_ROW = {
  // 例：flameHurricane: { theme: 'fireHeat', k: { S: 1.0 } },
  // 体修引擎咏唱（全 series=fist，族行被 fistCast 占用 → 必须逐卡登记）：
  // 借力链 / 变招链 / 无限连击 / 混元 / 太极。肘击系（牢大）不在此列——另立语言。
  leverageC:    { theme: 'qiFlow', k: { C: 0.45 } },
  leverageB:    { theme: 'qiFlow', k: { B: 0.55 } },
  leverageA:    { theme: 'qiFlow', k: { A: 0.65 } },
  taijiS:       { theme: 'qiFlow', k: { S: 1.0 } },
  shiftMoveB:   { theme: 'qiFlow', k: { B: 0.5 } },
  shiftMoveA:   { theme: 'qiFlow', k: { A: 0.6 } },
  endlessCombo: { theme: 'qiFlow', k: { A: 0.7 } },
  hunYuanS:     { theme: 'qiFlow', k: { S: 0.85 } },
};

/**
 * @param {object} deps
 *   scene: 世界场景；particles: 组合粒子门面（spawnEmitter）；
 *   cast: 命名寻址（light:mood）；composer: 体积月光 composer（setSceneTint，可空）；
 *   units: 单位视图 Map；playerId: () => 玩家 uniqueID；
 *   enemyIds: () => 敌 uniqueID 列表（快照口径）
 */
export function createChantSceneFx({ scene, particles, cast, composer, units, playerId, enemyIds }) {
  const active = new Map();        // uniqueID → { defId, theme, k }
  let k = 0;                       // 包络（逐帧缓动向 target）
  let target = 0;
  let theme = null;                // 当前/最近主题（淡出期沿用）
  let moodBase = null;             // 点火沿捕获的 mood 基值（熄灭还原用）
  let lightSnaps = [];             // 点火沿捕获的冷灯色快照（{ light, r, g, b }）
  let emitters = [];               // { handle, baseRate }
  let ring = null;                 // 玩家热浪环（≥ringAt 才发）
  let orbit = null;
  const WHITE = new THREE.Color(1, 1, 1);
  const scratch = new THREE.Color();

  // ---- 锚点 ----
  function unitAnchor(id, dyFrac) {
    const u = id != null ? units.get(id) : null;
    if (!u) return null;
    const H = u._standeeHeight ?? 22;
    return { x: u.position.x, y: u.position.y + H * dyFrac, z: u.position.z, H };
  }
  function anchors() {
    const pid = playerId();
    const self = unitAnchor(pid, 0);
    const foes = (enemyIds?.() ?? []).map((id) => unitAnchor(id, 0)).filter(Boolean);
    const mid = self && foes.length
      ? { x: (self.x + foes[0].x) / 2, y: (self.y + foes[0].y) / 2, z: (self.z + foes[0].z) / 2, H: self.H }
      : (self ?? (foes[0] ?? null));
    return { self, foes, mid };
  }
  const anchorOf = (name, A) =>
    name === 'self' ? A.self : name === 'mid' ? A.mid
      // foeAir = 敌的 x、中场的 z——右半区高空撒布用（敌锚本体 z≈-56 纵深，粒子缩成尘）
      : name === 'foeAir'
        ? (A.foes[0] && A.mid ? { x: A.foes[0].x, y: A.foes[0].y, z: A.mid.z, H: A.foes[0].H } : A.mid)
        : name === 'enemy0' ? (A.foes[0] ?? A.mid) : (A.foes[1] ?? A.foes[0] ?? A.mid);

  // ---- 对账（每次状态同步）----
  function reconcile(snapshot) {
    const hand = snapshot?.hand ?? [];
    const next = new Map();
    for (const c of hand) {
      if (!c.isActivated) continue;
      const row = CARD_ROW[c.defId] ?? SERIES_ROW[c.series] ?? null;
      if (!row) continue;
      next.set(c.uniqueID, { defId: c.defId, theme: row.theme, k: row.k?.[c.tier] ?? 0.5 });
    }
    let changed = next.size !== active.size;
    if (!changed) for (const [id, v] of next) {
      const old = active.get(id);
      if (!old || old.k !== v.k || old.theme !== v.theme) { changed = true; break; }
    }
    if (!changed) return;
    active.clear();
    for (const [id, v] of next) active.set(id, v);
    // 最强激活者定包络目标与主题（多咏唱同开取峰值，不叠加——同一场景只能推向一个氛围）
    let best = null;
    for (const v of active.values()) if (!best || v.k > best.k) best = v;
    target = best?.k ?? 0;
    if (best) theme = THEMES[best.theme] ?? null;
    if (target > 0 && k <= 0.01 && theme) ignite();
  }

  // ---- 点火沿（k 离 0）：捕获基值 + 建常驻件 ----
  function ignite() {
    const mood = cast?.get?.('light:mood') ?? null;
    moodBase = mood ? { dim: mood.dim, fireGain: mood.fireGain } : null;
    // 冷结构灯色快照（染暖还原用；灯色不被 lighting.update 重写，可直推——
    // pyro 同口径。fx 池灯跳过：演出借用中，色随剧本走）。主题不染灯则连
    // 快照都不捕（qiFlow——捕了也不用，quench 还原写同值纯属空转）
    lightSnaps = [];
    if (theme.lightWarm) {
      for (const { handle } of cast?.query?.('light:') ?? []) {
        if (!handle?.isLight || handle.name?.startsWith('fxPool')) continue;
        const c = handle.color;
        if (c && c.b > c.r) lightSnaps.push({ light: handle, r: c.r, g: c.g, b: c.b });
      }
    }
    const A = anchors();
    if (A.self || A.mid) {
      for (const d of theme.drift) {
        const a = anchorOf(d.at, A);
        if (!a) continue;
        const handle = particles?.spawnEmitter?.(a.x, a.y + a.H * d.dy, {
          rate: 0, radius: a.H * 0.45, zJitter: a.H * 0.4,
          color: d.color, speed: d.speed, ttl: d.ttl, size: d.size,
          gravity: d.gravity, vby: d.vby ?? 0, z: a.z + (d.dz ?? 0),
        });
        if (handle) emitters.push({ handle, baseRate: d.rate });
      }
      if (!orbit) orbit = createChantOrbit({ scene, anchor: () => unitAnchor(playerId(), 0) });
      orbit.setParams({ ...theme.orbit, count: Math.max(2, Math.round(theme.orbit.count * target)) });
    }
  }

  // ---- 熄灭（k 归 0）：还原基值 + 收常驻件 ----
  function quench() {
    const mood = cast?.get?.('light:mood') ?? null;
    if (mood && moodBase) { mood.dim = moodBase.dim; mood.fireGain = moodBase.fireGain; }
    moodBase = null;
    for (const s of lightSnaps) s.light.color.setRGB(s.r, s.g, s.b);
    lightSnaps = [];
    composer?.setSceneTint?.([1, 1, 1]);
    for (const e of emitters) { try { e.handle.stop(); } catch (_) {} }
    emitters = [];
    if (ring) { try { ring.handle.stop(); } catch (_) {} ring = null; }
    orbit?.dispose();
    orbit = null;
  }

  // ---- 帧泵：包络推进 + 全输出派生 ----
  function update(dt) {
    if (k === target && k === 0) return;
    const rate = target > k ? 2.2 : 3.0;   // 起 ~0.7s 爬满 / 收 ~0.5s 退尽
    k += (target - k) * (1 - Math.exp(-rate * dt));
    if (Math.abs(target - k) < 0.004) k = target;
    if (k <= 0.01 && target === 0) {
      if (emitters.length || orbit || moodBase) { k = 0; quench(); }
      return;
    }
    if (!theme) return;
    // mood：结构光压暗 + 火光反抬（只在做主期间逐帧落笔——pyro 等剧本同写时
    // 后到的一方覆盖，同 pvp 调光冲突量级可接受）。dimDrop/fireGainUp 全 0 的
    // 主题（qiFlow 贴身场）不碰 mood——也不与任何调光剧本争写
    const mood = cast?.get?.('light:mood') ?? null;
    if (mood && moodBase && (theme.dimDrop || theme.fireGainUp)) {
      mood.dim = moodBase.dim * (1 - theme.dimDrop * k);
      mood.fireGain = moodBase.fireGain * (1 + theme.fireGainUp * k);
    }
    // 冷结构灯染色（按 k 插值快照色 → 主题目标色；亮度不动、只移色相）。
    // lightWarm null = 主题不染灯（qiFlow）
    if (theme.lightWarm) {
      const wk = (theme.lightWarmK ?? 0.5) * k;
      for (const s of lightSnaps) {
        s.light.color.setRGB(
          s.r + (theme.lightWarm[0] - s.r) * wk,
          s.g + (theme.lightWarm[1] - s.g) * wk,
          s.b + (theme.lightWarm[2] - s.b) * wk,
        );
      }
    }
    // 后处理调色：uTint 白→主题色按 k 插值（tint null = 主题不调全场色，qiFlow）
    if (theme.tint) {
      scratch.setRGB(theme.tint[0], theme.tint[1], theme.tint[2]);
      scratch.lerpColors(WHITE, scratch, k);
      composer?.setSceneTint?.([scratch.r, scratch.g, scratch.b]);
    }
    // 发射器 rate 随包络（点火渐密、熄灭渐稀）
    for (const e of emitters) e.handle.rate = e.baseRate * k;
    // 热浪环/地气环：达到 ringAt 才起（高级咏唱的「气蒸腾」档），参数随主题
    if (k >= (theme.ringAt ?? 1) && !ring && theme.ring) {
      const a = unitAnchor(playerId(), 0);
      if (a) {
        const R = theme.ring;
        const handle = particles?.spawnEmitter?.(a.x, a.y + a.H * 0.15, {
          rate: 0, radius: a.H * 0.42, outward: true, vby: R.vby ?? 8, zJitter: a.H * 0.4,
          color: R.color, speed: R.speed, ttl: R.ttl, size: R.size, gravity: R.gravity, z: a.z,
        });
        if (handle) ring = { handle, baseRate: R.rate ?? 30 };
      }
    }
    if (ring) ring.handle.rate = ring.baseRate * k;
    orbit?.setLevel(k);
    orbit?.update(dt);
  }

  function dispose() { quench(); k = 0; target = 0; active.clear(); }

  return { reconcile, update, dispose, get level() { return k; } };
}
