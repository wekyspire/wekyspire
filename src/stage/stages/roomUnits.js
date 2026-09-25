// roomUnits：休息房**单位导演**——房间里的活物（骑士 / 瑞米 / 未来店主）都归这里管。
//
// 职责（用户 2026-09-25 定）：
//   · 进房生成：骑士常驻（固定位，纯立牌无血条）；瑞米 `!drivenOff` 时在场；
//   · 瑞米游荡：跳跳移动逛房间，随机 POI → 到点驻足 → 换姿势东看西看（好奇/坐/打盹…）；
//   · **通用单位指令** `command({unit, op, ...})`——后端（core 事件经 presenter →
//     runController → RoomStage.roomUnitCommand）与 cutscene 步骤共用同一条通道。
//     指令全为可序列化纯数据描述符（直播/回放未来可直接重放指令流）：
//       moveTo {x, z}      跳到目标点（期间游荡自动挂起；Promise 可等到达）
//       pose {name}        换形态立牌（素材缺位回落 idle）
//       face {dir}         面左/面右
//       wander {on}        开关游荡（脚本演出前关、演完开）
//     未知 unit/op 静默忽略（描述符前向兼容，与 dispatchPanelIntent 同纪律）。
//
// 游荡是**舞台本地的环境演出**（无玩法语义，不进指令流）；事件驱动的正式演出
// 走指令通道。两者不抢：脚本指令一到，游荡挂起，直到显式 wander:{on:true}。

import * as THREE from 'three';
import { FLOOR_Y } from '../scenes/dungeon3D.js';
import { RoomUnitObject } from '../objects/RoomUnitObject.js';

// 瑞米姿势表：idle/back 用既有立牌，其余用生成的多状态图（缺图自动回落 idle）
const REMI_POSES = {
  idle: 'unit_remi_front.webp',
  back: 'unit_remi.webp',
  sit: 'remi_pose_sit.webp',
  curious: 'remi_pose_curious.webp',
  sleepy: 'remi_pose_sleepy.webp',
  alert: 'remi_pose_alert.webp',
  hop: 'remi_pose_hop.webp',
  lookback: 'remi_pose_lookback.webp',
  happy: 'remi_pose_happy.webp',
};
// 游荡驻足时的随机姿势池（东看西看的「这看看、那看看」）
const REMI_WANDER_POSES = ['idle', 'curious', 'sit', 'lookback', 'sleepy', 'happy'];

// 骑士在房间的站位（观察位：房间中前偏左，不挡机器与取景主轴）
const KNIGHT_POS = { x: -14, z: 14 };
// 瑞米游荡域（世界坐标矩形，围绕房心；进点前避开机器）
const REMI_AREA = { x0: -26, x1: 26, z0: 2, z1: 24 };
const AVOID_PAD = 7; // 机器避让半径（立牌 + 裕量）

export function createRoomUnits({ scene, unitArt = null, remi = false, rng = Math.random } = {}) {
  const units = new Map();
  let disposed = false;
  // 游荡状态（瑞米专用；未来别的单位要游荡同款接法）
  const wander = new Map(); // unitName -> { on, timer, phase }
  let moveSeq = 0; // 在途 moveTo 的序号（新指令打断旧等待）

  function spawn(name, art, standeeHeight, pos, { wanderOn = false } = {}) {
    const u = new RoomUnitObject({ name, unitArt, art, standeeHeight });
    u.position.set(pos.x, FLOOR_Y, pos.z);
    scene.add(u);
    units.set(name, u);
    if (wanderOn) wander.set(name, { on: true, timer: 0.6 + rng() * 0.8, phase: 'pause' });
    return u;
  }

  // —— 进房生成 ——
  spawn('knight', { idle: 'unit_player_front.webp' }, 13, KNIGHT_POS);
  if (remi) spawn('remi', REMI_POSES, 7, { x: -4, z: 18 }, { wanderOn: true });

  // 游荡 POI：矩形内随机点，避开机器/别的单位
  function pickPoi(self) {
    for (let i = 0; i < 12; i++) {
      const x = REMI_AREA.x0 + rng() * (REMI_AREA.x1 - REMI_AREA.x0);
      const z = REMI_AREA.z0 + rng() * (REMI_AREA.z1 - REMI_AREA.z0);
      let ok = true;
      for (const [n, u] of units) {
        if (n === self) continue;
        if (Math.hypot(u.position.x - x, u.position.z - z) < AVOID_PAD) { ok = false; break; }
      }
      if (ok) return { x, z };
    }
    return null; // 找不到就这轮不挪窝
  }

  function tickWander(name, dt) {
    const w = wander.get(name);
    const u = units.get(name);
    if (!w || !w.on || !u || u.moving) return;
    w.timer -= dt;
    if (w.timer > 0) return;
    if (w.phase === 'pause') {
      // 驻足结束：出发去下一个 POI
      const poi = pickPoi(name);
      if (poi) {
        w.phase = 'stroll';
        u.setPose(REMI_WANDER_POSES[(rng() * REMI_WANDER_POSES.length) | 0]);
        u.moveTo(poi.x, poi.z).then(() => {
          if (disposed || !wander.get(name)) return;
          wander.get(name).phase = 'pause';
          wander.get(name).timer = 1.6 + rng() * 3.4;   // 到点驻足：这看看那看看
          u.setPose(REMI_WANDER_POSES[(rng() * REMI_WANDER_POSES.length) | 0]);
        });
      } else {
        w.timer = 1.2 + rng();
      }
    }
  }

  /** 通用单位指令（描述符；返回 Promise——moveTo 等到达，其余立即兑现）。 */
  function command({ unit, op, ...args } = {}) {
    const u = units.get(unit);
    if (!u || disposed) return Promise.resolve();
    const w = wander.get(unit);
    const isMove = op === 'moveTo';
    if ((isMove || op === 'pose' || op === 'face') && w) w.on = false; // 脚本接管：游荡挂起
    switch (op) {
      case 'moveTo': {
        moveSeq += 1;
        return u.moveTo(args.x ?? u.position.x, args.z ?? u.position.z, args)
          .then(() => isMove && args.pose ? u.setPose(args.pose) : null);
      }
      case 'pose':
        u.setPose(args.name);
        return Promise.resolve();
      case 'face':
        u.face(args.dir >= 0 ? 1 : -1);
        return Promise.resolve();
      case 'wander':
        if (w) {
          w.on = !!args.on;
          if (w.on) { w.phase = 'pause'; w.timer = 0.4; }
        }
        return Promise.resolve();
      default:
        return Promise.resolve(); // 未知 op 静默忽略（前向兼容）
    }
  }

  return {
    units,
    command,
    get busy() { // 有单位在脚本移动中（cutscene 可据此等待）
      for (const u of units.values()) if (u.moving) return true;
      return false;
    },
    tick(dt, camera) {
      for (const [n, u] of units) {
        u.tick(dt, camera);
        tickWander(n, dt);
      }
    },
    /** 素材晚到补挂（宿主在 unitArt.addOnLoad 里调）。 */
    refreshArt() { for (const u of units.values()) u.refreshArt(); },
    dispose() {
      disposed = true;
      for (const u of units.values()) {
        scene.remove(u);
        u.dispose();
      }
      units.clear();
      wander.clear();
    },
  };
}
