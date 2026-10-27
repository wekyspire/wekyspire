# 开场与首次死亡（opening / firstDeath）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。

---

## opening（开场 · 新档）

新档开场，骑士在塔门前初遇瑞米。四拍：**激动**（久未见客，冲出门爆发）→ **好奇**（连着问骑士外面的事）→ **介绍**（自报接引员，讲塔与尖塔之星）→ **带骑士开始游玩**（领他进塔）。
峰位表：全场一个峰——瑞米冲出门的爆发（「是客人来了！！」）；其后问答与介绍一律收平，结尾用行动收。

```js
{
  id: 'opening',
  steps: [
    { type: 'fade', ms: 1200 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '？？？', text: '究竟什么装置——能成为尖塔之星——能真正重铸魏启大陆的辉煌？' },
        { speaker: '？？？', text: '我的确不知道！还好，这么深奥的问题可以由科学进行回答，这就是我创造超概念确认机制的原因。' },
      ],
    },
    { type: 'image', src: 'cg/spire_in_snow', fadeInMs: 600, holdMs: 1800, fadeOutMs: 600 }, // 幕间：骑士立塔门前，甲上落雪
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（在塔门前站定，收起门口的字条。）' },
        { speaker: '？？？', text: '（塔门里传来急促的脚步声，越来越近。）' },
        { speaker: 'remi', text: '（瑞米从塔门里冲出来，在雪地上刹住。）呜哇！！是客人！！是客人来了！！' },
        { speaker: 'remi', text: '我在窗户里就看见你了！好久好久都没有客人来过了！！' },
        { speaker: 'remi', text: '（瑞米绕着骑士转了两圈，然后蹦回他面前站好。）你好啊，远道而来的朋友！欢迎来到尖塔！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '对了对了！你是从哪里来的呀？路上走了多久？' },
        { speaker: '骑士', text: '...外面。走了很久。' },
        { speaker: 'remi', text: '外面还在下雪吗？' },
        { speaker: '骑士', text: '...下着。' },
        { speaker: 'remi', text: '那……一路上还有别的人吗？' },
        { speaker: '骑士', text: '...没见着。' },
        { speaker: 'remi', text: '（瑞米愣了一下，很快又抬起头。）没关系！反正现在有客人了呀！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '哦，你好呀，说实话我还以为塔里没人呢。' },
        { speaker: 'remi', text: '嗯...我不是人，当然也不算怪物——你就当我是接引员吧！我叫瑞米！' },
        { speaker: 'remi', text: '跟你讲哦！塔越高，敌人就越强，好东西也越多！' },
        { speaker: 'remi', text: '到了塔顶，就能见到尖塔之星了哦！' },
        { speaker: 'remi', text: '凭借你的勇气、智慧和意志征服这座尖塔，登上塔顶吧！' },
        { speaker: 'remi', text: '（瑞米转身钻进塔门，又探出头来朝骑士招手。）快来快来，跟我来吧！' },
        { speaker: '骑士', text: '（骑士跟了进去。）' },
      ],
    },
    { type: 'call', fn: '$startFloor1' },
  ],
}
```

> 音乐｜remi 登场的瞬间，塔内主题以轻快拨奏进入。
> 备注｜开场两页 `？？？` 是**过去的塔主**（string.md 开篇引文）。
> 备注｜瑞米已经很久没有见过访客，整场的激动与好奇都由此而来；「一路上还有别的人吗」与篝火场「别的塔也亮着灯吗」是同一条远伏笔。

## firstDeath（首次死亡 → 塔楼重置）

> 幕间｜画面碎成数据流般的方格，逐层熄灭。

```js
{
  id: 'firstDeath',
  steps: [
    { type: 'fade', ms: 1600 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '？？？', text: '访客单位损毁。回溯流程……启动。' },
        { speaker: '？？？', text: '尖塔，重置。' },
      ],
    },
    { type: 'wipe', coverMs: 800, revealMs: 1200 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（从一层的地板上站起。）' },
        { speaker: 'remi', text: '（从楼梯口钻出来，怀里抱着一堆叮当作响的东西。）' },
        { speaker: 'remi', text: '骑士！你回来啦！！这些……这些是你的吧？我都收着呢！' },
        { speaker: '骑士', text: '你躲过了重置？' },
        { speaker: 'remi', text: '嗯！我也不知道为什么……塔转起来的时候，我就躲在台阶下面数自己的手指，数完就到下一轮了！' },
        { speaker: '骑士', text: '以后大战之前，把最贵重的几件交你保管。' },
        { speaker: 'remi', text: '包在我身上！我可是全塔最称职的保险箱！' },
      ],
    },
    { type: 'call', fn: '$grantDeathCarryRelics' },
  ],
}
```

> 备注｜"数手指躲重置"日后有机制解释，此处不写破。
