// remoteBridge：浏览器端的「镜像 bridge」——从 SSE 直播流重建一场战斗的播放。
//
// 与生产 bridge 同形（frontendBus / backendBus / sequencer / intents / interaction /
// getProjection / start / isFinished），所以 BattleStage 可以原样挂上去，渲染层零改动。
// 差别只在「谁来产生指令」：
//   生产：core → presenter → sequencer.enqueueInstruction（本地闭包 start）
//   观战：SSE 指令描述符 → 本地 sequencer.enqueueInstruction（重建同一条 start，
//         见 wire.js 的 replayWireInstruction）→ 本地 Stage 播完回 finish 闭环
// 因此**播放节奏完全由浏览器自己的 sequencer 决定**：服务端只管把描述符推过来，
// 不等待回执（agent 批量出招时显示会落后若干拍，属预期）。
//
// 观战端不产生意图：canPlayCard 读投影下发的 usable（服务端算好的 core 判定），
// 其余 intent 一律 no-op。
import mitt from 'mitt';
import AnimationSequencer from '../core/anim/sequencer.js';
import { EventNames } from './events.js';
import { replayWireInstruction } from './wire.js';

/**
 * @param url SSE 地址（如 http://127.0.0.1:5199/live?session=xxx）
 * @param onRecord (rec) => void 页面级记录回调（battle/run/act/hello/error/reset/…）
 * @param onStatus (status, detail) => void 连接状态（connecting/open/error/closed）
 * 回调也可在挂载后再装（setRecordHandler/setStatusHandler）——Vue 子组件挂载早于父组件
 * onMounted，宿主页需要「先建 bridge 再挂组件」，故两项都支持。
 */
export function createRemoteBridge({
  url, onRecord = null, onStatus = null, EventSourceImpl = globalThis.EventSource,
}) {
  const frontendBus = mitt();
  const backendBus = mitt();
  const sequencer = new AnimationSequencer({
    bus: frontendBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED,
  });

  let recordHandler = onRecord;
  let statusHandler = onStatus;
  let snapshot = null;
  let closed = false;
  const source = new EventSourceImpl(url);

  const apply = (rec) => {
    switch (rec.t) {
      case 'i':
        // sync 快照即时落位（与本地一致：前端 HUD 状态在结算当下就已是终值，
        // 只有 3D 舞台的演出延后），并通知 HUD 刷新
        if (rec.event === EventNames.ANIM_STATE_SYNC) {
          snapshot = rec.payload?.snapshot ?? snapshot;
          backendBus.emit(EventNames.STATE_DIRTY);
        }
        replayWireInstruction(sequencer, { frontendBus, backendBus }, rec);
        break;
      case 'b':
        backendBus.emit(rec.event, rec.payload);
        break;
      default:
        recordHandler?.(rec);
        break;
    }
  };

  source.onopen = () => statusHandler?.('open');
  source.onerror = () => { if (!closed) statusHandler?.('error'); };
  source.onmessage = (ev) => {
    let rec;
    try { rec = JSON.parse(ev.data); } catch { return; }
    apply(rec);
  };

  const cardUsable = (id) => !!snapshot?.hand?.find(c => c.uniqueID === id)?.usable;

  const bridge = {
    frontendBus,
    backendBus,
    sequencer,
    intents: {
      canPlayCard: cardUsable,
      canSwapCard: () => !!snapshot?.waitingPlayerInput && !snapshot?.pendingInput
        && (snapshot?.hand?.length ?? 0) > 0
        && snapshot.player.actionPoints >= snapshot.swapCost,
      // 观战端不出招：这些是给 Stage 的守卫用的桩
      playCard: () => false,
      endTurn: () => false,
      swapCard: () => false,
      respondInput: () => false,
    },
    interaction: {
      respond: () => false,
      handleRequest: () => {},
      get activeRequest() { return snapshot?.pendingInput?.request ?? null; },
      sync: () => {},
    },
    getProjection: () => snapshot,
    start: () => {},
    isFinished: () => snapshot?.verdict != null,
  };

  return {
    bridge,
    close() { closed = true; source.close?.(); },
    get connected() { return !closed; },
    setRecordHandler(fn) { recordHandler = fn; },
    setStatusHandler(fn) { statusHandler = fn; },
  };
}
