// 测试技能数据
const testSkills = [
  {
    id: 'test-skill-1',
    name: '测试技能1',
    description: '这是一个测试技能，能够造成/red{10}点伤害，并获得2层/effect{防御}',
    tier: 1,
    uses: 3,
    maxUses: 3,
    canUse: (player) => player.actionPoints >= 1
  },
  {
    id: 'test-skill-2',
    name: '测试技能2',
    description: '这是一个更复杂的测试技能，能够造成/blue{15}点伤害，获得1层/effect{集中}，并有20%概率获得1层/effect{力量}',
    tier: 2,
    uses: 2,
    maxUses: 2,
    canUse: (player) => player.actionPoints >= 2
  }
];

export default testSkills;