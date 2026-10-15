// 敌人意图分类口径（battle.md T1a）——kinds 词表与族谓词的单一事实源。
// 攻击族四档（attack/heavy/execute/fixedAttack，带 hits×damage 数值）+
// 防御（defend，带 shield 数值）+ 强化/削弱族强弱档 + summon/stun/unknown。
// 意图条烘焙（UnitObject）、tooltip 文案（shell/tooltip.js）、enemyAct 剧本分流
// （fx/scripts）都走这组谓词，勿在各消费点散写字符串比较。
export const ATTACK_KINDS = Object.freeze(['attack', 'heavy', 'execute', 'fixedAttack']);
export const isAttackKind = (k) => ATTACK_KINDS.includes(k);
export const isBuffKind = (k) => k === 'buff' || k === 'strongBuff';
export const isDebuffKind = (k) => k === 'debuff' || k === 'strongDebuff';

/** 攻击族中文名（tooltip 释义用；数值由消费方拼）。 */
export const ATTACK_KIND_NAMES = Object.freeze({
  attack: '攻击', heavy: '重击', execute: '处决', fixedAttack: '固定伤害攻击',
});
