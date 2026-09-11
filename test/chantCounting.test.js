import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { DrawCardsInstruction, DiscardCardInstruction } from '../src/core/instructions/cards.js';
import { UseSkillInstruction } from '../src/core/instructions/skill.js';

// ---- 太极/混元系（计数触发）原型：压测跨回合计数订阅 ----
// 计数器放在 skillRuntime（plain data，可序列化）上，不藏闭包。

// 太极（咏唱）：每打 3 张牌（不计自身），抽 1 张牌。
registerSkill({
  id: 'taiji', name: '太极',
  cost: { mana: 0, actionPoint: 1 },
  cardMode: 'chant',
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: UseSkillInstruction, phase: 'post',
      filter: (instr) => instr.skill.uniqueID !== sctx.self.uniqueID,
      react: (instr, ctx) => {
        sctx.self.chantCount = (sctx.self.chantCount ?? 0) + 1;
        if (sctx.self.chantCount % 3 === 0) {
          ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr);
        }
      },
    }],
  },
});

// 混元（咏唱，太极深入分支）：每弃 3 张牌，抽 1 张牌。
registerSkill({
  id: 'hunyuan', name: '混元',
  cost: { mana: 0, actionPoint: 1 },
  cardMode: 'chant',
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DiscardCardInstruction, phase: 'post',
      react: (instr, ctx) => {
        sctx.self.chantCount = (sctx.self.chantCount ?? 0) + 1;
        if (sctx.self.chantCount % 3 === 0) {
          ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr);
        }
      },
    }],
  },
});

describe('太极：每打 3 张牌抽 1 张', () => {
  it('计数跨回合累积，第 3、6 张触发抽牌', () => {
    const d = new BattleDriver({
      deck: ['taiji', 'punch', 'punch', 'punch', 'punch'],
      enemies: [new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 100 })], // 高血量避免中途胜利
      seed: 5, config: { initialDraw: 5 },
      player: { maxActionPoints: 6 }, // 一回合内打 太极+3拳 需要 4 点行动力
    });
    d.start();

    d.play('taiji'); // 发动：留手牌点亮（无槽），不计入计数
    const taiji = d.state.zones.hand.find(c => c.defId === 'taiji');
    expect(taiji.isActivated).toBe(true);
    expect(taiji.chantCount ?? 0).toBe(0);

    // 第 1、2 张不触发
    d.play('punch');
    d.play('punch');
    expect(d.state.zones.hand).toHaveLength(3); // 太极驻手 + 2 拳
    expect(taiji.chantCount).toBe(2);

    // 第 3 张触发：抽 1（FIFO：先打出的拳已回牌库底，从牌库头抽回）
    d.play('punch');
    expect(taiji.chantCount).toBe(3);
    expect(d.state.zones.hand).toHaveLength(3); // 3 - 1 + 1

    // 跨回合：计数不清零，第 6 张再次触发
    d.endTurn(); // 敌方回合 → 回合 2 抽牌（牌库 2 张，抽 2 后牌库空即止——无重洗）
    expect(d.state.zones.hand).toHaveLength(5); // 太极 + 2 拳 + 抽 2
    d.play('punch');
    d.play('punch');
    expect(d.state.zones.hand).toHaveLength(3);
    d.play('punch'); // 第 6 张
    expect(taiji.chantCount).toBe(6);
    expect(d.state.zones.hand).toHaveLength(3); // 3 - 1 + 1
  });
});

describe('混元：每弃 3 张牌抽 1 张', () => {
  it('弃牌计数跨回合累积并触发抽牌', () => {
    const d = new BattleDriver({
      deck: ['hunyuan', 'punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 5 },
    });
    d.start();

    d.play('hunyuan'); // 发动：留手牌点亮（无槽）
    const hunyuan = d.state.zones.hand.find(c => c.defId === 'hunyuan');
    expect(hunyuan.isActivated).toBe(true);
    expect(d.state.zones.hand).toHaveLength(5); // 混元驻手 + 4 拳

    // 弃牌只弃拳（混元驻手：它本身也是合法弃牌目标，此处规避把被测卡弃掉）
    const discardOne = () => {
      const card = d.state.zones.hand.find(c => c.defId === 'punch');
      d.dispatch(new DiscardCardInstruction({ uniqueID: card.uniqueID }));
    };

    discardOne();
    discardOne();
    expect(d.state.zones.hand).toHaveLength(3);
    discardOne(); // 第 3 弃 → 抽 1
    expect(hunyuan.chantCount).toBe(3);
    expect(d.state.zones.hand).toHaveLength(3); // 3 - 1 + 1

    // 跨回合累积到 6 再次触发
    d.endTurn();
    expect(d.state.zones.hand).toHaveLength(5); // 回合 2 抽牌（牌库 2 张）
    discardOne();
    discardOne();
    discardOne();
    expect(hunyuan.chantCount).toBe(6);
    expect(d.state.zones.hand).toHaveLength(3); // 5 - 3 + 1
  });
});
