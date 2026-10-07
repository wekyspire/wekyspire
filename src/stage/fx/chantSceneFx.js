// 咏唱场景演出管理器（呈现层主题，不动 core）：咏唱激活期间把战场推向体系氛围——
// 火焰旋风 = 环境余烬/火屑飘荡 + 场景暖调（后处理 uTint）+ 结构光压暗火光反抬
// （lighting.mood 口径）+ 火龙卷粒子绕身（fireWhirlOrbit，GPU 池 custom 类型）；
// 贴身气流粒子环绕（qiOrbit）仅 qiFlow 使用。
// ⚠ drift/ring 的发射器目前走 floatFx 点粒子（spawnEmitter）——该路径 WebGPU 下
// 渲染件坏死（粒子不可见，见 floatFx.js 头注）且违反 CPU/GPU 分工铁律（AGENTS：
// 默认一律 GPU 池）。**新主题不要再加 drift/ring 发射器**，待整体迁 GPU 池类型行
// 后本段拆除。
// 驱动 = **快照对账**（不依赖 ANIM 事件）：hand 里 isActivated 的卡经主题注册表
// 解析出 (主题, 强度k)，激活集合变化即重定包络目标——读档恢复/观战重连/任何
// 离手熄灭路径天然一致（状态是唯一事实源）。
// 双持合成（2026-10-07 用户定）：同一条进阶链（promotesTo 链）的多张激活咏唱只按
// 最强者计；不同链同主题 = 强度叠加（cap 1）；不同主题 = 并存复合——每主题一条
// 包络槽（各自建/拆件、各自包络），全场输出（mood/tint/染灯）由基值 + 全部活槽
// 逐帧重算复合，槽全部退尽才一次性写回基值（单槽退场不碰全场，避免互相踩踏）。
import * as THREE from 'three';
import { createQiOrbitLink } from './gpu/qiOrbit.js';
import { createFireWhirlLink, FIRE_WHIRL_ORBIT_CHANT } from './gpu/fireWhirlOrbit.js';
import { getSkillDefinition } from '../../core/skills/registry.js';

// ---- 主题表 ----------------------------------------------------------------
// fireHeat（火系炙热场）：tint = 后处理暖调峰值色（uTint 白→此色按 k 插值）；
// dimDrop/fireGainUp = mood 压结构光/抬火光幅度（×k）；lightWarm = 冷结构灯染色
// 目标（只染 b>r 的冷灯，按 k 插值、熄灭还原——pyro 染灯配方的可逆版，火把本暖
// 不碰）；drift = 环境余烬/火屑发射器布局（rate ×k）；
// orbit = 绕身件（kind: qi = 气流 / fire = 火龙卷，radiusK = 半径占立牌高比）；
// ringAt = 玩家热浪环出现阈值（高级才有的「火气蒸腾」）。
const THEMES = {
  fireHeat: {
    tint: [1.22, 0.9, 0.68],
    dimDrop: 0.24, fireGainUp: 1.6,
    lightWarm: [1.0, 0.48, 0.16], lightWarmK: 0.8,
    ringAt: 0.7,
    // 持续段「息旋涡」：低强度火龙卷粒子常驻绕身（与激活施术拍同语言——
    // 2026-10-07 圆柱面片方案废弃换 GPU 粒子；常驻走 CHANT 段不与爆发抢 uniform）
    orbit: { kind: 'fire', radiusK: 0.30 },
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
  // 贴身件——环绕气流粒子（orbit，本表唯一使用者）+ 自体锚淡雾微点 + 高档（太极
  // k1.0）地气环。
  qiFlow: {
    tint: null, dimDrop: 0, fireGainUp: 0,
    lightWarm: null, lightWarmK: 0,
    orbit: { kind: 'qi', radiusK: 0.45 },   // 环绕半径 = 立牌高 × radiusK；三族流形/密度/亮暗在 qiOrbit.js
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
  // feverHeat（高热/白炽「自体发烧」场，2026-10-07）：自燃换纳气的咏唱——火在
  // 自己身上烧（身体燃烧的 L1 舔火已在，主题补的是「热到发烫」的环境层）。
  // 贴身主题（同 qiFlow 口径）：tint/mood/染灯三个全场输出全关，表现 = 贴身
  // 热浪蒸腾 + 火星上冒 + 头顶热气；白炽档（k≥ringAt）热浪环绕上升。
  feverHeat: {
    tint: null, dimDrop: 0, fireGainUp: 0,
    lightWarm: null, lightWarmK: 0,
    ringAt: 0.72,
    drift: [
      // [锚, dz, 高度分数, 率, 尺寸, 色]——小亮火星急升（烧得急），淡红蒸汽大而软
      // 慢升（热浪蒸腾），头顶热气（发烧读感）
      { at: 'self', dz: 0, dy: 0.55, rate: 22, size: 1.7, color: 0xffb060, speed: 6.5, ttl: 2.4, gravity: 6, vby: 7 },
      { at: 'self', dz: -8, dy: 0.65, rate: 16, size: 2.6, color: 0xd85020, speed: 4.5, ttl: 3.2, gravity: 3.5, vby: 6 },
      { at: 'self', dz: 7, dy: 0.4, rate: 14, size: 3.4, color: 0xc04018, speed: 3.5, ttl: 3.8, gravity: 3, vby: 4.5 },
      { at: 'self', dz: 0, dy: 1.15, rate: 12, size: 2.0, color: 0xffd0a0, speed: 3.0, ttl: 3.4, gravity: 2.5, vby: 8 },
    ],
    // 热浪环（白炽档）：暖橙热气绕身环周上升
    ring: { color: 0xff9a4d, speed: 5, size: 1.6, ttl: 1.8, gravity: 4, vby: 9, rate: 26 },
  },
};

// 主题注册表：series 族行（k 按等阶取值，缺档回落 0.5）+ defId 逐卡覆写位。
// 加新体系咏唱 = 在此登记一行（其它族主题件待各自视觉语言定稿后补）。
const SERIES_ROW = {
  fireWhirl: { theme: 'fireHeat', k: { C: 0.5, B: 0.65, A: 0.8, S: 1.0 } },
  magmaArmor: { theme: 'fireHeat', k: { B: 0.5, A: 0.62 } },
  fever: { theme: 'feverHeat', k: { B: 0.55, A: 0.75 } },
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

// 链尖反查：沿 promotesTo（局外晋升链，线性）走到头——同链共享同一链尖 id，
// 双持合成时同链只取最强（tip 缓存，一次对账多次查）
const tipCache = new Map();
function chainTipOf(defId) {
  const cached = tipCache.get(defId);
  if (cached) return cached;
  let tip = defId;
  const seen = new Set([defId]);
  for (;;) {
    const def = (() => { try { return getSkillDefinition(tip); } catch { return null; } })();
    const next = def?.promotesTo;
    if (!next || seen.has(next)) break;
    seen.add(next);
    tip = next;
  }
  tipCache.set(defId, tip);
  return tip;
}

/**
 * @param {object} deps
 *   particles: 组合粒子门面（spawnEmitter）；worldPool: 世界 GPU 池（orbit 环绕件用，可空）；
 *   cast: 命名寻址（light:mood）；composer: 体积月光 composer（setSceneTint，可空）；
 *   units: 单位视图 Map；playerId: () => 玩家 uniqueID；
 *   enemyIds: () => 敌 uniqueID 列表（快照口径）
 */
export function createChantSceneFx({ particles, worldPool = null, cast, composer, units, playerId, enemyIds }) {
  const active = new Map();        // uniqueID → { defId, themeKey, k, tip }
  const slots = new Map();         // themeKey → { theme, k, target, emitters, ring, orbit }
  let baseCaptured = false;        // 基值快照是否已捕获（首个槽建立时一次，全灭清除）
  let moodBase = null;             // 捕获的 mood 基值（复合起点 + 全灭还原）
  let lightSnaps = [];             // 捕获的冷灯色快照（{ light, r, g, b }）
  let tintActive = false;          // 上一帧是否有 tint 槽在写（退尽沿补一次白再放手）
  const WHITE = new THREE.Color(1, 1, 1);
  const scratch = new THREE.Color();
  const scratch2 = new THREE.Color();

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

  // ---- 基值快照（首个槽建立时捕获；还原永远写回最初基值）----
  function captureBase() {
    if (baseCaptured) return;
    baseCaptured = true;
    const mood = cast?.get?.('light:mood') ?? null;
    moodBase = mood ? { dim: mood.dim, fireGain: mood.fireGain } : null;
    // 冷结构灯色快照（染暖还原用；灯色不被 lighting.update 重写，可直推——
    // pyro 同口径。fx 池灯跳过：演出借用中，色随剧本走）。一律捕获（几个灯
    // 的常数开销），染灯主题进场时才有快照可用
    lightSnaps = [];
    for (const { handle } of cast?.query?.('light:') ?? []) {
      if (!handle?.isLight || handle.name?.startsWith('fxPool')) continue;
      const c = handle.color;
      if (c && c.b > c.r) lightSnaps.push({ light: handle, r: c.r, g: c.g, b: c.b });
    }
  }

  // ---- 槽件建/拆（只动槽内资产，不碰全场输出——全场由 update 逐帧复合）----
  function buildSlotAssets(slot) {
    const t = slot.theme;
    const A = anchors();
    if (!A.self && !A.mid) return;
    for (const d of t.drift ?? []) {
      const a = anchorOf(d.at, A);
      if (!a) continue;
      const handle = particles?.spawnEmitter?.(a.x, a.y + a.H * d.dy, {
        rate: 0, radius: a.H * 0.45, zJitter: a.H * 0.4,
        color: d.color, speed: d.speed, ttl: d.ttl, size: d.size,
        gravity: d.gravity, vby: d.vby ?? 0, z: a.z + (d.dz ?? 0),
      });
      if (handle) slot.emitters.push({ handle, baseRate: d.rate });
    }
    if (t.orbit) {
      slot.orbit = t.orbit.kind === 'fire'
        ? createFireWhirlLink(worldPool, { radiusK: t.orbit.radiusK, type: FIRE_WHIRL_ORBIT_CHANT })
        : createQiOrbitLink(worldPool, t.orbit);
      slot.orbit?.start();
    }
  }
  function teardownSlot(slot) {
    for (const e of slot.emitters) { try { e.handle.stop(); } catch (_) {} }
    slot.emitters = [];
    if (slot.ring) { try { slot.ring.handle.stop(); } catch (_) {} slot.ring = null; }
    slot.orbit?.dispose();
    slot.orbit = null;
  }

  // ---- 全灭沿（所有槽退尽）：全场输出写回基值 + 清快照，回到未捕获态 ----
  function quenchAll() {
    const mood = cast?.get?.('light:mood') ?? null;
    if (mood && moodBase) { mood.dim = moodBase.dim; mood.fireGain = moodBase.fireGain; }
    for (const s of lightSnaps) s.light.color.setRGB(s.r, s.g, s.b);
    if (tintActive) { composer?.setSceneTint?.([1, 1, 1]); tintActive = false; }
    moodBase = null;
    lightSnaps = [];
    baseCaptured = false;
  }

  // ---- 对账（每次状态同步）----
  function reconcile(snapshot) {
    const hand = snapshot?.hand ?? [];
    const next = new Map();
    for (const c of hand) {
      if (!c.isActivated) continue;
      const row = CARD_ROW[c.defId] ?? SERIES_ROW[c.series] ?? null;
      if (!row) continue;
      next.set(c.uniqueID, { defId: c.defId, themeKey: row.theme, k: row.k?.[c.tier] ?? 0.5, tip: chainTipOf(c.defId) });
    }
    let changed = next.size !== active.size;
    if (!changed) for (const [id, v] of next) {
      const old = active.get(id);
      if (!old || old.k !== v.k || old.themeKey !== v.themeKey) { changed = true; break; }
    }
    if (!changed) return;
    active.clear();
    for (const [id, v] of next) active.set(id, v);
    // 双持合成：同链（同链尖）取峰 → 跨链同主题强度叠加（cap 1）
    const perChain = new Map();    // tip → { themeKey, k }
    for (const v of active.values()) {
      const cur = perChain.get(v.tip);
      if (!cur || v.k > cur.k) perChain.set(v.tip, { themeKey: v.themeKey, k: v.k });
    }
    const perTheme = new Map();    // themeKey → 目标 k
    for (const v of perChain.values()) {
      perTheme.set(v.themeKey, Math.min(1, (perTheme.get(v.themeKey) ?? 0) + v.k));
    }
    // 目标落槽：新主题建槽（捕基值 + 建件），退场主题留槽退坡（k 归 0 由 update 收）
    for (const [key, target] of perTheme) {
      const theme = THEMES[key];
      if (!theme) continue;
      const slot = slots.get(key);
      if (slot) { slot.target = target; continue; }
      const fresh = { theme, k: 0, target, emitters: [], ring: null, orbit: null };
      slots.set(key, fresh);
      captureBase();
      buildSlotAssets(fresh);
    }
    for (const [key, slot] of slots) if (!perTheme.has(key)) slot.target = 0;
  }

  // ---- 帧泵：逐槽包络推进 + 槽内件派生 + 全场输出复合 ----
  function update(dt) {
    let anyAlive = false;
    for (const [key, slot] of slots) {
      if (slot.k !== slot.target) {
        const rate = slot.target > slot.k ? 2.2 : 3.0;   // 起 ~0.7s 爬满 / 收 ~0.5s 退尽
        slot.k += (slot.target - slot.k) * (1 - Math.exp(-rate * dt));
        if (Math.abs(slot.target - slot.k) < 0.004) slot.k = slot.target;
      }
      if (slot.target === 0 && slot.k <= 0.01) { teardownSlot(slot); slots.delete(key); continue; }
      anyAlive = true;
      const t = slot.theme;
      // 发射器 rate 随包络（点火渐密、熄灭渐稀）
      for (const e of slot.emitters) e.handle.rate = e.baseRate * slot.k;
      // 热浪环/地气环：达到 ringAt 才起（高级咏唱的「气蒸腾」档），参数随主题
      if (slot.k >= (t.ringAt ?? 1) && !slot.ring && t.ring) {
        const a = unitAnchor(playerId(), 0);
        if (a) {
          const R = t.ring;
          const handle = particles?.spawnEmitter?.(a.x, a.y + a.H * 0.15, {
            rate: 0, radius: a.H * 0.42, outward: true, vby: R.vby ?? 8, zJitter: a.H * 0.4,
            color: R.color, speed: R.speed, ttl: R.ttl, size: R.size, gravity: R.gravity, z: a.z,
          });
          if (handle) slot.ring = { handle, baseRate: R.rate ?? 30 };
        }
      }
      if (slot.ring) slot.ring.handle.rate = slot.ring.baseRate * slot.k;
      slot.orbit?.setLevel(slot.k);
      slot.orbit?.setAnchor(unitAnchor(playerId(), 0));
    }
    if (!anyAlive) {
      if (baseCaptured) quenchAll();
      return;
    }
    // 全场输出复合（只在做主期间逐帧落笔——pyro 等剧本同写时后到的一方覆盖，
    // 同 pvp 调光冲突量级可接受）：
    // mood = 基值 × Π(各槽 dim/fireGain 因子)（dimDrop/fireGainUp 全 0 的槽不写）
    const mood = cast?.get?.('light:mood') ?? null;
    if (mood && moodBase) {
      let dim = moodBase.dim;
      let fireGain = moodBase.fireGain;
      for (const slot of slots.values()) {
        const t = slot.theme;
        if (t.dimDrop || t.fireGainUp) {
          dim *= (1 - t.dimDrop * slot.k);
          fireGain *= (1 + t.fireGainUp * slot.k);
        }
      }
      mood.dim = dim;
      mood.fireGain = fireGain;
    }
    // tint = Π(各槽 白→主题色按 k 插值)（无 tint 槽 = 不写，退尽沿 quenchAll 补白）
    scratch.setRGB(1, 1, 1);
    let tintWrote = false;
    for (const slot of slots.values()) {
      const t = slot.theme;
      if (!t.tint) continue;
      scratch2.setRGB(t.tint[0], t.tint[1], t.tint[2]);
      scratch2.lerpColors(WHITE, scratch2, slot.k);
      scratch.r *= scratch2.r; scratch.g *= scratch2.g; scratch.b *= scratch2.b;
      tintWrote = true;
    }
    if (tintWrote) {
      composer?.setSceneTint?.([scratch.r, scratch.g, scratch.b]);
      tintActive = true;
    } else if (tintActive) {
      composer?.setSceneTint?.([1, 1, 1]);
      tintActive = false;
    }
    // 冷结构灯染色 = 自快照色逐槽插值（无染灯槽 = 写回快照色，天然归基）
    for (const s of lightSnaps) {
      let r = s.r, g = s.g, b = s.b;
      for (const slot of slots.values()) {
        const t = slot.theme;
        if (!t.lightWarm) continue;
        const wk = (t.lightWarmK ?? 0.5) * slot.k;
        r += (t.lightWarm[0] - r) * wk;
        g += (t.lightWarm[1] - g) * wk;
        b += (t.lightWarm[2] - b) * wk;
      }
      s.light.color.setRGB(r, g, b);
    }
  }

  function dispose() {
    for (const slot of slots.values()) teardownSlot(slot);
    slots.clear();
    active.clear();
    if (baseCaptured) quenchAll();
  }

  return {
    reconcile, update, dispose,
    get level() { let m = 0; for (const s of slots.values()) m = Math.max(m, s.k); return m; },
  };
}
