// 剧本数据：cutscene 内容外置，与系统解耦。
// 契约：{ id, steps: [ ... ] }——steps 为时间轴，step 词汇表见 cutscenePlayer.js 头注：
//   fade（渐黑/渐亮）、wipe（幕间转场）、image（CG 淡入/停留/淡出）、dialogue（点击翻页）、call（瞬时回调）。
// 复杂 cutscene = 多段组合，例如：
//   fade to 1 → image CG1 → image CG2 → dialogue → fade to 0
// 占位最小集：开场 + Boss 战前/战后；正式剧情内容待补（RUN_DESIGN §9）。

export const CUTSCENE_SCRIPTS = [
  {
    id: 'opening',
    steps: [
      {
        type: 'dialogue',
        pages: [
          { speaker: '???', text: '魏启之力沉睡于塔顶……而塔，共四十四层。' },
          { speaker: 'remi', text: '别发呆了！我在前面开路，你在后面出牌，成交？' },
          { speaker: '骑士', text: '（点点头，踏上了第一层。）' },
        ],
      },
    ],
  },
  {
    id: 'preBoss',
    steps: [
      {
        type: 'dialogue',
        pages: [
          { speaker: 'remi', text: '等等……前面的气息不对劲。是这一层的看守者！' },
          { speaker: '骑士', text: '（握紧卡组。这一战，没有退路。）' },
        ],
      },
    ],
  },
  {
    id: 'postBoss',
    steps: [
      {
        type: 'dialogue',
        pages: [
          { speaker: 'remi', text: '居然赢了！塔在上层向你敞开了一条通路。' },
          { speaker: '骑士', text: '（删去一张多余的卡，继续向上。）' },
        ],
      },
    ],
  },
];
