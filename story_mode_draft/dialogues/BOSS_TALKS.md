# 章节 Boss 前后置（boss11 / boss22 / boss33）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。44 层最终战 A 见 `TOP_OF_TOWER.md`。

---

## boss11 / boss22 / boss33（Boss 战前后置）

```js
{
  id: 'boss11Pre',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '等等……前面的气息不对劲。是这一层的看守者！' },
        { speaker: '骑士', text: '（握紧卡组。）' },
        { speaker: 'remi', text: '我、我就在旁边给你加油！你可千万别输哦！' },
      ],
    },
  ],
}
```

```js
{
  id: 'boss11Post',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '居然赢了！塔在上层向你敞开了一条通路！' },
        { speaker: '骑士', text: '（删去一张多余的卡，继续向上。）' },
        { speaker: 'remi', text: '……你刚才那一刀，收势的方式，好像这一层的看守者哦。你们认识吗？' },
        { speaker: '骑士', text: '...不认识。' },
      ],
    },
  ],
}
```

> 备注｜"不认识"（尾音轻）——埋"骑士的武艺=塔的源头"暗线。

```js
{
  id: 'boss22Pre', // 双子 Boss：同款"确认链路"技术，两个心灵相互感应的怪物
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '前面是两个看守者！……不对，是一个？它们、它们共用一个脑子！' },
        { speaker: '骑士', text: '...（拔刀的手停了半拍。）' },
        { speaker: 'remi', text: '怎么了？你认识它们？' },
        { speaker: '骑士', text: '...老技术。小心被读牌。' },
      ],
    },
  ],
}
```

```js
{
  id: 'boss22Post',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '呼……被看穿所有出牌的感觉，好可怕。它们看你的眼神，好像早就认识你的牌。' },
        { speaker: '骑士', text: '（收刀。）...低配版。' },
        { speaker: 'remi', text: '什么的低配版？' },
        { speaker: '骑士', text: '...' },
      ],
    },
  ],
}
```

> 备注｜"低配版"——双子 Boss 的确认链路，正是阿尔法装置神谕判别的简化件。

```js
{
  id: 'boss33Pre',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '再赢一场……就是塔顶了。' },
        { speaker: 'remi', text: '那个……看守者的气息很乱！好像、好像快要自己散架了！' },
        { speaker: '骑士', text: '...塔老了。' },
        { speaker: 'remi', text: '到了塔顶，你能带我一起看看星星吗？就看一眼！' },
        { speaker: '骑士', text: '...先赢了再说。' },
        { speaker: 'remi', text: '嗯！一言为定！' },
      ],
    },
  ],
}
```

```js
{
  id: 'boss33Post',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '赢了……我们真的要登顶了！' },
        { speaker: 'remi', text: '你的手在抖。' },
        { speaker: '骑士', text: '甲太沉。走。' },
      ],
    },
  ],
}
```

> 音乐｜战斗胜利音后不接塔内主题——留白，只剩登楼的脚步与甲片声。
> 备注｜若本场触发"看守者因尖塔老化暴毙、塔楼程序顶替扮演"分支，战后追加 BANTER 3.11。
