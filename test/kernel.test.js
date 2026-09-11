import { describe, it, expect } from 'vitest';
import BattleInstruction, { WAIT } from '../src/core/kernel/BattleInstruction.js';
import BattleKernel, { MAX_TRIGGER_DEPTH } from '../src/core/kernel/BattleKernel.js';

// ---- 测试桩 ----

class LogInstr extends BattleInstruction {
  constructor(name, log, opts) {
    super(opts);
    this.name = name;
    this.log = log;
  }
  execute() { this.log.push(this.name); return true; }
}

class StageInstr extends BattleInstruction {
  constructor(stages, log, opts) {
    super(opts);
    this.stages = stages;
    this.log = log;
  }
  execute() {
    this.log.push(this._stage);
    return this._stage >= this.stages - 1;
  }
}

class WaitInstr extends BattleInstruction {
  constructor(log, opts) {
    super(opts);
    this.log = log;
    this.done = false;
  }
  execute() {
    if (this.done) { this.log.push('wait-done'); return true; }
    return WAIT;
  }
}

class DamageInstr extends BattleInstruction {
  constructor(log, opts) {
    super(opts);
    this.log = log;
  }
  get modifiablePayload() { return ['damage']; }
  buildPayload() { this.payload.damage = 10; }
  execute() {
    this.log.push(`deal-${this.payload.damage}`);
    this.result = { dealt: this.payload.damage };
    return true;
  }
}

function makeCtx(kernel) { return { kernel }; }

// ---- 用例 ----

describe('结算内核：DFS 与多阶段', () => {
  it('按 DFS 序结算，执行中提交的子节点在兄弟之前运行', () => {
    const log = [];
    const kernel = new BattleKernel();
    const ctx = makeCtx(kernel);

    class Submitting extends BattleInstruction {
      execute(ctx) {
        log.push('A');
        ctx.kernel.submitInstruction(new LogInstr('A1', log), this);
        return true;
      }
    }
    const root = new BattleInstruction();
    root.children = [new Submitting(), new LogInstr('B', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, ctx);
    expect(log).toEqual(['A', 'A1', 'B']);
  });

  it('多阶段指令逐 stage 推进直到返回 true', () => {
    const log = [];
    const kernel = new BattleKernel();
    kernel.run(new StageInstr(3, log), makeCtx(kernel));
    expect(log).toEqual([0, 1, 2]);
  });
});

describe('结算内核：WAIT 挂起与恢复', () => {
  it('WAIT 暂停泵，resume 后继续，后续兄弟才执行', () => {
    const log = [];
    const kernel = new BattleKernel();
    const ctx = makeCtx(kernel);
    const w = new WaitInstr(log);
    const root = new BattleInstruction();
    root.children = [w, new LogInstr('after', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, ctx);
    expect(log).toEqual([]);          // 挂起，after 未执行
    expect(kernel.stack.length).toBeGreaterThan(0);

    w.done = true;
    kernel.resume(w, ctx);
    expect(log).toEqual(['wait-done', 'after']);
    expect(kernel.stack.length).toBe(0);
  });
});

describe('结算内核：PRE 修饰', () => {
  it('PRE 订阅可修饰白名单内 payload，execute 读到最终值', () => {
    const log = [];
    const kernel = new BattleKernel();
    kernel.addSubscription({
      when: DamageInstr, phase: 'pre',
      react: (instr) => instr.setPayload('damage', instr.payload.damage * 2),
    });
    kernel.run(new DamageInstr(log), makeCtx(kernel));
    expect(log).toEqual(['deal-20']);
  });

  it('白名单外字段 setPayload 抛错', () => {
    const kernel = new BattleKernel();
    kernel.addSubscription({
      when: DamageInstr, phase: 'pre',
      react: (instr) => instr.setPayload('mana', 1),
    });
    expect(() => kernel.run(new DamageInstr([]), makeCtx(kernel))).toThrow(/白名单/);
  });

  it('多个 PRE 订阅按 priority 降序、同级按注册序执行', () => {
    const order = [];
    const kernel = new BattleKernel();
    kernel.addSubscription({ when: DamageInstr, phase: 'pre', priority: 0, react: () => order.push('low') });
    kernel.addSubscription({ when: DamageInstr, phase: 'pre', priority: 10, react: () => order.push('high-1') });
    kernel.addSubscription({ when: DamageInstr, phase: 'pre', priority: 10, react: () => order.push('high-2') });
    kernel.run(new DamageInstr([]), makeCtx(kernel));
    expect(order).toEqual(['high-1', 'high-2', 'low']);
  });
});

describe('结算内核：POST 反应', () => {
  it('反应作为已完成节点的子节点，先于父节点的下一个兄弟执行', () => {
    const log = [];
    const kernel = new BattleKernel();
    const ctx = makeCtx(kernel);
    kernel.addSubscription({
      when: DamageInstr, phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(new LogInstr('reaction', log), instr),
    });

    const root = new BattleInstruction();
    root.children = [new DamageInstr(log), new LogInstr('sibling', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, ctx);
    expect(log).toEqual(['deal-10', 'reaction', 'sibling']);
  });

  it("window:'once' 触发一次后自动注销", () => {
    const log = [];
    const kernel = new BattleKernel();
    kernel.addSubscription({
      when: LogInstr, phase: 'post', window: 'once',
      react: () => log.push('fired'),
    });
    const root = new BattleInstruction();
    root.children = [new LogInstr('a', log), new LogInstr('b', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, makeCtx(kernel));
    expect(log).toEqual(['a', 'fired', 'b']);
  });

  it('clearWindow 注销指定窗口订阅', () => {
    const log = [];
    const kernel = new BattleKernel();
    kernel.addSubscription({ when: LogInstr, phase: 'post', window: 'turn', react: () => log.push('turn-sub') });
    kernel.addSubscription({ when: LogInstr, phase: 'post', window: 'battle', react: () => log.push('battle-sub') });
    kernel.clearWindow('turn');

    kernel.run(new LogInstr('x', log), makeCtx(kernel));
    expect(log).toEqual(['x', 'battle-sub']);
  });

  it('触发链深度超限抛错（互触发死循环有明确死法）', () => {
    const kernel = new BattleKernel();
    kernel.addSubscription({
      when: LogInstr, phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(new LogInstr('loop', []), instr),
    });
    expect(() => kernel.run(new LogInstr('start', []), makeCtx(kernel))).toThrow(/触发链深度超限/);
  });
});

describe('结算内核：取消三动词', () => {
  it('veto：节点从未执行、不触发 POST，替代指令补位执行', () => {
    const log = [];
    const kernel = new BattleKernel();
    kernel.addSubscription({
      when: DamageInstr, phase: 'pre',
      react: (instr, ctx) => ctx.kernel.veto(instr, 'dodged', [new LogInstr('dodge-anim', log)]),
    });
    kernel.addSubscription({
      when: DamageInstr, phase: 'post',
      react: () => log.push('should-never-fire'),
    });

    const root = new BattleInstruction();
    root.children = [new DamageInstr(log), new LogInstr('next', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, makeCtx(kernel));
    expect(log).toEqual(['dodge-anim', 'next']);
    expect(root.children[0].cancelReason).toBe('dodged');
  });

  it('abort：深层节点中止根，整棵树回退，后续兄弟不执行', () => {
    const log = [];
    const kernel = new BattleKernel();
    const ctx = makeCtx(kernel);

    class AbortRoot extends BattleInstruction {
      execute(ctx) {
        log.push('aborting');
        ctx.kernel.abort(this.parentInstruction.parentInstruction, 'defeat'); // root
        return true;
      }
    }
    class Submitter extends BattleInstruction {
      execute(ctx) {
        log.push('A');
        ctx.kernel.submitInstruction(new AbortRoot(), this);
        return true;
      }
    }
    const root = new BattleInstruction();
    root.children = [new Submitter(), new LogInstr('never', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, ctx);
    expect(log).toEqual(['A', 'aborting']);
    expect(root.cancelReason).toBe('defeat');
  });

  it('终局检查：每条指令完成后判定，成立即 abort 根', () => {
    const log = [];
    let over = false;
    const kernel = new BattleKernel({ isBattleOver: () => (over ? 'victory' : null) });
    kernel.addSubscription({
      when: LogInstr, phase: 'post',
      react: () => { over = true; },
    });
    const root = new BattleInstruction();
    root.children = [new LogInstr('first', log), new LogInstr('never', log)];
    root.children.forEach(c => { c.parentInstruction = root; });

    kernel.run(root, makeCtx(kernel));
    expect(log).toEqual(['first']);
    expect(root.cancelReason).toBe('victory');
  });
});
