import { getPendingInput, respondInput } from '../core/flow/battle.js';
import { EventNames } from './events.js';

// 结算期输入仲裁：presenter.requestInput → 挂起请求 → 校验应答 → respondInput。
// Shell/Stage 只看到 { request } 协议事件与 respond() 接口，不接触 battle 内部。
//
// request 形态（Core 约定）：
//   { kind: 'selectCards', source: 'hand'|'deck', min?, max?, count?, candidates?: [uniqueID] }
//   { kind: 'confirm' }（应答为 boolean）
// 校验规则：数量落在 [min,max]（旧字段 count = 精确张数）、不得重复、
// selection 落在 candidates 内（若提供）；confirm 要求 boolean。
export function createInteractionHandler({ battle, backendBus }) {
  let activeRequest = null;

  function validate(request, selection) {
    if (request.kind === 'confirm') return typeof selection === 'boolean';
    if (!Array.isArray(selection)) return false;
    const min = request.min ?? request.count ?? 1;
    const max = request.max ?? request.count ?? 1;
    if (selection.length < min || selection.length > max) return false;
    if (new Set(selection).size !== selection.length) return false; // 同一张不可重复选
    if (request.candidates) {
      const allowed = new Set(request.candidates);
      if (!selection.every(id => allowed.has(id))) return false;
    }
    return true;
  }

  return {
    // presenter 回调：新请求挂起（战斗泵已停，等玩家）
    handleRequest(request) {
      activeRequest = request;
      backendBus.emit(EventNames.INPUT_REQUESTED, { request });
    },

    // UI 应答：校验通过才提交给 Core
    respond(selection) {
      if (!activeRequest) return false;
      if (!getPendingInput(battle)) return false; // 请求可能已被取消（终局截断等）
      if (!validate(activeRequest, selection)) return false;
      activeRequest = null;
      backendBus.emit(EventNames.INPUT_RESOLVED, { selection });
      return respondInput(battle, selection);
    },

    get activeRequest() { return activeRequest; },

    // 投影/状态同步时发现 pendingInput 已消失（被取消）则清空挂起
    sync() {
      if (activeRequest && !getPendingInput(battle)) activeRequest = null;
    },
  };
}
