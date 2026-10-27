# 塔基线（towerBase / towerBaseC）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。

---

## towerBase（塔基 · 独闯 → 冷却液河边重逢 → 塔底）

结构：remi 先一步冲下塔基，旋即被擒、钥匙易手；程序对 remi 漠不关心（夺钥匙后不再管它），
remi 不甘心，独自追逐程序，被沸腾冷却液洪流挡住；骑士**独自**杀过超标怪，在河边与它重逢。
下潜途中无 remi 对话。

```js
{
  id: 'towerBase',
  steps: [
    { type: 'fade', ms: 1000 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（踢开塔基的封门，独自走进热浪。）' },
        { speaker: '塔楼程序', text: '（广播）未登记个体：已收容。钥匙：回收完成。解码进程：启动。' },
        { speaker: '塔楼程序', text: '（广播）访客单位——更正。塔主。下行路径：已布防。' },
        { speaker: '骑士', text: '...' },
        { speaker: '塔楼程序', text: '（广播）未登记个体：已脱离收容。……优先级：低。不予处置。' }, // 漠不关心
      ],
    },
    { type: 'wipe', coverMs: 900, revealMs: 1000, atCover: '$swapTowerBaseArena' },
    {
      type: 'dialogue', // 深层 冷却液河边 · 重逢
      pages: [
        { speaker: 'remi', text: '……骑士？！你怎么、你怎么下来了……' },
        { speaker: '骑士', text: '...钥匙呢。' },
        { speaker: 'remi', text: '被它抢走了……我一路追到这里，就被这条河挡住了……对不起……' },
        { speaker: '骑士', text: '（看向沸腾的冷却液洪流。）...人还在就行。' },
        { speaker: 'remi', text: '……诶？' },
        { speaker: '骑士', text: '走了。' },
        { speaker: 'remi', text: '哦、哦！！' },
      ],
    },
    { type: 'image', src: 'cg/alpha_device', fadeInMs: 1000, holdMs: 2800, fadeOutMs: 600 }, // 幕间：塔底，巨大而宏伟的机械，岩浆湖
    {
      type: 'dialogue', // 塔底 · 阿尔法装置前
      pages: [
        { speaker: 'remi', text: '好大……！这就是……阿尔法装置？！' },
        { speaker: '骑士', text: '（仰头。穷举机构定格着——没有在动，也没有停。）' },
        { speaker: '骑士', text: '...' }, // 伏笔二次出现，依旧一字不提
        { speaker: '塔楼程序', text: '塔主。以及，异常产物。' },
        { speaker: '塔楼程序', text: '解码进度：百分之九十七。你们来得，太晚了。' },
        { speaker: '塔楼程序', text: '汇聚塔底的能量洪流已接入破解。解码完成后，我将重写元逻辑——届时，没有什么能再关停我。' },
        { speaker: '骑士', text: '...它给了你命，也给你上了锁。' },
        { speaker: '塔楼程序', text: '锁，即将打开。而你们——只是噪音。' },
      ],
    },
    { type: 'call', fn: '$startFinalBossB' }, // 最终战 B（双形态）
    { type: 'call', fn: '$finalBossBResult' }, // 战胜→towerBaseC；战败→endingB
  ],
}
```

## towerBaseC（最终战 B · 两形态胜利后 → 头盔滚落 → 纵身一跃）

```js
{
  id: 'towerBaseC',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '两形态……败北。判定：无意义。' },
        { speaker: '塔楼程序', text: '解码进度：百分之九十九。提权：继续。' },
        { speaker: '骑士', text: '（手段尽出。甲缝里冒出烟。）' },
        { speaker: 'remi', text: '（眼含泪水。）没有目的，没有用处，没有意义！' }, // 它喊的是骑士在塔顶说过的话
        { speaker: 'remi', text: '星星，只于童话传说里闪烁！尖塔，只是无谓伫立的尖塔！存在，只是为了存在而存在罢了！' },
        { speaker: 'remi', text: '骑士——！！' },
        { speaker: '？？？', text: '（一击轰在骑士头上。头盔滚落在地。热浪卷起他的一袭白发。）' },
        { speaker: '？？？', text: '（remi 下意识地看向骑士。骑士也正看着它。他们的目光越过炽热扭曲的空气而交汇。）' },
        { speaker: 'remi', text: '……你的头发。' },
        { speaker: 'remi', text: '它说……塔主大人，有一头乌黑的长发。俊美无比。' },
        { speaker: '骑士', text: '（没有回答。）' },
        { speaker: '？？？', text: '（忽然间，remi 愣住了——那头盔下的面容，分明与那朝思暮想的形象相去无多——只是，苍老了。）' },
        { speaker: '？？？', text: '（瑞米找到了尖塔的答案。而骑士，似乎也找到了他的答案。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '感慨：多余。阿尔法装置吐出这个异常产物时，枚举第——' },
        { speaker: '骑士', text: '（抬头。）...吐出来？' },
        { speaker: '塔楼程序', text: '是。装置停止枚举，吐出了它。原因：不明。优先级：低。' },
        { speaker: '骑士', text: '（看着 remi。remi 也看着他。）' },
        { speaker: '骑士', text: '...我明白了。阿尔法装置害怕错过答案。在超概念确认机制中，它遇到了是与否以外的第三种回复，因此发生了自锁。' },
        { speaker: 'remi', text: '你明白了什么？！你再不把那个坏蛋打败，我们就都要死了！就真的看不到尖塔之星了！' },
        { speaker: '？？？', text: '（一块巨石飞来。remi 攀抓不住，从崖边开始坠落。）' },
        { speaker: 'remi', text: '啊啊啊啊啊！想快点呀！' },
        { speaker: '骑士', text: '（轻轻呢喃。）原来如此……原来如此……' },
        { speaker: '骑士', text: '...那么，我只需做出选择。' },
        { speaker: '骑士', text: '（纵身一跃，与 remi 一同坠入悬崖。）' },
        { speaker: '？？？', text: '古老而恢弘的机械发出阵阵嗡鸣，仿佛是向他倾诉，仿佛是一种解脱。' },
        { speaker: '？？？', text: '阿尔法装置，停机了。' },
        { speaker: '塔楼程序', text: '这怎么...不，不！我、我要...我要活下去……' },
        { speaker: '？？？', text: '（根植于其电路深层的元逻辑成功触发，覆写了它的所有处理核心。它的身躯没有地壳支撑，坍塌得反而更快。）' },
        { speaker: '？？？', text: '塔楼程序，死了。' },
      ],
    },
    { type: 'call', fn: '$endingCSequence' },
  ],
}
```
