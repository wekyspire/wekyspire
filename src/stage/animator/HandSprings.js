// HandSprings：手牌/咏唱静息姿态的弹簧跟随层（软约束 + 惯量）。
// 动机：悬停重排若用目标补间（kill 旧 + 起新）驱动，指针快速扫过时反复重启、
// 速度不连续，观感生硬；改为每帧向布局锚点收敛的二阶弹簧——目标突变时速度
// 天然连续，邻牌呈波浪式跟动，悬停提拉/挤开自带惯量感。
//
// 让位规则：仅接管 animator 状态为 idle/tracking 的注册对象；指令动画
// （animating：入场飞行/发动展示/脉冲等）与拖拽（dragging）期间完全让位，
// 期间对象被别处驱动。重新获得资格时从 object3D 当前姿态零速收养——承接落定
// 姿态 → 平滑滑向锚点，故 enterTracking/syncTracking 归位补间对本层管理的卡
// 全部不再需要。
//
// 半隐式欧拉 + 固定子步积分：帧率无关、长帧截断防瞬移。由宿主逐帧 update(dt)；
// node 测试手动步进即可确定性地推进到收敛。

const CHANNELS = [
  // 平面位置略欠阻尼（带一点活的回弹）；层深/缩放/倾角临界面干脆不震
  { pos: 'x', vel: 'vx', omega: 13, zeta: 0.92, read: o => o.position.x },
  { pos: 'y', vel: 'vy', omega: 13, zeta: 0.92, read: o => o.position.y },
  { pos: 'z', vel: 'vz', omega: 16, zeta: 1.0, read: o => o.position.z },
  { pos: 'scale', vel: 'vscale', omega: 12, zeta: 1.0, read: o => o.scale.x },
  { pos: 'rotation', vel: 'vrot', omega: 11, zeta: 1.0, read: o => o.rotation.z },
];
const MAX_DT = 1 / 20;   // 超长帧截断（切后台回来不瞬移）
const SUBSTEP = 1 / 120; // 固定物理子步

export class HandSprings {
  constructor({ animator }) {
    this._animator = animator;
    this._targets = new Map(); // id -> 锚点目标 { x,y,z,scale,rotation }
    this._items = new Map();   // id -> 动态状态（各通道位置/速度 + driven 标记）
  }

  /** 布局重排后整表替换目标；消失的 id 随下次 update 清理。 */
  setTargets(targets) {
    this._targets = targets;
    for (const id of targets.keys()) {
      if (!this._items.has(id)) this._items.set(id, { driven: false });
    }
  }

  update(dt) {
    const total = Math.min(Math.max(dt, 0), MAX_DT);
    const steps = Math.max(1, Math.ceil(total / SUBSTEP));
    const h = total / steps;
    for (const [id, item] of this._items) {
      const tgt = this._targets.get(id);
      if (!tgt) { this._items.delete(id); continue; } // 已离场：交给离场节拍/销毁
      const st = this._animator.getState?.(id);
      if (st !== 'idle' && st !== 'tracking') { item.driven = false; continue; } // 动画/拖拽让位
      const obj = this._animator.getObject?.(id);
      if (!obj) { this._items.delete(id); continue; }

      if (!item.driven) {
        item.driven = true;
        for (const ch of CHANNELS) { item[ch.pos] = ch.read(obj); item[ch.vel] = 0; }
      }
      for (let s = 0; s < steps; s++) {
        for (const ch of CHANNELS) {
          const a = ch.omega * ch.omega * (tgt[ch.pos] - item[ch.pos])
            - 2 * ch.zeta * ch.omega * item[ch.vel];
          item[ch.vel] += a * h;
          item[ch.pos] += item[ch.vel] * h;
        }
      }
      obj.position.set(item.x, item.y, item.z);
      obj.scale.set(item.scale, item.scale, 1);
      obj.rotation.z = item.rotation;
    }
  }

  /** 立即弃管：目标表与动态状态一并摘除。
   *  卡离开手牌/咏唱（展示毕待离场 'held'、弃/焚/迁移）时必须**即刻**调用——
   *  目标表只在 sync 节拍重算，若等下一次 _layoutAndTrack 才清，空窗期里
   *  动画已结束（idle）的卡会被弹簧从展示位拉回手牌锚点（「打出 → 飞回手牌
   *  → 再飞牌库」的回归病灶，已多次复发，勿再依赖 layout 重算兜底）。 */
  release(id) {
    this._targets.delete(id);
    this._items.delete(id);
  }

  clear() {
    this._items.clear();
    this._targets.clear();
  }
}
