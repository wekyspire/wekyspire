import Player, { PLAYER_BASE_HP } from '../state/player.js';
import { createRunState } from '../state/runState.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import { createRecordingPresenter } from '../presenter.js';
import { getEnemyDefinition } from '../enemies/registry.js';
import { getAllyDefinition } from '../allies/registry.js';
import { canUseSkill } from '../skills/helpers.js';
import {
  createBattle, startBattle, playerUseSkill, playerEndTurn, playerSwapCard,
  isBattleFinished, isWaitingPlayerInput, currentPlayerTurn,
  getPendingInput, respondInput,
} from '../flow/battle.js';

// Headless 战斗 SDK：声明式装配 + 出牌驱动 + 断言/追踪助手。
// 用于测试用例与 agent 调试战斗内容。
//
// const d = new BattleDriver({ deck: ['punch', ...], enemies: ['slime'], seed: 7, trace: true });
// d.start().play('punch').endTurn();
// d.expect(b => b.verdict === 'victory', '应当胜利');
export class BattleDriver {
  constructor({
    deck = [],            // [defId] 或 [{ defId, ...runtimeOverrides }]
    enemies = [],         // [defId] 或直接传 AIUnit 实例（可改血等）
    allies = [],
    abilities = [],
    player = {},          // Player 构造参数覆盖
    seed = 1,
    config = {},          // { initialDraw, drawPerTurn }
    trace = false,        // 记录内核结算追踪（tracer）
  } = {}) {
    this.presenter = createRecordingPresenter();
    const runState = createRunState({
      player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: 3, ...player }),
    });
    runState.player.deck = deck.map(d => {
      if (typeof d === 'string') return createSkillRuntime(d);
      const { defId, ...overrides } = d;
      return createSkillRuntime(defId, overrides);
    });
    runState.player.abilities = abilities;
    const toUnit = (e, getDef) => (typeof e === 'string' ? getDef(e).createUnit() : e);
    this.battle = createBattle({
      runState,
      enemies: enemies.map(e => toUnit(e, getEnemyDefinition)),
      allies: allies.map(a => toUnit(a, getAllyDefinition)),
      seed, presenter: this.presenter, config,
    });
    this.ctx = this.battle.ctx;
    this.traceLog = [];
    if (trace) this.battle.kernel.tracer = (e) => this.traceLog.push(e);
  }

  start() { startBattle(this.battle); return this; }

  get state() { return this.battle.battleState; }
  get player() { return this.ctx.player; }
  get verdict() { return this.ctx.kernel.verdict; }
  get kernel() { return this.ctx.kernel; }
  get pendingInput() { return getPendingInput(this.battle); }

  handIds() { return this.state.zones.hand.map(s => s.defId); }
  isFinished() { return isBattleFinished(this.battle); }
  isWaiting() { return isWaitingPlayerInput(this.battle); }

  // 出牌：defId（第一张可用的）或 uniqueID
  play(defIdOrUniqueID) {
    const hand = this.state.zones.hand;
    const skill = hand.find(s => s.uniqueID === defIdOrUniqueID)
      ?? hand.find(s => s.defId === defIdOrUniqueID && canUseSkill(this.ctx, s));
    if (!skill) {
      throw new Error(`无法出牌 '${defIdOrUniqueID}'（手牌: ${this.handIds().join(', ') || '空'}）`);
    }
    if (!playerUseSkill(this.battle, skill.uniqueID)) {
      throw new Error(`出牌失败 '${defIdOrUniqueID}'（不可用或不在等待输入）`);
    }
    return this;
  }

  playAll(list) { for (const c of list) this.play(c); return this; }

  endTurn() {
    if (!playerEndTurn(this.battle)) throw new Error('无法结束回合（不在等待输入或战斗已结束）');
    return this;
  }

  // 换牌：defId（第一张）或 uniqueID
  swap(defIdOrUniqueID) {
    const hand = this.state.zones.hand;
    const skill = hand.find(s => s.uniqueID === defIdOrUniqueID)
      ?? hand.find(s => s.defId === defIdOrUniqueID);
    if (!skill || !playerSwapCard(this.battle, skill.uniqueID)) {
      throw new Error(`无法换牌 '${defIdOrUniqueID}'（不在手牌/费用不足/不在等待输入）`);
    }
    return this;
  }

  // 结算期输入应答（AwaitPlayerInputInstruction）
  respond(selection) {
    if (!respondInput(this.battle, selection)) throw new Error('当前没有待应答的输入请求');
    return this;
  }

  // 测试注入：在当前等待点提交一条指令并恢复泵（如直接施加效果）
  dispatch(instr) {
    const parent = currentPlayerTurn(this.battle)
      ?? this.battle.kernel.stack[this.battle.kernel.stack.length - 1];
    if (!parent) throw new Error('战斗未在运行，无法注入指令');
    this.battle.kernel.submitInstruction(instr, parent);
    const stack = this.battle.kernel.stack;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]._waiting) { this.battle.kernel.resume(stack[i], this.ctx); break; }
    }
    return this;
  }

  // 断言：fn(driver) 为假则抛错
  expect(fn, msg = '断言失败') {
    if (!fn(this)) throw new Error(msg);
    return this;
  }

  // presenter 调用查询
  calls(method) {
    return this.presenter.calls.filter(c => !method || c.method === method);
  }

  // 策略自动驱动：policy(driver) => defId | null（null 则结束回合）
  runToEnd({ policy = null, maxSteps = 200 } = {}) {
    let steps = 0;
    while (!this.isFinished() && steps < maxSteps) {
      steps++;
      if (this.pendingInput) throw new Error('runToEnd 遇到结算期输入请求，需手动 respond');
      const pick = policy?.(this) ?? null;
      if (pick) this.play(pick);
      else this.endTurn();
    }
    if (steps >= maxSteps) throw new Error(`runToEnd 超过 ${maxSteps} 步，疑似卡死`);
    return this;
  }
}
