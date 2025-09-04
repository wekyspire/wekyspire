// dialogues.js - 对话事件管理
import eventBus from '../eventBus.js';

// 开场对话序列
const openingDialog = [
  {
    character: '瑞米',
    text: '你好呀，小灵御。',
    avatar: new URL('../assets/remi.png', import.meta.url).href
  },
  {
    character: '瑞米',
    text: '我负责接引你，看到你的技能了吗？快打败那只史莱姆练练手吧！',
    avatar: new URL('../assets/remi.png', import.meta.url).href
  }
];

// 随机事件对话序列
const randomEvents = [
  [
    {
      character: '瑞米',
      text: '你好呀，小灵御，我又来拉！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '一个超位的存在将我带到了这里。他告诉我，我们都在一场游戏中，而这个游戏似乎实际上还没开发好。',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '你好呀，小灵御，我又来拉！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '哎呀，你认识其它灵御吗？',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '有人让我随便找你聊点什么，我也不知道该聊点什么了~好吧，就这样吧！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

// Boss战后的特别对话
const postBossBattleEvents = [
  [
    {
      character: '瑞米',
      text: '芜湖，恭喜你打败了这个强大的Boss！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '好耶！你成功击败了Boss，再接再厉吧。',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

// 获取开场对话
function getOpeningDialog() {
  return openingDialog;
}

// 获取事件对话（战斗后）
// 参数: battleCount(战斗场次数), player(玩家状态), enemy(下一张战斗面对的敌人)
function getEventAfterBattle(battleCount, player, enemy) {
  // 检查是否是Boss战
  if (enemy && enemy.isBoss) {
    // 面对Boss时触发特别对话
    const bossEventIndex = Math.floor(Math.random() * postBossBattleEvents.length);
    return postBossBattleEvents[bossEventIndex];
  }
  // 否然，随机触发事件（5%）
  const u = Math.random();
  if(u < 0.05) {
    // 普通随机事件
    const eventIndex = Math.floor(Math.random() * randomEvents.length);
    return randomEvents[eventIndex];
  }
  return null;
}

// Boss战前的特别对话
const preBossBattleEvents = [
  [
    {
      character: '瑞米',
      text: '小心，前方有一股强大的气息！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '谨慎一些！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ],
  [
    {
      character: '瑞米',
      text: '我闻到了不祥的味道...',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '那个敌人很强！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '务必小心行事！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ]
];

let metEnemyRemi = false;

// 标记玩家是否已经获得过可多次充能的技能
let playerLearnedMultiUseSkill = false;

// 获取事件对话（战斗前）
// 参数: battleCount(战斗场次数), player(玩家状态), enemy(下一张战斗面对的敌人)
function getEventBeforeBattle(battleCount, player, enemy) {

  // 检查是否是Boss战
  if (enemy && enemy.isBoss) {
    // 面对Boss时触发特别对话
    const bossEventIndex = Math.floor(Math.random() * preBossBattleEvents.length);
    return preBossBattleEvents[bossEventIndex];
  }

  // 特判事件
  // 第一次遇到魔化瑞米
  if(!metEnemyRemi && enemy.name === '魔化瑞米') {
    metEnemyRemi = true;
    return [
      {
        character: '瑞米',
        text: '这...这是...瑞米？',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      },
      {
        character: '瑞米',
        text: '你好？额，看在同族的份上...',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      },
      {
        character: '瑞米',
        text: '下手可以...轻一点吗？',
        avatar: new URL('../assets/remi.png', import.meta.url).href
      }
    ];
  }
  
  // 否然，随机触发事件（5%）
  const u = Math.random();
  if(u < 0.05) {
    // 普通随机事件
    const eventIndex = Math.floor(Math.random() * randomEvents.length);
    return randomEvents[eventIndex];
  }
  return null;
}


// 初始化函数，在游戏开始时调用一次，注册eventBus监听
function registerListeners() {
  // 注册事件监听
  eventBus.on('before-battle', (params) => {
    const {battleCount, player, enemy} = params;
    const sequence = getEventBeforeBattle(battleCount, player, enemy);
    if(sequence) {
      // 发射调用对话界面显示对话的事件
      eventBus.emit('display-dialog', sequence);
    }
  });
  eventBus.on('after-battle', (params) => {
    const {battleCount, player, enemy} = params;
    const sequence = getEventAfterBattle(battleCount, player, enemy);
    if(sequence) {
      // 发射调用对话界面显示对话的事件
      eventBus.emit('display-dialog', sequence);
    }
  });
  eventBus.on('before-game-start', () => {
    const openingDialog = getOpeningDialog();
    if(openingDialog) {
      // 发射调用对话界面显示对话的事件
      eventBus.emit('display-dialog', openingDialog);
    }
  });
  
  // 监听玩家获得技能事件
  eventBus.on('player-claim-skill', (params) => {
    // 检查是否已经触发过教程
    if (!playerLearnedMultiUseSkill) {
      const { skill } = params;
      // 检查技能是否是可多次充能的（maxUses > 1 或者是无限的）
      if ((skill.maxUses !== undefined && skill.maxUses > 1) || skill.isInfiniteUse) {
        // 标记已经触发过教程
        playerLearnedMultiUseSkill = true;
        // 获取教程对话序列
        const sequence = getMultiUseSkillTutorial();
        if (sequence) {
          // 发射调用对话界面显示对话的事件
          eventBus.emit('display-dialog', sequence);
        }
      }
    }
  });
}

// 获取可多次充能技能教程对话
function getMultiUseSkillTutorial() {
  return [
    {
      character: '瑞米',
      text: '哎呀，我看到你获得了一个可以多次使用的技能呢！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '这类技能在战斗中有次数限制，但每次战斗开始时都会重新充能哦！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    },
    {
      character: '瑞米',
      text: '好好利用它们，会让你在战斗中更加游刃有余！',
      avatar: new URL('../assets/remi.png', import.meta.url).href
    }
  ];
}

function unregisterListeners (eventBus) {
  eventBus.off('before-battle');
  eventBus.off('after-battle');
  eventBus.off('before-game-start');
  eventBus.off('player-claim-skill');
}

// 导出注册函数
export {registerListeners, unregisterListeners};