# 三结局（endingA 白月 / endingB 离开 / endingC 星星）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。

---

## endingA · 白月（假结局 · towerTopSolo / towerTopRefuse 之后）

> 幕间｜塔在月下倒塌是"静音"的：没有轰鸣，只有结构应力一声一声的闷响。

```js
{
  id: 'endingA',
  steps: [
    { type: 'image', src: 'cg/spire_collapse_moon', fadeInMs: 1200, holdMs: 3200, fadeOutMs: 800 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（骑士走到雪线，回头望了一眼。）' },
        { speaker: '？？？', text: '——白月——' },
      ],
    },
    { type: 'fade', ms: 2000 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 备注｜经 `towerTopRefuse` 进入时，可补一个镜头：他的甲缝空着——没有光跟出来。不加台词。

## endingB · 离开（真结局 1 · 最终战 B 战败）

```js
{
  id: 'endingB',
  steps: [
    { type: 'fade', ms: 1400 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（甲裂了几道口子，刀也钝了。）' },
        { speaker: 'remi', text: '（被冲击掀飞，抓住了崖边。）骑士！！' },
        { speaker: '骑士', text: '（骑士伸手去拉。）' },
        { speaker: 'remi', text: '……找到星星的话……替我……看一……' },
        { speaker: '？？？', text: '（崖边塌了一块。瑞米坠了下去。）' },
        { speaker: '？？？', text: '（阿尔法装置突然发出震耳欲聋的噪音，然后自己停机了。）' },
        { speaker: '塔楼程序', text: '解码进度：百分之九十九点——不。不！我要活……我要活下去……' },
        { speaker: '？？？', text: '（塔楼程序死了，尖塔开始崩塌。）' },
      ],
    },
    { type: 'image', src: 'cg/ruins_snow', fadeInMs: 800, holdMs: 2800, fadeOutMs: 1200 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（骑士从废墟里站起来，望向布满伤痕的双手，若有所思。）' },
        { speaker: '骑士', text: '（骑士拍拍灰，转身离开了。）' },
        { speaker: '？？？', text: '——离开——' },
      ],
    },
    { type: 'fade', ms: 2000 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 备注｜**停机不给任何解释台词**（权威解释见 string.md 作家批注）。

## endingC · 星星（真结局 2 · towerBaseC 之后）

```js
{
  id: 'endingC',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '？？？', text: '（尖塔崩塌。无尽的下坠之中，骑士怀抱着昏迷的瑞米。）' },
        { speaker: '？？？', text: '（他并不惧怕迎面而来的黑暗深渊，不是因为盔甲，不是因为武艺。）' },
        { speaker: '？？？', text: '（因为他找到了他的星星。）' },
      ],
    },
    { type: 'image', src: 'cg/crack_in_deep', fadeInMs: 1000, holdMs: 2400, fadeOutMs: 800 }, // 幕间：深渊裂缝里，一只手搭上边缘
    { type: 'image', src: 'cg/snow_stop_dawn', fadeInMs: 1000, holdMs: 2800, fadeOutMs: 600 }, // 幕间：雪停了
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '（醒来。）……骑士？我们……掉出来了？' },
        { speaker: '骑士', text: '嗯。' },
        { speaker: 'remi', text: '塔……没了？' },
        { speaker: '骑士', text: '没了。' },
        { speaker: 'remi', text: '那……我也算，下班了吧？' },
        { speaker: '骑士', text: '嗯。下班了。' },
        { speaker: 'remi', text: '雪……真的是白的诶。' },
        { speaker: '骑士', text: '...嗯。夜里是蓝的。' },
        { speaker: 'remi', text: '嗯！我等着看！' },
        { speaker: '骑士', text: '（把臂弯里的瑞米拢了拢，走进大雪里。）' },
        { speaker: '？？？', text: '——星星——' },
      ],
    },
    { type: 'fade', ms: 2400 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 音乐｜塔内主题（开场 remi 登场的拨奏动机）第一次完整奏出——首尾同源。
> 备注｜职员表后可接 BANTER 11.4 / 11.5（雪中、苹果树）作彩蛋。
