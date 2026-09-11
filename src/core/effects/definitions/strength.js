import { registerEffect } from '../registry.js';

// 力量：每层 +1 攻击（读轨示例；暂无结算时行为，故无 subscriptions）。
export default registerEffect({
  id: 'strength',
  type: 'buff',
  stacking: 'count',
  statModifiers: {
    attack: (stacks) => stacks,
  },
  name: '力量',
  description: '每层使攻击提高 1 点。',
  icon: '💪',
  color: 'red',
});
