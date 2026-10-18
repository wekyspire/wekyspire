// Boss 剧本：燃焰术士（pyro）。一只 Boss 的全部自定义演出聚合在本文件（内容归属原则）。
// 触发点见 core enemies.js pyro act（转段拍经 presenter.playScript 上报 id）。
// 视觉总纲：
//   · 机位**按舞台真 fov 反解**（`camera.framing` / `camera.basePose`）：战斗相机是 24° 长焦，
//     视野高度 ≈0.42×距离——写死距离的构图必废。常驻机位走 duelPose（基准取景的
//     长焦平视派生），**转段不切特写**；
//   · 整段 4s，三轨（火焰燃烧 / 场景变换 / 物体焚化）各自错峰（见 T 与各段注释）；
//   · 蓄力带「吸气」：四周余烬被拽进胸口（向心 sprite + 速度对齐的拖影）；
//   · 爆发双道细环冲击波 + 炽闪（贴地世界环在平视机位下会侧看成一条线，不用）；
//   · 烧毁覆盖 wood+cloth 双族（Boss 房的旗杆与布旗一起烧焦，视觉信息量才够）；
//   · 光照覆写走「压冷光 + 抬火光」的光池口径（全灯统一提亮染红会把整场洗成
//     牛奶红，读不出细节）；余烬发射位按 Boss 体量派生，不写死房间坐标；
//   · 常驻机位带极慢呼吸漂移（长回合战斗不呆）；
//   · 火球狂暴推 orbit.heat（orbs.js 口径：亮度/抖幅/尾迹/灯光整体升温）。
import * as THREE from 'three';
import { materialOf } from '../../../scenes/kit/materials.js';
import { desatColor } from '../../../scenes/kit/palette.js';
import { duelPose, viewHeightOf } from '../../camera.js';
import { attachCharBurn, resetCharBurn } from '../../charBurn.js';
import { arcProjectile, fireBurst, screenFlash, groundRing, lampPulse, dreadVeil } from '../../spells/blocks.js';
import { registerEnemyHitBeat, registerEnemyNoLunge } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossHurtFx } from '../../bossStateFx.js';
import { glowTexture } from '../../orbs.js';
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../../core/intentKinds.js';

// 冲击波环纹理（按"厚/薄"两档缓存；additive 下黑=透明）
//   fat  = 炽闪用的大光晕（宽带，几乎不出环）
//   thin = 炸开用的冲击波（白热峰只占 2.5% 半径 + 内缘一道暗带）——
//          环拉到大体量时宽带版会糊成一圈肥皂泡，细环才读得出"气浪"
const _ringTex = new Map();
function ringTexture(thin = false) {
  const key = thin ? 'thin' : 'fat';
  if (_ringTex.has(key)) return _ringTex.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  if (thin) {
    // 只留一道白热细峰 + 极窄的暖边（内缘那道 0.18 的橙带铺到大半径
    // 就成了一整面棕色球壳，气浪读成了肥皂泡）
    grad.addColorStop(0, 'rgba(255,120,40,0)');
    grad.addColorStop(0.72, 'rgba(255,120,40,0)');
    grad.addColorStop(0.86, 'rgba(255,150,60,0.09)');
    grad.addColorStop(0.955, 'rgba(255,250,240,1)');
    grad.addColorStop(0.985, 'rgba(255,170,80,0.3)');
    grad.addColorStop(1, 'rgba(255,110,30,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,150,60,0)');
    grad.addColorStop(0.84, 'rgba(255,170,80,0.55)');
    grad.addColorStop(0.92, 'rgba(255,248,230,1)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
  }
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ringTex.set(key, tex);
  return tex;
}

// 余烬流火纹理：横向拉长的炽白核 + 尾焰（吸气时被拽着的火星，头亮尾暗才读得出方向）
let _streakTex = null;
function streakTexture() {
  if (_streakTex) return _streakTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(8, 64, 120, 64);
  grad.addColorStop(0, 'rgba(255,120,40,0)');
  grad.addColorStop(0.62, 'rgba(255,160,70,0.55)');
  grad.addColorStop(1, 'rgba(255,250,235,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(64, 64, 58, 11, 0, 0, Math.PI * 2); // 长轴朝 +x：sprite.rotation 对齐速度即拖在身后
  g.fill();
  const core = g.createRadialGradient(104, 64, 1, 104, 64, 18);
  core.addColorStop(0, 'rgba(255,255,245,0.95)');
  core.addColorStop(1, 'rgba(255,255,245,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  _streakTex = new THREE.CanvasTexture(c);
  _streakTex.colorSpace = THREE.SRGBColorSpace;
  return _streakTex;
}

/**
 * 机位反解：给定「立牌高度占画框纵向的比例 bodyFrac」与「脚底在画框的纵向位置
 * feetFrac（0=顶，1=底）」，从舞台真实 fov 解出距离与注视点。
 * 铁律：不写死世界坐标——长焦/广角一改，写死的构图就全废。
 * @param {object} unit   宿主 UnitObject（position.y = 脚底，_standeeHeight = 立牌高）
 * @param {object} camera CameraDirector（取 framing 量尺）
 * @param {number} lateral 横向偏移（负 = 从 Boss 左侧看，给构图一点角度）
 * @param {number} tilt     机位相对注视点的纵向偏移（占视野高度；负 = 仰拍）
 */
function poseFor(unit, camera, { bodyFrac, feetFrac, lateral = 0, tilt = 0 }) {
  const H = unit._standeeHeight ?? 22;
  const { fov = 24 } = camera?.framing ?? {};
  const k = 2 * Math.tan((fov * Math.PI) / 360); // 视野高度 = k × 距离
  const viewH = H / bodyFrac;
  const dist = viewH / k;
  const lookY = unit.position.y + (feetFrac - 0.5) * viewH;
  return {
    position: { x: unit.position.x + lateral, y: lookY + tilt * viewH, z: unit.position.z + dist },
    lookAt: { x: unit.position.x, y: lookY, z: unit.position.z },
  };
}

// 转段时间轴（ms，整段 4s）。蓄力与爆发**都在 P2 构图里演**
// （相机只走 A→B 一条线，不跳特写），时间预算全花在动作与三轨错峰上：
//   火焰燃烧轨（吸气/点燃/火舌/二次浪/火球升温）、场景变换轨（光照由近及远）、
//   物体焚化轨（布先木后，烧黑→侵蚀两拍）各自起步时刻与时长都不同步 = 「参差」。
// 下面的数是**剧本协程自报的分段时长**（总和 = 本拍阻塞时长，实测口径见 tmp/play/pyro-dur.mjs）。
// 转段拍的受击动画排在前面，第一个 ctx.custom 要晚半拍才起跳，所以吸气/火舌那些
// 循环的拍数都按 T 的整窗给（10×170≈CHARGE、5×110≈BURN[0]…），别让它们跑在补间前面。
// 烧毁着色器 program 由 BattleStage 入场预热（warmCharBurn）——现场编译会冻主线程
// 0.7s 把时长吞掉，预热后时间轴是纯设计值。
const T = {
  CHARGE: 1700, // 憋火：缓压到底 + 底位高频颤 + 逐级点燃
  POP: 240, // 爆发后过冲弹起
  SETTLE: 330, // 弹回复稳
  BURN: [560, 620, 560], // 燃躯三拍：火舌窜体 → 环火二次浪 → 吐灰定相
  SWAY_AT: 4.6, // 常驻微运动介入（秒）：转段三记震荡全部收尾之后才开始呼吸——
                // 「先震完、再慢慢飘」读成两件事，叠在爆发那一震上会糊成一片抖动
};
const sstep = (x) => x * x * (3 - 2 * x); // 压扁曲线：起步与到位都软，中段陡

// 转阶段「燃躯解放」（转段首拍空转 = 本剧本，放行 ≈4.0s 阻塞节拍）：
//   蓄力（1.5s）：推镜到对抗机位 + 下蹲吸气（压扁到底后高频颤）+ 余烬被吸进胸口 + 五级点燃
//   爆发（瞬发）：闪橙 + 炽闪 + 双道细环冲击波 + 四层火星爆散 + 重震荡 + 渐晕
//   燃躯（1.5s，三拍）：火自体内窜出 → 环火二次浪 → 吐一口火灰定相
//   场景覆写（爆发瞬间点火，常驻到战斗结束——三级覆写阶梯的 L1/L2 运行时形态）：
//     ① 相机已在蓄力段落到 P2 常驻「对抗机位」（duelPose：与基准战斗镜头同内容，长焦 + 平视）
//     ② 光照转「火主冷辅」：结构光走 mood 乘子压暗（边缘沉底）+ 火光乘子反抬，
//        灯色以 Boss 为圆心由近及远错峰染暖；火主近旁挂点光（亮橙黄 → 血红两段过渡）
//     ③ 布件先焚、木件后裂：charBurn modifier 挂 M.cloth / M.wood，两族各走自己的烧黑→侵蚀
//     ④ 场景余烬：火盆口 + 机位可见空域飘灰 + 以 Boss 为心的三圈热浪环（向外荡开、
//        向上蒸腾；锚舞台寿命停发，逐缕/逐圈错开起步）
//     ⑤ 环绕火球升温：orbit.heat 0→1（半径/转速同推）
// 常驻效果一律挂 onStageDispose（不是 ctx.onKill——onKill 在剧本正常收尾也会触发，
// 会把刚点着的常驻演出当场收掉）。自燃披风（全场燃烧7）下一拍由 act 结算——
// aura 系统经状态同步自动点燃，本剧本不管。
async function pyroP2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById, setArtVariant }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  unit._bossPhase = 2; // act 分支的转段拍判别（enemyAct 以旧意图 kinds 先行触发，见 pyroAct）
  const id = unit.uniqueID;
  const ux = unit.position.x;
  const uy = unit.position.y;
  const uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22; // 立牌高：全剧本纵向尺（origin 在脚底）
  const chestY = uy + H * 0.55;
  // 光照基线在蓄力前捕获：蓄力段「吸光」下探、爆发后按基线反算终值——若读当前值
  // 会把下探结果再乘一遍（火光乘子同理）
  const mood = cast.get('light:mood');
  const dim0 = mood?.dim ?? 1;
  const fireGain0 = mood?.fireGain ?? 1;
  let moodHanded = false;   // 爆发后常驻覆写接管；只有中途被杀才恢复基线
  ctx.onKill(() => {
    if (!moodHanded && mood) { mood.dim = dim0; mood.fireGain = fireGain0; }
    unit.scale.set(s, s, 1);   // 蓄力/过冲直接写根缩放：被打断时不留压缩残形
  });

  // —— P2 常驻机位：基准战斗取景的「长焦 + 平视」派生（duelPose）——
  // 注视点/方位都不动 ⇒ 画里内容与默认战斗镜头基本一致（队友、战场、房间全在），
  // 但 fov 24°→17.8°、俯角 20°→9°：透视被压扁，敌我两排贴到同一层平面上，
  // 对抗感来自镜头本身而不是怼脸。
  // **转段全程也不切特写**：镜头只走 A（基准）→ B（对抗机位）一条线，
  // 蓄力与爆发都在最终构图里演——玩家看到的景别始终不变，火是在他眼皮底下长起来的。
  const base = camera?.basePose;
  const p2Pose = base
    ? duelPose(base, { fovScale: 0.74, elScale: 0.45 })
    : poseFor(unit, camera, { bodyFrac: 0.52, feetFrac: 0.66, lateral: -13, tilt: -0.03 }); // 冒烟桩只有 pushOverride
  const viewH = base ? viewHeightOf(p2Pose) : H / 0.52; // 常驻视野高度（余烬/微运动的尺度都按它给）

  // —— 蓄力：推镜到位 + 吸气缭绕（并行子本）——
  const sway = { t: 0 }; // 常驻微运动的钟（震荡走完才介入，不与补间抢笔）
  camera?.pushOverride?.('pyroP2', {
    poses: { pyroP2: p2Pose },
    // 到位要快：900ms power2.out——蓄力前半段就把镜头落到最终景别，
    // 后面的憋压、点燃、吸气、爆发全在 P2 构图里演完（慢进 = 演出白做一半）
    onEnter: (dir) => { dir.flyTo('pyroP2', { durationMs: 900, ease: 'power2.out' }); },
    onTick: (dt, dir) => {
      sway.t += dt;
      if (sway.t < T.SWAY_AT) return;
      const k = sway.t - T.SWAY_AT;
      // 三条漂移都写成「k=0 时严格为 0」的零相位式（sin(0)=0、cos-1、y 不带初相），
      // 再乘 1.2s 缓入包络——介入瞬间必须与静止位**连续**，否则常驻机位会当场瞬移
      // 2.7u ≈ 25px
      const ramp = sstep(Math.min(1, k / 1.2));
      const b = dir.getPose('pyroP2');
      // 写**偏移通道**而不是相机：呼吸漂移各占一路，与受击震荡、任何在途运镜求和叠加
      // （直写 cam.position 是绝对落笔，与震荡抢笔会产生肉眼可感的跳变）
      dir.setOffset('pyroSway',
        Math.sin(k * 0.33) * viewH * 0.035 * ramp,
        Math.sin(k * 0.24) * viewH * 0.02 * ramp,
        (Math.cos(k * 0.19) - 1) * viewH * 0.03 * ramp);
      // 视线跟着呼吸微抬：改权威注视点，导演下一帧自动重新定向
      dir.setLookAt(b.lookAt.x, b.lookAt.y + Math.sin(k * 0.27) * viewH * 0.012 * ramp, b.lookAt.z);
    },
    // 退激活（被 cutscene 压栈 / 战斗收尾弹栈）：撤掉自己那路通道，别把漂移留给别人
    onExit: (dir) => { dir.clearOffset('pyroSway'); },
  });
  ctx.spawn(async (c) => {
    // 吸气：每拍从胸口外一圈拽回几缕余烬（向心直线 + 头亮尾暗的拖影），
    // 越到后面越密也越急，配合压扁读成「把火吸进身体」。
    // 拍数按实测蓄力窗给（10×170≈1.7s）：本剧本的 ctx.custom 排在敌方受击动画之后，
    // 起跳要晚 ~0.5s（pyro-dur 量得），只按 T.CHARGE 给数会提前吸完
    for (let i = 0; i < 10; i++) {
      const n = 3 + Math.min(i, 4);
      const pull = 0.55 - i * 0.03; // 吸合时长递减 = 越吸越急
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = H * (0.55 + Math.random() * 0.6);
        const px = ux + Math.cos(a) * r;
        const py = chestY + Math.sin(a) * r * 0.75;
        const vx = (ux - px) / pull;
        const vy = (chestY - py) / pull;
        const rec = particles.spawnSprite(px, py, {
          texture: streakTexture(), width: 3.2, height: 0.9, z: uz + Math.sin(a) * r * 0.3,
          vx, vy, gravity: 0, ttl: pull, scalePop: 0.3,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx); // 长轴对齐速度 = 拖在身后
      }
      particles.spawn(ux, chestY, { count: 3, color: 0xff8c3a, speed: 6, ttl: 0.6, size: 1.2, z: uz });
      await c.wait(170);
    }
  });
  // 蓄力焦点：胸口火核渐长（压力容器——火不是凭空炸开，是先被压进去）。
  // CPU 贴图件的透明度由寿命三角形驱动：在蓄力过半生成、ttl 取整段蓄力，
  // 峰值恰好落在爆发瞬间；几何补间同步把核胀到半身大，读成「憋到极限」。
  ctx.spawn(async (c) => {
    const half = Math.round(T.CHARGE * 0.5);
    await c.wait(half);
    const core = particles.spawnSprite(ux, chestY, {
      texture: glowTexture(0xffcf9a), width: H * 0.12, height: H * 0.12, z: uz + 1.2,
      ttl: (T.CHARGE / 1000) * 0.95, fadeIn: true, gravity: 0,
    });
    if (core) {
      await c.tweenRaw(core, { w: H * 0.52, h: H * 0.52 }, { durationMs: half, ease: 'power2.in' });
    }
  });
  // 吸光：结构光与火光同时下探（他连房间的光一起吸）——爆发后由常驻覆写按基线
  // 反算终值，这里的下探不会被叠乘
  if (mood) {
    ctx.spawn((c) => Promise.all([
      c.tweenRaw(mood, { dim: dim0 * 0.82 }, { durationMs: Math.round(T.CHARGE * 0.9), ease: 'power2.in' }),
      c.tweenRaw(mood, { fireGain: fireGain0 * 0.72 }, { durationMs: Math.round(T.CHARGE * 0.9), ease: 'power2.in' }),
    ]));
  }
  // 胸口借池灯随蓄力爬升、爆发瞬间落下（随后常驻熔炉灯接管 fx0）
  ctx.spawn((c) => lampPulse(c, { cast }, {
    name: 'light:fx1', at: { x: ux, y: chestY, z: uz + 2 }, color: [1, 0.55, 0.2],
    peak: 1250, attackMs: Math.round(T.CHARGE * 0.9), decayMs: 220,
  }));
  shake.impulse(0.4);
  // 憋火：前 6 成时间缓压到底（smoothstep——起步软、到位硬），后 4 成**在底位高频颤**
  // （憋不住的火，不是压扁到终点就死掉），同时五级点燃一次比一次亮（蓄力中段
  // 必须有内容，否则「蓄力」读成卡顿）
  const IGNITE_AT = [[0.12, 0xff8a45], [0.3, 0xff9a4a], [0.5, 0xffb060], [0.68, 0xffc884], [0.86, 0xffe3b4]];
  const ignite = IGNITE_AT.map(() => false);
  await ctx.custom(id, {
    durationMs: T.CHARGE, ease: 'none',
    onUpdate: (t) => {
      const sec = (t * T.CHARGE) / 1000;
      const press = sstep(Math.min(1, t / 0.6));
      const held = Math.max(0, (t - 0.6) / 0.4); // 底位颤动随剩余时间渐强
      const shudder = held * Math.sin(sec * Math.PI * 2 * 8.5) * 0.026;
      unit.scale.set(s * (1 - 0.13 * press + shudder * 0.6), s * (1 - 0.32 * press + shudder), 1);
      IGNITE_AT.forEach(([at, col], i) => {
        if (ignite[i] || t < at) return;
        ignite[i] = true;
        unit.flash?.(col);
      });
    },
  });

  // —— 爆发：炽闪 + 双道冲击环 + 火星炸开 ——
  unit.flash?.(0xff7a30);
  // 换形态（空兜帽 → 双眼发光 + 火翼张开）走公共编排 ctx.flip：翻转 → 侧立那一帧换图 →
  // 展开回正。侧立时立牌投影宽度为 0，贴图替换天然看不见，比「拿白光遮一下」更有形。
  // 不 await：640ms 全跑在弹起 + 燃躯三拍里，转段总时长不受影响。
  ctx.flip(unit.standee, () => setArtVariant?.(unit, 'p2'), { durationMs: 640 });
  // 炽闪：一团主题色大光晕原地亮起速灭（scalePop 出生弹跳 + 短 ttl；按立牌体量，
  // 光晕盖过半身但不能盖满屏——满屏即洗白整帧）。没有特写垫着，
  // 体量按常驻景别给（H 的六成长这样，广角里才读得出「炸」）
  particles.spawnSprite(ux, chestY, {
    texture: ringTexture(), width: H * 0.62, height: H * 0.62, z: uz - 1,
    ttl: 0.3, gravity: 0, scalePop: 0.6,
  });
  // 相机面冲击环 ×2：spawnSprite 拿到 rec 后直推 rec.w/h（sprite.scale/opacity 每帧由
  // 粒子系统从 rec 重写 + 按寿命淡出，补 tween sprite 会被覆写）。
  // 用细环纹理（ringTexture(true)）：宽带版拉到两倍立牌高就糊成一圈肥皂泡，
  // 白热细峰才读得出「一道气浪推开」。两道错开——外环快而远（先到的浪头）+
  // 内环慢而厚（余势），单层环看不出厚度。
  const WAVES = [
    { w0: 0.32, w1: 1.5, ttl: 0.56, ms: 560, ease: 'power2.out' },
    { w0: 0.24, w1: 1.08, ttl: 0.78, ms: 780, ease: 'power1.out' },
  ];
  for (const [i, wv] of WAVES.entries()) {
    const ring = particles.spawnSprite(ux, chestY, {
      texture: ringTexture(true), width: H * wv.w0, height: H * wv.w0, z: uz + 2 + i,
      ttl: wv.ttl, gravity: 0,
    });
    if (!ring) continue;
    (runScript ?? ((body) => { ctx.spawn(body); }))(async (c) => {
      await c.tweenRaw(ring, { w: H * wv.w1, h: H * wv.w1 }, { durationMs: wv.ms, ease: wv.ease });
    });
  }
  particles.spawn(ux, chestY, { count: 44, color: 0xff6a3d, speed: 52, size: 1.9, z: uz });
  particles.spawn(ux, chestY, { count: 26, color: 0xffd9a0, speed: 74, ttl: 0.75, size: 1.3, z: uz });
  particles.spawn(ux, chestY, { count: 18, color: 0xc23a1a, speed: 28, ttl: 1.2, size: 2.3, z: uz });
  particles.spawn(ux, chestY, { count: 14, color: 0xffb066, speed: 18, ttl: 1.8, size: 1.1, gravity: 8, z: uz }); // 上升热灰
  shake.impulse(6.5);
  vignette.pulse(3);

  // —— 场景覆写 ②~⑤：常驻渐升整体挂舞台寿命的独立剧本——
  // ctx.spawn 的子本会随本拍收尾被连带杀掉（onKill 在正常收尾也触发），
  // 起得晚的渐升（uBurn/余烬 rate/光照后段）会冻结在半截；runScript 缺失时兜底退回 ctx.spawn。
  // 三轨起步时刻**互不相同**（⑤火焰=爆发即起、②场景=由近及远逐灯、③焚化=布先木后），
  // 才读得出「房间在他周围一件件烧起来」，而不是一次整体淡入（参差要具体）。
  const orbit = unit.parts?.get('orbs')?.userData?.orbit;
  moodHanded = true;   // 常驻覆写从这里接管光照（中途被杀才回滚蓄力下探）
  (runScript ?? ((body) => { ctx.spawn(body); }))(async (c) => {
    const jobs = [];
    // ② 光照转「火主冷辅」：强度一律走 mood 乘子（lighting.update 每帧按 base×periph
    //    重写各灯强度——直推 light.intensity 会被当场覆盖）；灯色仍可直推。
    //    结构光整体压暗（房间边缘沉下去）+ 火光乘子反抬（火盆/烛火更跳），
    //    再逐灯以 Boss 为圆心由近及远错峰染色。终值一律从蓄力前基线反算。
    if (mood) {
      jobs.push(c.tweenRaw(mood, { dim: dim0 * 0.62 }, { durationMs: 1700, delayMs: 150 }));
      jobs.push(c.tweenRaw(mood, { fireGain: fireGain0 * 1.9 }, { durationMs: 1500, delayMs: 300 }));
    }
    const emberCol = desatColor(0xff7a2e, { k: 0.35, cap: 0.45 });
    const lights = [];
    for (const { handle } of cast.query('light:')) {
      if (!handle?.isLight) continue; // light:root 门面 / light:mood 句柄跳过
      const p = handle.position;
      lights.push({ handle, d: p ? Math.hypot(p.x - ux, p.z - uz) : 0 });
    }
    const dMax = Math.max(1, ...lights.map((l) => l.d));
    for (const { handle, d } of lights) {
      const lag = 120 + (d / dMax) * 900; // 离火主近的灯先变
      const col = handle.color;
      if (!col) continue;
      const warm = col.r > col.b;
      if (warm) {
        jobs.push(c.tweenRaw(col, { r: emberCol.r, g: emberCol.g, b: emberCol.b }, { durationMs: 1500, delayMs: lag + 420 }));
      } else {
        jobs.push(c.tweenRaw(col, {
          r: Math.min(1, col.r * 1.1 + 0.06), g: col.g * 0.94, b: col.b * 0.8,
        }, { durationMs: 2200, delayMs: lag + 500 }));
      }
    }
    // ②b 火主近旁光（挂单位 = 跟随，不进 lighting.group ⇒ update 不管它，强度自由补间）：
    //    爆发即亮的亮橙黄，随后颜色沉向血红、强度再抬一档——「亮橙黄 → 红」两段过渡，
    //    把 Boss 立牌与近旁地面从暗场里托出来。
    //    灯从舞台光池借（light:fx0）：演出中途 new + add 灯会触发全场景
    //    着色器重编译冻帧；池灯入场即在场景里，重挂到单位不触发重编译
    const bossLight = cast.get('light:fx0');
    if (bossLight) {
      bossLight.color.set(0xffc266);
      bossLight.distance = H * 6.5;
      bossLight.position.set(0, H * 0.55, H * 0.3);
      unit.add(bossLight);
      onStageDispose?.(() => { bossLight.intensity = 0; unit.remove(bossLight); });
      jobs.push(c.tweenRaw(bossLight, { intensity: 3400 }, { durationMs: 700, delayMs: 100, ease: 'power2.out' }));
      jobs.push(c.tweenRaw(bossLight.color, { r: 1.0, g: 0.2, b: 0.06 }, { durationMs: 2600, delayMs: 1400 }));
      jobs.push(c.tweenRaw(bossLight, { intensity: 4600 }, { durationMs: 2600, delayMs: 1400 }));
    }
    // ③ 焚化分轨（族单例挂 modifier）：布易燃——先黑、蚀得深；木后裂——只啃表皮。
    //    每族两拍（uChar 烧黑 → uBurn 侵蚀）各带自己的 delay，错峰推进而非串行到底。
    //    burnTo 口径：前沿 = uBurn×1.35 − 0.35·hash ⇒ 0.4 ≈ 啃掉四成、留六成骨架；
    //    再高就把旗啃成一片彩纸噪点
    //    attach 在这里只是兜底（幂等）：Boss 房的 program 已由 BattleStage 入场预热，
    //    这一拍推的是 uniform——现场打补丁会触发重编译，把演出冻住半秒
    const CHAR = [
      { fam: 'cloth', charAt: 260, charMs: 1500, charTo: 0.82, burnAt: 1250, burnMs: 2700, burnTo: 0.4 },
      { fam: 'wood', charAt: 980, charMs: 1900, charTo: 0.66, burnAt: 2300, burnMs: 3400, burnTo: 0.24 },
    ];
    for (const cfg of CHAR) {
      let rec;
      try { rec = attachCharBurn(materialOf(cfg.fam)); } catch { rec = null; }
      if (!rec) continue;
      onStageDispose?.(() => resetCharBurn(rec)); // 族单例跨场景共享，归零防漏场
      jobs.push(c.tweenRaw(rec.uChar, { value: cfg.charTo }, { durationMs: cfg.charMs, delayMs: cfg.charAt }));
      jobs.push(c.tweenRaw(rec.uBurn, { value: cfg.burnTo }, { durationMs: cfg.burnMs, delayMs: cfg.burnAt }));
      // uTime 线性推（余烬闪的钟；舞台寿命剧本内 = 与烧痕同生共死，dispose 即停）
      c.tweenRaw(rec.uTime, { value: 600 }, { durationMs: 600000, ease: 'none' }); // fire-and-forget
    }
    // ④ 场景余烬：火盆口照旧（房间其它角度看得见的义务），另外在**机位可见空域**
    //    撒四缕飘灰——写死房间坐标会让发射器全在画框外，
    //    现在一律按 Boss 体量派生（灰是他的火，得围着他）。每缕自己的起步时刻错开
    //    （0.5/0.9/1.5/2.1s）：灰是一层一层飘起来的，不是一开阀就满屏
    for (const { handle } of cast.query('prop:brazierFire')) {
      const p = handle.object?.position;
      if (!p) continue;
      const em = particles.spawnEmitter(p.x, p.y + 2.5, {
        rate: 0, radius: 2.2, color: 0xff7a30, speed: 5, ttl: 1.6, size: 1.1, gravity: 3, z: p.z,
      });
      if (!em) continue;
      onStageDispose?.(() => em.stop());
      jobs.push(c.tweenRaw(em, { rate: 14 }, { durationMs: 1800, delayMs: 200 }));
    }
    const drifts = [
      [ux - H * 1.1, uz + H * 0.4, 22, 900], // 中景左：贴着 Boss 身侧升起
      [ux + H * 0.95, uz + H * 0.9, 16, 1500], // 远景右：烧痕背景上的浮灰
      [ux - H * 0.2, uz + H * 1.6, 11, 2100], // 前景：镜头前的飘灰（纵深）
      [ux + H * 0.1, uz - 10, 20, 500], // 剪影后：从 Boss 背后升起的一片火灰
    ];
    for (const [ex, ez, rate, lag] of drifts) {
      const em = particles.spawnEmitter(ex, uy + H * 0.3, {
        rate: 0, radius: H * 0.35, color: 0xff8a3a, speed: 4.5, ttl: 2.8, size: 1.35, gravity: 3.4, z: ez,
      });
      if (!em) continue;
      onStageDispose?.(() => em.stop());
      jobs.push(c.tweenRaw(em, { rate }, { durationMs: 2400, delayMs: lag }));
    }
    // ④b 热浪环：以 Boss 为心的三圈 outward 发射 + 上升偏置（emitter 方向窗/径向散布）
    //    ——内圈亮金而急、中圈主橙、外圈暗红大而缓（余烬碎皮感）；
    //    速率/尺寸/颜色/起步全不同，读作热气从火主身上一圈圈荡开、向上蒸腾
    const heatRings = [
      { r: H * 0.5, rate: 36, speed: 15, vby: 9, size: 1.1, color: 0xffd9a0, ttl: 1.4, lag: 300 },
      { r: H * 1.05, rate: 28, speed: 10, vby: 9, size: 1.9, color: 0xff7a30, ttl: 2.1, lag: 900 },
      { r: H * 1.7, rate: 18, speed: 7, vby: 11, size: 2.7, color: 0xd93a14, ttl: 2.7, lag: 1600 },
    ];
    for (const hr of heatRings) {
      const em = particles.spawnEmitter(ux, uy + H * 0.2, {
        rate: 0, radius: hr.r, outward: true, vby: hr.vby, color: hr.color,
        speed: hr.speed, ttl: hr.ttl, size: hr.size, gravity: 6, zJitter: H * 0.55, z: uz,
      });
      if (!em) continue;
      onStageDispose?.(() => em.stop());
      jobs.push(c.tweenRaw(em, { rate: hr.rate }, { durationMs: 2200, delayMs: hr.lag }));
    }
    // ⑤ 环绕火球升温（orbs.js heat 口径：亮度/抖幅/尾迹/灯光整体涨，轨道参数同推）
    //    爆发即起，但拉长到 2.2s——与燃躯三拍同轨收尾，狂暴是「长出来的」不是「切过去的」
    if (orbit) jobs.push(c.tweenRaw(orbit, {
      radius: orbit.radius * 1.3, speed: orbit.speed * 2.0, heat: 1,
    }, { durationMs: 2200, ease: 'power2.out', delayMs: 150 }));
    await Promise.all(jobs);
  });

  // 过冲弹起（0.88/0.68 → 1.15）再回稳，终态硬化到 _baseScale（防 reconcile 前的残形）
  await ctx.custom(id, {
    durationMs: T.POP, ease: 'power3.out',
    onUpdate: (t) => unit.scale.set(s * (0.88 + 0.27 * t), s * (0.68 + 0.47 * t), 1),
  });
  await ctx.custom(id, {
    durationMs: T.SETTLE, ease: 'power2.out',
    onUpdate: (t) => { const k = 1.15 - 0.15 * t; unit.scale.set(s * k, s * k, 1); },
  });
  unit.scale.set(s, s, 1);

  // —— 燃躯三拍（爆发之后镜头不动，让「他变成火主」这件事在 P2 构图里演满 1.5s）——
  // ① 火自体内窜出：沿躯干自下而上连吐五记火舌（竖长光晕上冲 + 一串上升火星），
  //    每记配一次体表白热闪——火是从他身体里长出来的，不是外面点起来的
  ctx.spawn(async (c) => {
    for (let i = 0; i < 5; i++) {
      const y = uy + H * (0.12 + i * 0.19);
      particles.spawnSprite(ux + (Math.random() - 0.5) * H * 0.3, y, {
        texture: ringTexture(), width: H * 0.3, height: H * 0.54, z: uz + 1.5,
        vy: 11 + i * 2.5, gravity: 5, ttl: 0.46, scalePop: 0.35,
      });
      particles.spawn(ux, y, {
        count: 9, color: i > 2 ? 0xffd9a0 : 0xff7a3a, speed: 13, ttl: 0.9, size: 1.5, gravity: 9, z: uz,
      });
      unit.flash?.(0xffb060);
      await c.wait(110);
    }
  });
  await ctx.wait(T.BURN[0]);

  // ② 环火二次浪：胸口再推一道细环（比爆发那两道慢而厚 = 余势）+ 三圈贴体上升的火旋
  ctx.spawn(async (c) => {
    const ring = particles.spawnSprite(ux, chestY, {
      texture: ringTexture(true), width: H * 0.3, height: H * 0.3, z: uz + 3, ttl: 0.72, gravity: 0,
    });
    if (ring) c.tweenRaw(ring, { w: H * 1.28, h: H * 1.28 }, { durationMs: 640, ease: 'power1.out' });
    for (let i = 0; i < 3; i++) {
      particles.spawn(ux, uy + H * (0.22 + i * 0.26), {
        count: 16, color: 0xff9a4a, speed: 9 + i * 3, ttl: 0.55, size: 1.7, gravity: 12, z: uz,
      });
      await c.wait(150);
    }
  });
  shake.impulse(1.6);
  await ctx.wait(T.BURN[1]);

  // ③ 吐灰定相：胸口朝玩家侧吐四口火灰（头亮尾暗的拖影向外散），末了一记轻震收拍
  ctx.spawn(async (c) => {
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.7; // 上半球散开
        const sp = 9 + Math.random() * 8;
        const vx = Math.cos(a) * sp;
        const vy = Math.sin(a) * sp + 4;
        const rec = particles.spawnSprite(ux + vx * 0.05, chestY + vy * 0.05, {
          texture: streakTexture(), width: 3.4, height: 1.0, z: uz + 2.5,
          vx, vy, gravity: 2.2, drag: 1.5, ttl: 1.15,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
      }
      await c.wait(130);
    }
  });
  vignette.pulse(0.9);
  await ctx.wait(T.BURN[2]);

  unit.restoreColor?.();
}

// —— 命中 beat（火主题）：术士的火不是钝器——命中 = fireBurst
// 落点爆（锚玩家脚边、火向上烧）+ 溅烬，不再是 punchImpact 换色。重击 = 更大的
// 火体 + 暖闪 + 震屏（enemyImpactBeat 骨架整段弃用：拳环读「打」，火体读「烧」）。
async function pyroHitBeat(ctx, deps, args) {
  const { unit, dealt } = args;
  const heavy = args.fx.tier === 'heavy';
  const feet = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
  // 重击按实际伤害分级：P1 重击 18 与 P2 重击 24 必须读得出体量差（旧版两者同尺寸）
  const scale = heavy
    ? 1.2 + Math.min(dealt / 40, 0.9)
    : 0.78 + Math.min(dealt / 60, 0.25);
  if (heavy) ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.16, ms: 210, color: 0xffb888 }));
  await fireBurst(ctx, deps, {
    at: feet,
    scale,
    ms: heavy ? 520 : 380,
    color: heavy ? [1.0, 0.36, 0.10] : [1.0, 0.46, 0.16],
    hot: heavy ? [1.35, 0.85, 0.42] : [1.2, 0.9, 0.5],
    ember: [1.0, 0.2, 0.05],
    sparkColor: 0xff8a3a,
    sparkCount: heavy ? Math.round(18 + dealt) : 15,
    linger: { count: heavy ? Math.round(10 + dealt / 3) : 8, speed: 7, ttl: 1.6, size: 0.9, gravity: -6 },
    lampIntensity: heavy ? 1100 : 620,
    shakeSeverity: heavy ? 1.5 : 0,
  });
}

// —— 起手 beat：术士不扑人——攻击拍 = 施法：后仰蓄力（余烬向掌心回吸，小版 P2 吸气）
// → 焰鞭出袖（fire orb 投射）。重击拍 = 长蓄力（更久更深 + 两级渐亮）→ 陨火
// （抬手引火，火球自画面上方斜落到玩家脚下；P2 重击先把轨道火球收进胸口，
//  出手时消耗一颗在胸口爆散、轨道上再长出一颗新的）。
// 投射物飞行由本拍阻塞承担，伤害节拍只留命中火体。
async function pyroAttackCast(ctx, deps, { unit, player, heavy }) {
  const H = unit._standeeHeight ?? 22;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const chest = { x: ux, y: uy + H * 0.55, z: uz };
  const to = player
    ? { x: player.position.x, y: player.position.y + 3.4 * (player._baseScale ?? 1), z: player.position.z }
    : null;
  const feet = player
    ? { x: player.position.x, y: player.position.y + 1.1, z: player.position.z }
    : null;
  const id = unit.uniqueID;
  const windMs = heavy ? 820 : 300;
  const isP2 = (unit._bossPhase ?? 1) >= 2;
  const orbPart = unit.parts?.get('orbs') ?? null;
  const orbit = orbPart?.userData?.orbit ?? null;
  const orbitBase = orbit ? { radius: orbit.radius, speed: orbit.speed } : null;

  // 两级渐亮：错开写在蓄力窗内（同一帧连调两次 unit.flash 只有最后一次可见）
  ctx.spawn(async (c) => {
    await c.wait(Math.round(windMs * (heavy ? 0.55 : 0.72)));
    unit.flash?.(heavy ? 0xffc884 : 0xff9a4a);
    if (heavy) {
      await c.wait(Math.round(windMs * 0.4));
      unit.flash?.(0xffe3b4);
    }
  });

  // 蓄力：余烬回吸（重击五批、普攻两批，越到后越密）
  ctx.spawn(async (c) => {
    const batches = heavy ? 5 : 2;
    for (let i = 0; i < batches; i++) {
      const n = heavy ? 3 + Math.min(i, 3) : 3;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = H * (0.5 + Math.random() * 0.4);
        const px = ux + Math.cos(a) * r, py = chest.y + Math.sin(a) * r * 0.7;
        const pull = (heavy ? 0.42 : 0.26) * (0.8 + Math.random() * 0.4);
        const vx = (chest.x - px) / pull, vy = (chest.y - py) / pull;
        const rec = deps.particles?.spawnSprite?.(px, py, {
          texture: streakTexture(), width: heavy ? 3.8 : 3.0, height: heavy ? 1.15 : 0.95, z: uz + 1.5,
          vx, vy, gravity: 0, ttl: pull, scalePop: 0.3,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
      }
      await c.wait(windMs / batches);
    }
  });

  // P2 重击：轨道火球收进胸口（火主把火握回手里）——出手一瞬间再甩出去
  if (heavy && isP2 && orbit && orbitBase) {
    ctx.onKill(() => { orbit.radius = orbitBase.radius; orbit.speed = orbitBase.speed; });
    ctx.spawn((c) => c.tweenRaw(orbit, {
      radius: orbitBase.radius * 0.22, speed: orbitBase.speed * 2.2,
    }, { durationMs: Math.round(windMs * 0.9), ease: 'power2.in' }));
  }

  await ctx.custom(id, {
    durationMs: windMs, ease: 'power2.inOut',
    onUpdate: (t) => unit.setPose({
      lean: -(heavy ? 0.18 : 0.10) * t,
      squash: 1 - 0.06 * Math.sin(t * Math.PI),
    }),
  });
  // 放：前倾一弹，与投射物起飞并行
  const snap = ctx.custom(id, {
    durationMs: 260, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ lean: -(heavy ? 0.18 : 0.10) * (1 - t) + (heavy ? 0.2 : 0.13) * Math.sin(t * Math.PI) }),
  });

  if (heavy) {
    // 抬手向天：一小束火被甩向天空（陨火起手——落点仍在玩家脚下，火从画面上方回来）
    deps.particles?.spawn?.(ux, chest.y, {
      count: 12, color: 0xffc884, speed: 6, vy: 28, size: 1.2, ttl: 0.36, gravity: 0, z: uz + 1,
    });
    // P2：消耗一颗轨道火球——在胸口爆散，轨道上再长出一颗新的（orbs.js 自管再生）
    if (isP2 && orbit && orbitBase) {
      const op = orbPart?.userData?.consumeOrb?.() ?? null;
      if (op) {
        deps.particles?.spawn?.(op.x, op.y, {
          count: 26, color: 0xff9a4a, speed: 24, size: 1.5, ttl: 0.75, z: op.z + 1,
        });
        deps.particles?.spawnSprite?.(op.x, op.y, {
          texture: ringTexture(), width: H * 0.4, height: H * 0.4, z: op.z + 1,
          ttl: 0.32, scalePop: 0.5, gravity: 0,
        });
      }
      ctx.spawn((c) => c.tweenRaw(orbit, {
        radius: orbitBase.radius, speed: orbitBase.speed,
      }, { durationMs: 520, ease: 'power2.out' }));
    }
    // 落点预兆：飞行前段几粒火星先从地面窜起（给落点一个「要来了」的读数）
    if (feet) {
      ctx.spawn(async (c) => {
        await c.wait(120);
        deps.particles?.spawn?.(feet.x, feet.y + 0.4, {
          count: 12, color: 0xff8a3a, speed: 9, size: 1.1, ttl: 0.55, gravity: -8, z: feet.z,
        });
      });
    }
    // 陨火：从画面上方斜落（arcH 0 + power1.in 的加速段 = 坠落而不是抛掷）
    await arcProjectile(ctx, deps, {
      from: feet ? { x: feet.x + H * 0.32, y: feet.y + H * 3.4, z: feet.z + H * 0.6 } : chest,
      to: feet ?? to,
      color: [1.0, 0.42, 0.12], hot: [1.35, 0.9, 0.5],
      size: 7.0, ms: 470, arcH: 0, stretch: 1.8, darting: 0,
      lampName: 'light:fx1', lampIntensity: 1200,
      fire: true,
      trail: { color: 0xff7a30, speed: 4, size: 1.2, ttl: 0.45 },
    });
  } else {
    await arcProjectile(ctx, deps, {
      from: chest, to,
      color: [1.0, 0.42, 0.12], hot: [1.35, 0.9, 0.5],
      // 战场沿 z 纵深排布，Boss 在远端——投射物全程大半时间在远场，尺寸按近场读感给足
      // （2.6 在远端只剩一粒灰），拖尾同步加粗加长；普攻带一点 darting 读「鞭梢脆响」
      size: 4.2, ms: 460, arcH: 4.2,
      stretch: 1.45, darting: 0.16,
      lampName: 'light:fx1', lampIntensity: 500,
      fire: true,
      trail: { color: 0xff7a30, speed: 3, size: 0.85, ttl: 0.34 },
    });
  }
  await snap;
  unit.resetPose?.();
}

// —— 起手 beat：攻击拍 = 施法（pyroAttackCast：蓄力回吸 → 焰鞭/陨火——重击拍的
// 意图 kinds 只有 ['attack']，普攻拍是 ['attack','debuff']，以此分档）；盾拍
// （盾6 + 塞 2 张灼伤入牌库）= 火种起播——两粒火种从胸口划弧飞向玩家；P2 的
// 「全场点燃」拍（debuff）= 蓄→爆→传燃三段大制；「消耗燃烧回血」拍（buff）=
// 吸纳火焰——全场的火被抽干倒灌进他胸口。
// 转段拍判别：enemyAct 以旧意图快照先行触发（aiAct stage 0），转段那拍的 kinds
// 是 ['buff']（蓄力预告）——buff 分支以 unit._bossPhase（P2 剧本首行置位）门控，
// 转段拍静默让位给 pyroP2 大剧本。
async function pyroAct({ ctx, deps, unit, player, kinds }) {
  if (kinds.some(isAttackKind)) {
    await pyroAttackCast(ctx, deps, { unit, player, heavy: !kinds.some(isDebuffKind) });
    return;
  }
  const H = unit._standeeHeight ?? 22;
  const from = { x: unit.position.x, y: unit.position.y + H * 0.55, z: unit.position.z };
  if (kinds.includes('defend')) {
    // 「塞灼伤」拍（盾6 + 塞 2 张灼伤入牌库）：护身与播种一次施法——先起完整前摇
    // （护身余烬绕体上升 + 回吸 + 后仰绷住），再把两枚大号**灼印**错峰甩向玩家。
    // 灼印用 sigil 形体（咒印双环）而不是火球：读「种下一张灼伤」而非一次攻击。
    const to = player ? {
      x: player.position.x, y: player.position.y + 3.4 * (player._baseScale ?? 1), z: player.position.z,
    } : null;
    const windMs = 560;
    // 护身：脚下余烬绕体上升（盾的可视化），同时向掌心回吸
    deps.particles?.spawn?.(unit.position.x, unit.position.y + 1.2, {
      count: 10, color: 0xffb060, speed: 7, vy: 14, size: 1.1, ttl: 0.7, gravity: -2, z: unit.position.z,
    });
    ctx.spawn(async (c) => {
      for (let i = 0; i < 4; i++) {
        const n = 3 + i;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = H * (0.45 + Math.random() * 0.5);
          const px = from.x + Math.cos(a) * r, py = from.y + Math.sin(a) * r * 0.7;
          const pull = 0.32 * (0.8 + Math.random() * 0.4);
          const vx = (from.x - px) / pull, vy = (from.y - py) / pull;
          const rec = deps.particles?.spawnSprite?.(px, py, {
            texture: streakTexture(), width: 3.2, height: 0.95, z: from.z + 1.5,
            vx, vy, gravity: 0, ttl: pull, scalePop: 0.3,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
        }
        await c.wait(140);
      }
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: windMs, ease: 'power2.inOut',
      onUpdate: (t) => unit.setPose({ lean: -0.12 * t, squash: 1 - 0.045 * Math.sin(t * Math.PI) }),
    });
    unit.flash?.(0xffb060);
    // 放：前倾一弹，与两枚灼印起飞并行
    const snap = ctx.custom(unit.uniqueID, {
      durationMs: 240, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: -0.12 * (1 - t) + 0.1 * Math.sin(t * Math.PI) }),
    });
    for (let i = 0; i < 2; i++) {
      await arcProjectile(ctx, deps, {
        from, to,
        color: [1.0, 0.5, 0.14], hot: [1.4, 0.95, 0.45],
        size: 3.4, ms: 470, arcH: 4.2, stretch: 1.15,
        shape: 'sigil',
        lampName: 'light:fx1', lampIntensity: 420,
        trail: { color: 0xff7a30, speed: 4, size: 0.9, ttl: 0.34 },
      });
      if (to) {   // 灼印落定：玩家身上一小撮燃烬（牌已入牌库，视觉只交代「烙印贴上」）
        deps.particles?.spawn?.(to.x, to.y, {
          color: 0xffb060, count: 10, speed: 12, size: 1.0, ttl: 0.5, gravity: -4, z: to.z,
        });
      }
      await ctx.wait(170);
    }
    await snap;
    unit.resetPose?.();
    return;
  }
  if (kinds.some(isDebuffKind)) {
    // P2「全场点燃」：大动作三段读——
    //   蓄（~0.95s）：世界先压暗半档（全场的火都向他倾）→ 后仰展身 + 余烬成批
    //     倒吸（渐密渐急）+ 环绕火球收进体内；
    //   憋（0.2s）：顶点高频微颤、万籁俱寂的一瞬（大爆发前的静默拍）；
    //   爆：暖屏闪 + 胸口气浪细环 + 贴地火浪扫全战场 + 径向火星风暴 + 火球甩出；
    //   传燃：火浪按距离传到每个单位脚下，到谁谁着——燃烧层由 core/aura 同步，
    //     这里给「点着」的一瞬。
    const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
    const chestY = uy + H * 0.55;
    const id = unit.uniqueID;
    const jobs = [];
    const veil = dreadVeil(ctx, deps);   // 世界压暗（onKill 兜底摘除）
    veil?.set?.(0.4, 520);
    const orbit = unit.parts?.get('orbs')?.userData?.orbit;
    const orbitBase = orbit ? { radius: orbit.radius, speed: orbit.speed } : null;
    if (orbit) {   // 环绕火球收进体内（蓄力的「抽」）
      jobs.push(ctx.spawn((c) => c.tweenRaw(orbit, {
        radius: orbitBase.radius * 0.5, speed: orbitBase.speed * 1.7,
      }, { durationMs: 740, ease: 'power2.in' })).promise);
    }
    jobs.push(ctx.spawn(async (c) => {   // 蓄：七批余烬倒吸回胸口，渐密渐急
      for (let i = 0; i < 7; i++) {
        const pull = 0.30 - i * 0.024;
        for (let k = 0; k < 4 + i; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = H * (0.5 + Math.random() * 0.45);
          const px = ux + Math.cos(a) * r, py = chestY + Math.sin(a) * r * 0.7;
          const vx = (ux - px) / pull, vy = (chestY - py) / pull;
          const rec = deps.particles?.spawnSprite?.(px, py, {
            texture: streakTexture(), width: 3.0, height: 0.9, z: uz + 1.5,
            vx, vy, gravity: 0, ttl: pull, scalePop: 0.3,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
        }
        await c.wait(168 - i * 14);
      }
    }).promise);
    await ctx.custom(id, {
      durationMs: 740, ease: 'power2.in',
      onUpdate: (t) => unit.setPose({ lean: -0.16 * t, widen: 1 + 0.15 * t }),
    });
    // 憋：顶点 200ms 高频微颤（蓄不住）——爆发前的静默一拍，压暗到最深
    veil?.set?.(0.52, 210);
    await ctx.custom(id, {
      durationMs: 200, ease: 'none',
      onUpdate: (t) => {
        const sh = Math.sin(t * Math.PI * 2 * 6.5) * 0.02 * (0.5 + t);
        unit.setPose({ lean: -0.16, widen: 1.15 + sh });
      },
    });
    unit.resetPose?.();
    unit.flash?.(0xff9a4a);
    veil?.set?.(0, 640);
    // 火球被爆风重新甩出（过冲外扩再收回轨道）
    if (orbit && orbitBase) {
      jobs.push(ctx.spawn(async (c) => {
        await c.tweenRaw(orbit, { radius: orbitBase.radius * 1.18, speed: orbitBase.speed }, { durationMs: 320, ease: 'power3.out' });
        await c.tweenRaw(orbit, { radius: orbitBase.radius, speed: orbitBase.speed }, { durationMs: 460, ease: 'power2.inOut' });
      }).promise);
    }
    // 爆（全部收进 jobs——父本结算杀子件的铁律）
    jobs.push(ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.15, ms: 240, color: 0xffa050 })).promise);
    const ring = deps.particles?.spawnSprite?.(ux, chestY, {
      texture: ringTexture(true), width: H * 0.3, height: H * 0.3, z: uz + 2, ttl: 0.7, gravity: 0,
    });
    if (ring) {
      jobs.push(ctx.spawn(async (c) => {
        await c.tweenRaw(ring, { w: H * 2.3, h: H * 2.3 }, { durationMs: 640, ease: 'power2.out' });
      }).promise);
    }
    jobs.push(ctx.spawn((c) => groundRing(c, deps, {
      at: { x: ux, y: uy, z: uz }, size: 150, ms: 900,
      color: [1.0, 0.42, 0.12], hot: [1.35, 0.9, 0.45], spin: 2.6,
    })).promise);
    // 径向火星风暴
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.25;
      const sp = 20 + Math.random() * 10;
      const rec = deps.particles?.spawnSprite?.(ux, chestY, {
        texture: streakTexture(), width: 3.4, height: 0.95, z: uz + 1.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 + 2.5, gravity: 5, ttl: 0.8, scalePop: 0.3,
      });
      if (rec) rec.sprite.material.rotation = Math.atan2(Math.sin(a) * 0.55, Math.cos(a));
    }
    deps.particles?.spawn?.(ux, chestY, { count: 40, color: 0xff7a30, speed: 46, ttl: 0.7, size: 1.6, z: uz });
    deps.shake?.impulse?.(2.4);
    jobs.push(ctx.spawn((c) => lampPulse(c, deps, {
      name: 'light:fx1', at: { x: ux, y: chestY, z: uz + 2 },
      color: [1, 0.5, 0.15], peak: 1800, attackMs: 60, decayMs: 700,
    })).promise);
    // 传燃：火浪按距离推进（~7ms/wu）——到谁谁脚下起火（Boss 自身 = 源头，跳过）
    const playerView = deps.cast?.get?.('role:player') ?? null;
    const others = (deps.cast?.query?.('unit:') ?? [])
      .map((e) => e.handle)
      .filter((v) => v && v !== unit && !v._dead);
    if (playerView && !others.includes(playerView)) others.push(playerView);
    for (const v of others) {
      const d = Math.hypot(v.position.x - ux, v.position.z - uz);
      const lag = Math.min(520, d * 7);
      jobs.push(ctx.spawn(async (c) => {
        await c.wait(lag);
        v.flash?.(0xff7a30);
        await fireBurst(c, deps, {
          at: { x: v.position.x, y: v.position.y, z: v.position.z },
          scale: 0.55, ms: 320, sparkCount: 10, lampIntensity: 260,
          linger: { count: 5, speed: 5, ttl: 1.1, size: 0.7, gravity: -5 },
        });
      }).promise);
    }
    await Promise.all(jobs);
    return;
  }
  if (kinds.some(isBuffKind)) {
    // 转段蓄力拍（kinds ['buff'] 但 _bossPhase 未置位）：让位给 pyroP2 大剧本
    if ((unit._bossPhase ?? 1) < 2) return;
    // P2「吸纳火焰」：全场的火被抽干——起手轻压、越吸越暗（末期所有火光离位），
    // 火从每个燃烧源、火盆与被撕离的余烬里倒灌进胸口；入体一拍炽闪 + 场景回暖。
    // 压迫感来自「亮的东西都被抽走了」，不是把画面整体调暗到底。
    const to = { x: from.x, y: from.y, z: from.z };
    const id = unit.uniqueID;
    const mood = deps.cast?.get?.('light:mood') ?? null;
    const fgNow = mood?.fireGain ?? null;
    if (mood && fgNow != null) {
      ctx.onKill(() => { mood.fireGain = fgNow; });   // 被打断也要把火光还回来
      ctx.spawn((c) => c.tweenRaw(mood, { fireGain: fgNow * 0.45 },
        { durationMs: 760, ease: 'power2.in' }));
    }
    const veil = dreadVeil(ctx, deps);   // 世界压暗（onKill 兜底摘除）
    veil?.set?.(0.14, 300);
    // 末期压暗：抽吸后段世界沉下去（到入体前刚好最深）
    ctx.spawn(async (c) => {
      await c.wait(500);
      veil?.set?.(0.52, 450);
    });
    // 胸口汇聚核：越吸越大，入体瞬间达峰
    ctx.spawn(async (c) => {
      await c.wait(360);
      const core = deps.particles?.spawnSprite?.(to.x, to.y, {
        texture: glowTexture(0xffcf9a), width: H * 0.10, height: H * 0.10, z: to.z + 1.5,
        ttl: 0.8, fadeIn: true, gravity: 0,
      });
      if (core) await c.tweenRaw(core, { w: H * 0.55, h: H * 0.55 },
        { durationMs: 680, ease: 'power2.in' });
    });
    // 吸力涡环：两道细环从体外收进胸口（收束语汇，不是扩散冲击波）
    for (const [delay, w0] of [[140, 1.5], [320, 1.05]]) {
      const ring = deps.particles?.spawnSprite?.(to.x, to.y, {
        texture: ringTexture(true), width: H * w0, height: H * w0, z: to.z + 2,
        ttl: 1.05, gravity: 0,
      });
      if (!ring) continue;
      ctx.spawn(async (c) => {
        await c.wait(delay);
        await c.tweenRaw(ring, { w: H * 0.16, h: H * 0.16 }, { durationMs: 720, ease: 'power2.in' });
      });
    }
    // 源清单：玩家 + 盟友 + 敌方（不含自己）+ 火盆——凡是有火的地方都被抽
    const playerView = deps.cast?.get?.('role:player') ?? null;
    const sources = [];
    if (playerView) sources.push(playerView);
    for (const e of deps.cast?.query?.('unit:') ?? []) {
      const v = e.handle;
      if (v && v !== unit && v !== playerView && !v._dead) sources.push(v);
    }
    const streams = [];
    for (const v of sources) {
      streams.push({
        x: v.position.x,
        y: v.position.y + (v._standeeHeight ?? 16) * 0.45,
        z: v.position.z,
      });
      v.flash?.(0xff5a2a);
    }
    for (const { handle } of deps.cast?.query?.('prop:brazierFire') ?? []) {
      const p = handle.object?.position;
      if (p) streams.push({ x: p.x, y: p.y + 2.5, z: p.z });
    }
    // 环境余烬：以 Boss 为心的环带上六个点，火被撕离原位后向胸口倒灌——
    // 「整个房间都在被他抽干」的体量主要来自这一层（火盆只有两三处）
    const ambient = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const r = H * (1.2 + Math.random() * 1.5);
      ambient.push({
        x: unit.position.x + Math.cos(a) * r,
        y: unit.position.y + H * (0.18 + Math.random() * 0.85),
        z: unit.position.z + Math.sin(a) * r * 0.55,
        lag: Math.random() * 280,
      });
    }
    // 每源：一条大号主火舌（arcProjectile 倒飞回胸口）+ 一簇加速 streak 流
    const jobs = [];
    for (const s0 of streams) {
      jobs.push(ctx.spawn((c) => arcProjectile(c, deps, {
        from: s0, to,
        color: [1.0, 0.5, 0.14], hot: [1.4, 1.0, 0.5],
        size: 3.4, ms: 900, arcH: 7, stretch: 1.6,
        lampName: null,   // 灯留给入体炽闪（多源同借 fx1 会互相覆写）
        fire: true,
        trail: { color: 0xff7a30, speed: 4, size: 1.1, ttl: 0.45 },
      })).promise);
      jobs.push(ctx.spawn(async (c) => {
        for (let i = 0; i < 6; i++) {
          const pull = 0.5;
          const px = s0.x + (Math.random() - 0.5) * 3, py = s0.y + (Math.random() - 0.5) * 3;
          const vx = (to.x - px) / pull, vy = (to.y - py) / pull;
          const rec = deps.particles?.spawnSprite?.(px, py, {
            texture: streakTexture(), width: 3.6, height: 1.0, z: (s0.z ?? 0) + 1.5,
            vx, vy, gravity: 0, ttl: pull, scalePop: 0.25,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
          await c.wait(60);
        }
      }).promise);
    }
    for (const a of ambient) {
      jobs.push(ctx.spawn(async (c) => {
        await c.wait(a.lag);
        for (let i = 0; i < 3; i++) {
          const pull = 0.45;
          const px = a.x + (Math.random() - 0.5) * 2, py = a.y + (Math.random() - 0.5) * 2;
          const vx = (to.x - px) / pull, vy = (to.y - py) / pull;
          const rec = deps.particles?.spawnSprite?.(px, py, {
            texture: streakTexture(), width: 3.2, height: 0.9, z: a.z + 1.5,
            vx, vy, gravity: 0, ttl: pull, scalePop: 0.25,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(vy, vx);
          await c.wait(55);
        }
      }).promise);
    }
    unit.flash?.(0xff9a4a);
    await ctx.wait(1000);   // 火全部倒灌落定（主火舌 900ms + 余烬流尾巴）
    // 入体：胸口炽胀 + 金色炽闪 + 体表三段渐亮 + 轻震；场景回暖、火光归位
    unit.flash?.(0xffc884);
    veil?.set?.(0, 480);
    if (mood && fgNow != null) {
      ctx.spawn((c) => c.tweenRaw(mood, { fireGain: fgNow }, { durationMs: 520, ease: 'power2.out' }));
    }
    jobs.push(ctx.spawn((c) => lampPulse(c, deps, {
      name: 'light:fx1', at: { x: to.x, y: to.y, z: to.z + 2 },
      color: [1, 0.55, 0.18], peak: 3200, attackMs: 70, decayMs: 800,
    })).promise);
    deps.particles?.spawnSprite?.(to.x, to.y, {
      texture: ringTexture(), width: H * 0.5, height: H * 0.5, z: to.z + 1.5,
      ttl: 0.5, scalePop: 0.5, gravity: 0,
    });
    await ctx.custom(id, {
      durationMs: 420, ease: 'power2.out',
      onUpdate: (t) => {
        const k = 1 + 0.13 * Math.sin(t * Math.PI);   // 炽胀一拍（吃进去的火撑了一下）
        unit.setPose({ widen: k, squash: 1 - (k - 1) * 0.5 });
      },
    });
    unit.resetPose?.();
    unit.flash?.(0xffe3b4);
    deps.shake?.impulse?.(1.6);
    await Promise.all(jobs);
  }
  // 未知/其余拍：静默（P2 剧本与命中 beat 已覆盖本 Boss 的演出语言）
}

export function registerPyroScripts(register) {
  register('bosses/pyroP2', pyroP2);
  registerEnemyHitBeat('pyro', pyroHitBeat);
  registerEnemyAct('pyro', pyroAct);
  // 施法者：不突进——攻击的身体语言是蓄力与投射物（act 起手），不是肉身前扑
  registerEnemyNoLunge('pyro');
  // 受击补充：打在火主身上 = 命中点溅起一撮下坠余烬 + 流火拖影（烧的是火，
  // 不是肉）。常驻火焰/火球升温已由 aura/orbs 承接，这里只补「挨打那一瞬」
  registerBossHurtFx('pyro', (ctx, deps, { unit, dealt }) => {
    const H = unit._standeeHeight ?? 22;
    const y = unit.position.y + H * (0.35 + Math.random() * 0.3);
    deps.particles?.spawn?.(unit.position.x, y, {
      color: 0xff8a3a, count: Math.min(4 + Math.round(dealt / 5), 12), speed: 9,
      size: 1.1, ttl: 0.9, gravity: 8, z: unit.position.z + 1,
    });
    const rec = deps.particles?.spawnSprite?.(unit.position.x, y, {
      texture: streakTexture(), width: 2.6, height: 0.75, z: unit.position.z + 2,
      vx: (Math.random() - 0.5) * 14, vy: 6 + Math.random() * 4, gravity: 5, ttl: 0.55, scalePop: 0.3,
    });
    if (rec) rec.sprite.material.rotation = Math.atan2(6, (Math.random() - 0.5) * 14);
  });
}
