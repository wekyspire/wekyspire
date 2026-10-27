# 章节开场与篝火（chapter2 / chapter3 / chapter4 / campfire）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。

---

## chapter2（12 层 第二章开场）

```js
{
  id: 'chapter2',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '从十二层往上，是"研究区"！维护程序说，上面的每一层，都对应一项真正的研究！' },
        { speaker: 'remi', text: '对了对了，上面的墙上钉着好多好多纸！你要念给我听哦——我不识字嘛！' },
        { speaker: '骑士', text: '...' },
        { speaker: 'remi', text: '上面的敌人会更强！但是好东西也更多！塔也越来越大哦！' },
      ],
    },
  ],
}
```

> 幕间｜楼梯井仰拍：上一层的地板边缘探出新的、更大的结构阴影。
> 音乐｜塔内主题加入第二声部，节奏放沉半拍。

## chapter3（23 层 第三章开场）

```js
{
  id: 'chapter3',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '过了二十二层……你有没有觉得，塔壁里的嗡嗡声变大了？' },
        { speaker: '骑士', text: '...那是阿尔法装置。' },
        { speaker: 'remi', text: '你连这个都知道？！我只跟维护程序打听到的！' },
        { speaker: '骑士', text: '...字条上看的。' },
        { speaker: 'remi', text: '呜……又要麻烦你念给我听了。。。"字条骑士"！' },
        { speaker: '骑士', text: '不许起外号。' },
      ],
    },
  ],
}
```

> 音乐｜背景持续低鸣进入常态配器——它从此一直在，只是玩家此刻才听见。

## chapter4（34 层 第四章开场）

```js
{
  id: 'chapter4',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '从这里到塔顶，全是旧研究的回廊。维护程序说……上面已经很久没有新东西了。' },
        { speaker: 'remi', text: '但是快到了哦。……不管塔顶有什么，我都要亲眼看看。' },
        { speaker: '骑士', text: '...' },
        { speaker: 'remi', text: '骑士？你怎么不说话呀！' },
        { speaker: '骑士', text: '（加快了脚步。）' },
        { speaker: 'remi', text: '诶——等等我！' },
      ],
    },
  ],
}
```

> 备注｜"我要亲眼看看"是成长弧 G5 的前奏：主语从别人变成自己。

## campfire（休息层 · 炉火闲谈，非主线小剧场）

休息层触发一次。峰位表：全场一个峰——「别的塔也亮着灯吗？」「没有。就这一座亮着。」

```js
{
  id: 'campfire',
  steps: [
    { type: 'image', src: 'cg/campfire_rest', fadeInMs: 800, holdMs: 1600, fadeOutMs: 400 }, // 幕间：休息层的炉火房，火光照亮一小圈地面，窗外下着雪
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '（瑞米把手伸到火边烤，又缩回去，又伸出来。）好暖和呀。' },
        { speaker: 'remi', text: '骑士，你也过来嘛！这边有位子！' },
        { speaker: '骑士', text: '（骑士在火边坐下，把刀横放在膝盖上。）' },
        { speaker: 'remi', text: '这个火不会灭的哦。维护机械每天都来添柴。' },
        { speaker: 'remi', text: '对了，你为什么会来探索这座塔呀？' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '...路过。' },
        { speaker: 'remi', text: '路过？塔在雪的正中间呀。' },
        { speaker: '骑士', text: '...走到这了。' },
        { speaker: 'remi', text: '那你是来找宝贝的吗？塔里的好东西可多了！' },
        { speaker: '骑士', text: '不缺。' },
        { speaker: 'remi', text: '那是为了变强？像故事里的剑士一样！' },
        { speaker: '骑士', text: '...' },
        { speaker: 'remi', text: '唔……你这个人真是的。' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '（瑞米趴到窗边看了一会儿，又回到火边坐下。）' },
        { speaker: 'remi', text: '外面全是雪呀。从一楼到四十四楼，窗外全都是一样的。' },
        { speaker: 'remi', text: '骑士，雪地上还有别的塔吗？' },
        { speaker: '骑士', text: '有，离得远看不清。' },
        { speaker: 'remi', text: '别的塔也亮着灯吗？' },
        { speaker: '骑士', text: '没有。就这一座亮着。' },
        { speaker: 'remi', text: '（瑞米看着火，过了一会儿才开口。）那你是朝着灯走过来的吗？' },
        { speaker: '骑士', text: '（骑士看着火。）...嗯。' },
        { speaker: 'remi', text: '嘿嘿。' },
        { speaker: 'remi', text: '（瑞米把手伸回火边，这一次没有缩回去。）' },
      ],
    },
    { type: 'call', fn: '$restMenu' },
  ],
}
```

> 备注｜「雪地上还有别的塔、只有这一座亮着灯」是本稿新立的世界事实，待确认。
