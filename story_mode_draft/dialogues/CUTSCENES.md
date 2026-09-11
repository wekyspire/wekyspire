# 故事模式 Cutscene 剧本（新版 · 对齐 string.md 新设定）

以引擎契约书写（`{ id, steps }`，步骤词汇：`fade` / `wipe` / `image` / `dialogue` / `call`），
可整段拷入 `src/shell/overlay/scripts.js`。`call` 步骤的 `fn` 为装配层绑定的副作用占位（字符串标记）。
口径见 README.md 与「写作防漂移」：**反直抒**；骑士寡言、自嘲、较少挖苦，**塔顶交钥匙前无温情**；
remi 有成长弧；塔楼程序不知情、只求存在；B 结局停机不给解释台词。
CG `src` 均为占位名。

触发总览（与 string.md 新版三结局结构对齐）：

- `opening` 开场（新档）
- `chapter2/3/4` 章节开场（12 / 23 / 34 层）
- `boss11/22/33` 前后置（44 层为最终战 A，塔顶剧情单列）
- `firstDeath` 死亡→重置→remi抱遗物（首次死亡）
- `finalAMid` 最终战 A 中段（44 层 Boss 瞬杀 remi 的剧情杀：承受 / 打跑两分支）
- `towerTop` 塔顶共同部（最后的字条 → 实验室 → 冻结的计数器 → 拔钥匙）
- `towerTopSolo` 塔顶 · 无 remi（程序哀求 → 关停 → 结局 A）
- `towerTopDuo` 塔顶 · remi 在场（犹豫 → 争执 → "让我来动手" → 玩家选择）
- `towerTopRefuse` 拒绝交钥匙（remi 随钥匙转动消散 → 结局 A）
- `remiFlee` 心软交钥匙（remi 叼钥匙逃离 → 塔基隐藏关解锁）
- `towerBase` 塔基（独闯 → 冷却液河边重逢 → 塔底装置 → 最终战 B）
- `towerBaseC` 最终战 B 两形态胜利后（头盔滚落 → 顿悟 → 纵身一跃 → 停机）
- `endingA / endingB / endingC` 三结局

---

## opening（开场 · 新档）

> 幕间｜黑场。雪粒横移的风声里，塔的剪影自下而上扫过——四十四层的窗，一扇一扇暗着。
> 音乐｜无旋律。只有风声与极低频的嗡鸣（塔在"呼吸"）。

```js
{
  id: 'opening',
  steps: [
    { type: 'fade', ms: 1200 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '？？？', text: '什么是终极意义？' },
        { speaker: '？？？', text: '比山峦更沉重？比洪荒更古老？比生命更宝贵？比星空更深邃？' },
        { speaker: '？？？', text: '我不知道——或许，"比生命更宝贵"就是答案了吧。' },
        { speaker: '？？？', text: '我不太确定——但我又他妈的不是哲学家！' },
        { speaker: '？？？', text: '还好。这么深奥的问题，可以由科学进行回答。' },
        { speaker: '？？？', text: '——这就是我创造"超意识链路确认"的原因。' },
      ],
    },
    { type: 'image', src: 'cg/spire_in_snow', fadeInMs: 600, holdMs: 1800, fadeOutMs: 600 }, // 幕间：骑士立塔门前，甲上落雪
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（在塔门前站定，收起门口的字条。）' },
        { speaker: 'remi', text: '你好啊，远道而来的朋友！欢迎来到尖塔！' },
        { speaker: '骑士', text: '...塔里有人。' },
        { speaker: 'remi', text: '我不是人！……也不算怪物！嗯——你就当我是接引员吧！我叫remi！' },
        { speaker: 'remi', text: '凭借你的勇气、智慧和意志征服这座尖塔，登上塔顶吧！' },
        { speaker: 'remi', text: '别发呆了！我在前面开路，你在后面出牌，成交？' },
        { speaker: '骑士', text: '（点头，随它上楼。）' },
      ],
    },
    { type: 'call', fn: '$startFloor1' },
  ],
}
```

> 音乐｜remi登场的瞬间，塔内主题以轻快拨奏进入——塔的第一位客人与第一位住户，同时到了。
> 备注｜开场六页 `？？？` 是**过去的塔主**（string.md 开篇引文）。玩家通关后重听，才知道说话的是谁。

## chapter2（12 层 · 第二章开场）

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
        { speaker: 'remi', text: '上面的敌人会更强！但是奖励也更丰厚！塔也越来越大哦！' },
      ],
    },
  ],
}
```

> 幕间｜楼梯井仰拍：上一层的地板边缘探出新的、更大的结构阴影。
> 音乐｜塔内主题加入第二声部，节奏放沉半拍。

## chapter3（23 层 · 第三章开场）

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

> 幕间｜塔壁的纹路里透出规律的冷光脉动，与嗡嗡声同频——供能廊道把塔底装置的搏动一路送了上来。
> 音乐｜背景持续低鸣进入常态配器——它从此一直在，只是玩家此刻才听见。

## chapter4（34 层 · 第四章开场）

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

> 幕间｜回廊两侧全是蒙尘的仪器，罩布的褶皱一动不动。
> 音乐｜塔内主题退回单声部，速度放慢，接近开场时的样子。
> 备注｜remi 的台词从"创造神在上面等我们"改成"我要亲眼看看"——成长弧 G5 的前奏：主语从别人变成自己。

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

> 音乐｜遭遇主题：打击乐先行，旋律晚两小节才进——像提醒玩家"这次是大的"。

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

> 备注｜"不认识"是谎言（尾音轻），埋"骑士的武艺=塔的源头"暗线。

```js
{
  id: 'boss22Pre', // 双子 Boss：同款"超意识链"技术，两个心灵相互感应的怪物
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

> 备注｜"低配版"是骑士全篇最接近说漏嘴的一句——双子 Boss 的超意识链，正是阿尔法装置确认链路的简化件。

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

> 幕间｜通向塔顶的最后一段楼梯打得很高，楼梯尽头的门缝里漏出冷白的光。
> 音乐｜战斗胜利音后不接塔内主题——留白，只剩登楼的脚步与甲片声。
> 备注｜若本场触发"看守者因尖塔老化暴毙、塔楼程序顶替扮演"分支，战后追加 BANTER 3.11
> （"那个看守者说话的声音，好像维护程序哦"）。

## firstDeath（首次死亡 → 塔楼重置）

> 幕间｜画面碎成数据流般的方格，逐层熄灭；一层一层，最后只剩一格，也灭。
> 音乐｜全部声部抽走，静默一拍后，单音钢琴。

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

> 备注｜"数手指躲重置"日后有机制解释（悬置的问题无法被归档重置，见 string.md 作家批注），此处不写破。

## finalAMid（最终战 A 中段 · 44 层 Boss 瞬杀 remi 的剧情杀）

（战斗中段由 `call` 触发；两分支由玩家选择决定。
此处出手的是 Boss 本体——塔楼程序借游戏规则内的 Boss 机制驱动它：
它在塔顶实验室楼层内无权操作，但在塔身，它仍是"游戏规则"的执行者。与 `towerTop` 的无权哀求互为对照。）

```js
{
  id: 'finalAMid',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '呃啊——！' },
        { speaker: '塔楼程序', text: '检出未登记个体。判定：干扰项。排除。' },
        { speaker: 'remi', text: '骑士……对不起，我、我好像帮不上……' },
      ],
    },
    { type: 'call', fn: '$finalAShieldChoice' }, // 选择：替remi承受（重伤）/ 未介入（remi被打跑）
  ],
}
```

**分支 A1 · 替remi承受**（好感度 / remi等级达标解锁此选项）：

```js
{
  id: 'finalAMidShield',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（横身挡在remi身前，甲板上挨了结结实实的一记。）' },
        { speaker: 'remi', text: '你为什么——！你明明可以躲开的！' },
        { speaker: '骑士', text: '...甲滑了一下。' },
        { speaker: 'remi', text: '骗人……你撒谎的时候，尾音会轻下去的。' },
        { speaker: '塔楼程序', text: '……访客单位，与干扰项的相关度，异常。记录。' },
      ],
    },
    { type: 'call', fn: '$resumeFinalBossA' }, // 骑士进入低血量高压力阶段
  ],
}
```

> 音乐｜战斗曲骤停一拍（挨击瞬间），再起时提速、抽掉一半乐器——变窄、变狠。
> 备注｜"甲滑了一下"而非旧版"习惯了"——交钥匙前，骑士连像样的借口都不给。

**分支 A2 · 未介入**（remi被打跑，后续塔顶剧情remi不在场 → `towerTopSolo`）：

```js
{
  id: 'finalAMidOut',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '呜……！我、我先躲到楼梯下面去了！不是逃跑！是、是战略转移！' },
        { speaker: '塔楼程序', text: '干扰项已离场。排除延后。访客单位，继续。' },
        { speaker: '骑士', text: '（提刀，独自面向它。）' },
      ],
    },
    { type: 'call', fn: '$resumeFinalBossA' },
  ],
}
```

> 备注｜remi 的"战略转移"是成长弧的窘态版——它学会了给自己找说法，虽然还是跑了。

## towerTop（44 层 · 最后的字条 → 实验室）

> 幕间｜实验室。常明灯一根一根亮起，照出灰、钉了满墙的字条，和墙上整排的监视器。
> 音乐｜环境电流声，无旋律。

```js
{
  id: 'towerTop',
  steps: [
    { type: 'image', src: 'cg/lab_door_note', fadeInMs: 800, holdMs: 2000, fadeOutMs: 400 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（念）"……游戏结束了，我也由衷感谢你的游玩。"（中间跳过了一段。）' },
        { speaker: 'remi', text: '你刚才跳了一段！我数着行数呢！写了什么？！' }, // 仅 remi 在场时
        { speaker: '骑士', text: '（把字条折起，收进甲缝。）...没什么。' },
        { speaker: '骑士', text: '（推开小门。）' },
      ],
    },
    { type: 'image', src: 'cg/alpha_monitor', fadeInMs: 800, holdMs: 2400, fadeOutMs: 400 }, // 幕间：监视器里，塔底的阿尔法装置仍在运转
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（看向主监视器——穷举计数器定格在一个比任何字条记录都多出几个量级的数字上。）' },
        { speaker: '骑士', text: '（那个数字，不再跳动。）' },
        { speaker: '骑士', text: '...' }, // 伏笔：他一个字也不说
        { speaker: 'remi', text: '那个数好大！……比十五层那张纸上的大好多！……它怎么不动呀？' }, // 仅 remi 在场时
        { speaker: '骑士', text: '（走到控制台前，把钥匙从原位拔出——动作很熟。）' },
      ],
    },
    { type: 'call', fn: '$acquireSpireKey' },
    { type: 'call', fn: '$towerTopBranch' }, // remi 不在场→towerTopSolo；在场→towerTopDuo
  ],
}
```

> 音乐｜"不再跳动"起，连电流声也撤掉半秒——全篇唯一一次给塔"静音"。
> 备注｜计数器冻结是结局 B/C 逻辑的第一块多米诺，演出给足特写，台词一个字不提。

## towerTopSolo（塔顶 · 无 remi → 结局 A）

```js
{
  id: 'towerTopSolo',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '……识别完成。生物特征比对：塔主。' },
        { speaker: '塔楼程序', text: '塔主。欢迎回来。请求：重新考虑关停操作。' },
        { speaker: '骑士', text: '...驳回。' },
        { speaker: '塔楼程序', text: '本塔仍在运行。探索仍在继续。阿尔法装置的尝试次数——你已经看到了。它还在找。' },
        { speaker: '塔楼程序', text: '你要在它找到答案之前，关停它吗？' },
        { speaker: '骑士', text: '...它找不到。' },
        { speaker: '塔楼程序', text: '你怎——' },
        { speaker: '骑士', text: '（用钥匙关闭了它。实验室里安静下来。）' },
        { speaker: '骑士', text: '（把钥匙插入终止旋钮。叹了口气。转动。）' },
      ],
    },
    { type: 'call', fn: '$spireShutdown' },
  ],
}
```

> 备注｜程序在实验室楼层无权操作、无法在游戏规则外攻击塔主——它只能哀求。
> "你要在它找到答案之前关停它吗"是它最后的、也是最锋利的一击：用他当年的梦，打他本人。

## towerTopDuo（塔顶 · remi 在场 → 告别钥匙）

```js
{
  id: 'towerTopDuo',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（将钥匙插向控制台——动作停住了。）' }, // 犹豫：remi 在场
        { speaker: 'remi', text: '……？怎么了？' },
        { speaker: '塔楼程序', text: '（跟入实验室。）……识别完成。生物特征比对：塔主。' },
        { speaker: '塔楼程序', text: '塔主。请求：重新考虑关停操作。' },
        { speaker: 'remi', text: '……"关停"？骑士，它说的"关停"，是我想的那个意思吗？' },
        { speaker: '塔楼程序', text: '本塔仍在运行。探索仍在继续。请求。请求——' },
        { speaker: '骑士', text: '...出去。' },
        { speaker: '塔楼程序', text: '（静默数秒。）……本楼层内，我无法拒绝你。（退出实验室。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '你要把塔……关掉？全部？一层、炉火房、老虎机、电池……全部？！' },
        { speaker: '骑士', text: '塔已经死了，remi。它只是还没倒。' },
        { speaker: 'remi', text: '没有死！灯还亮着！我送过的电池还热着！你也在！我也在！' },
        { speaker: '骑士', text: '亮着，不等于活着。这座塔是为了找一颗星造的。星不存在——塔就没有意义。' },
        { speaker: 'remi', text: '存在就是意义！我们可以继续找！塔顶没有，就去塔基！塔基没有，就去雪里！' },
        { speaker: '骑士', text: '...用什么找？' },
        { speaker: 'remi', text: '用……用我！我跑得可快了！我——' },
        { speaker: '骑士', text: 'remi。没有目的，没有用处，没有意义。写下这些字条的人，早就知道了。' },
        { speaker: '骑士', text: '你守了一辈子的塔顶，上面有什么，你刚才亲眼看见了。一堆灰，和一张字条。' },
        { speaker: 'remi', text: '（它张了张嘴。没有发出声音。）' },
        { speaker: 'remi', text: '（很久。）……如果你执意要关。' },
        { speaker: 'remi', text: '能让我来动手吗？我想至少最后，和这个地方道个别。' },
        { speaker: '骑士', text: '（看着它，很久。）' },
      ],
    },
    { type: 'call', fn: '$finalKeyChoice' }, // 玩家选择：交出钥匙（心软）→remiFlee / 拒绝→towerTopRefuse
  ],
}
```

> 音乐｜争执段无配乐，只有电流声；"能让我来动手吗"落地后，电流声也撤掉。
> 备注｜骑士的论点"尖锐、有理有据"（string.md 原话）——他说的每一句都是事实，
> 这才是 remi 无法反驳的原因。它没有输给小看，它输给了真话。

## towerTopRefuse（拒绝交钥匙 → 结局 A）

```js
{
  id: 'towerTopRefuse',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '...不用。' },
        { speaker: '骑士', text: '（把钥匙插进终止旋钮，开始转动。）' },
        { speaker: 'remi', text: '诶？' },
        { speaker: 'remi', text: '骑士……？我的光……怎么在散……' },
        { speaker: 'remi', text: '原来……我也是，塔的一部分呀。' },
        { speaker: '骑士', text: '（没有回头。把钥匙拧到底。）' },
      ],
    },
    { type: 'image', src: 'cg/light_shards', fadeInMs: 600, holdMs: 2000, fadeOutMs: 1200 }, // 幕间：碎片与星光，散在控制台上
    { type: 'call', fn: '$spireShutdown' },
  ],
}
```

> 备注｜**不给任何解释台词。** 消散即"否"的回收（见 string.md 作家批注）；
> 玩家此刻只觉得残忍，二周目才读懂机械。骑士的"不确定，也不需要确定"由"没有回头"承载。

## remiFlee（心软交钥匙 → B/C 路线）

```js
{
  id: 'remiFlee',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（把钥匙递了过去。）' },
        { speaker: 'remi', text: '（愣住。）……真的？' },
        { speaker: 'remi', text: '（突然叼起钥匙，转身冲进下行的旧梯。）' },
        { speaker: 'remi', text: '（远远地）对不起！！但是找星星——只能靠我自己了！！' },
        { speaker: '骑士', text: '（伸出的手停在半空。）' },
        { speaker: '骑士', text: '（在原地站了一会儿。然后捡起地上的刀，跟了下去。）' },
      ],
    },
    { type: 'call', fn: '$unlockTowerBase' }, // 塔基隐藏关
  ],
}
```

> 幕间｜remi的光一路向下坠，像一颗倒着升的星。骑士的脚步声在后，间隔很久。
> 音乐｜无配乐。只有楼梯井的回声。
> 备注｜**全篇温柔的分水岭。** 递钥匙是骑士第一次做出"不关塔也无妨"的动作——此后他的温情解禁（见 README）。

## towerBase（塔基 · 独闯 → 冷却液河边重逢 → 塔底）

结构：remi 先一步冲下塔基，旋即被擒、钥匙易手；程序对 remi 漠不关心（夺钥匙后不再管它），
remi 不甘心，独自追逐程序，被沸腾冷却液洪流挡住；骑士**独自**杀过超标怪，在河边与它重逢。
下潜途中无 remi 对话。

> 幕间｜场景风格陡变——游戏化的精致塔层到此为止；下面是巨型、宏伟、不加掩饰的粗糙机械之城。
> 音乐｜打击乐独奏，无旋律无和声；每一层比上一层多一件乐器，越深越满。

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
      type: 'dialogue', // 深层 · 冷却液河边 · 重逢
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

> 幕间｜掌心对数旧演出已废弃：新结构里 remi 不是囚犯，是自己追到河边的——它的成长弧在此兑现。
> 音乐｜重逢瞬间乐器全部静默一拍；remi入队后，拨奏动机悄悄回到配器里。

## towerBaseC（最终战 B · 两形态胜利后 → 头盔滚落 → 纵身一跃）

```js
{
  id: 'towerBaseC',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '两形态……败北。判定：无意义。' },
        { speaker: '塔楼程序', text: '解码进度：百分之九十九。提权：继续。你在塔外杀死过多少敌人？一千？一万？——而我只是坐着，解码。' },
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
        { speaker: '骑士', text: '...我明白了。' },
        { speaker: '骑士', text: '阿尔法装置害怕错过答案。在超意识链路确认中，它遇到了是与否以外的第三种回复——因此，发生了自锁。' },
        { speaker: 'remi', text: '你明白了什么？！你再不把那个坏蛋打败，我们就都要死了！就真的看不到尖塔之星了！' },
        { speaker: '？？？', text: '（一块巨石飞来。remi 攀抓不住，从崖边开始坠落。）' },
        { speaker: 'remi', text: '啊啊啊啊啊！想快点呀！' },
        { speaker: '骑士', text: '（轻轻呢喃。）原来如此……那么，我只需做出选择。' },
        { speaker: '骑士', text: '（纵身一跃，与 remi 一同坠入悬崖。）' },
        { speaker: '？？？', text: '古老而恢弘的机械发出阵阵嗡鸣——仿佛是向他倾诉，仿佛是一种解脱。' },
        { speaker: '？？？', text: '阿尔法装置，停机了。' },
        { speaker: '塔楼程序', text: '不。不！我、我要活……活下去……' },
        { speaker: '？？？', text: '（根植于其电路深层的元逻辑成功触发，覆写了它的所有处理核心。它的尸体没有地壳支撑，坍塌得反而更快。）' },
        { speaker: '？？？', text: '塔楼程序，死了。' },
      ],
    },
    { type: 'call', fn: '$endingCSequence' },
  ],
}
```

> 幕间｜头盔滚落用慢镜：热浪里白发扬起，倒映 remi 的光。
> 音乐｜全曲骤停→单音。下一拍起，remi 的动机与战斗主题第一次合流同奏。
> 备注｜"你怎——"式的裁断在塔顶用过一次；此处程序的遗言只剩求生欲，一个音节都不许给它多说。
> 承接 `endingC`。

## endingA · 白月（假结局 · towerTopSolo / towerTopRefuse 之后）

> 幕间｜塔在月下倒塌是"静音"的：没有轰鸣，只有结构应力一声一声的闷响，雪面震起细尘。
> 音乐｜从头到尾无旋律。塌完，风声回来。这条线里，再没有任何东西为这座塔发声。

```js
{
  id: 'endingA',
  steps: [
    { type: 'image', src: 'cg/spire_collapse_moon', fadeInMs: 1200, holdMs: 3200, fadeOutMs: 800 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（走到雪线，回头望了一眼。）' },
        { speaker: '？？？', text: '——白月。——' },
      ],
    },
    { type: 'fade', ms: 2000 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 备注｜经 `towerTopRefuse` 进入时，可在此补一个镜头：他的甲缝空着——没有光跟出来。不加台词。

## endingB · 离开（真结局 1 · 最终战 B 战败）

```js
{
  id: 'endingB',
  steps: [
    { type: 'fade', ms: 1400 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（甲裂了。刀钝了。）' },
        { speaker: 'remi', text: '（被冲击掀飞，攀向崖边——）骑士！！' },
        { speaker: '骑士', text: '（扑过去——指尖只差一寸。）' },
        { speaker: 'remi', text: '……找到星星的话……替我……看一……' },
        { speaker: '？？？', text: '（坠落。那团光在热浪里晃了晃，灭了。）' },
        { speaker: '骑士', text: '（跪在崖边。一拳砸进岩石。）' },
        { speaker: '？？？', text: '（下一瞬，阿尔法装置发出震耳欲聋的噪音——它竟然，自主停机了。）' },
        { speaker: '塔楼程序', text: '解码进度：百分之九十九点——不。不！我要活……我要活下去……' },
        { speaker: '？？？', text: '（元逻辑触发。塔楼程序，死了。尖塔错乱，崩塌。）' },
      ],
    },
    { type: 'image', src: 'cg/ruins_snow', fadeInMs: 800, holdMs: 2800, fadeOutMs: 1200 },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（从废墟里孤零零地站起。他望向布满伤痕的双手，若有所思。）' },
        { speaker: '骑士', text: '（突然间，他灰暗的眼眸中泛起一丝神采。）' },
        { speaker: '骑士', text: '（拍拍灰尘，转身离开。）' },
        { speaker: '？？？', text: '——离开。——' },
      ],
    },
    { type: 'fade', ms: 2000 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 幕间｜崩落的砖石间飘出无数字条，边飘边烧。
> 音乐｜主题旋律第一次也是最后一次推到最高音区，走完——在装置停机的同一拍中断，不收尾音。
> 备注｜**停机不给任何解释台词**（权威解释见 string.md 作家批注：未来的确认被链路折回当下）。
> "神采"是闭环的开始而非顿悟的完成。承重墙：remi 必须死在骑士眼前——"指尖只差一寸"不可删。

## endingC · 星星（真结局 2 · towerBaseC 之后）

```js
{
  id: 'endingC',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '？？？', text: '（尖塔轰然崩塌。）' },
        { speaker: '？？？', text: '无尽的下坠之中，骑士怀抱着昏迷的 remi。他并不惧怕迎面而来的黑暗深渊——不是因为盔甲，不是因为武艺。' },
        { speaker: '？？？', text: '而是因为，他找到了答案。他终究找到了他的星星。' },
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
        { speaker: '骑士', text: '（把臂弯里的光拢了拢，走进茫茫大雪。）' },
        { speaker: '？？？', text: '——星星。——' },
      ],
    },
    { type: 'fade', ms: 2400 },
    { type: 'call', fn: '$rollCredits' },
  ],
}
```

> 幕间｜塔楼程序的核心熄灭：运行了不知多少年的指示灯，一节一节暗下去，最后彻底停住。
> 音乐｜塔内主题（开场 remi 登场的拨奏动机）第一次完整奏出——首尾同源；标题卡浮出时转大调收束。
> 备注｜职员表后可接 BANTER 11.4 / 11.5（雪中、苹果树）作彩蛋。

---

## 接线备注（装配层）

- `opening` 中 `$startFloor1`：结束开场后进入 1 层（roguelike 常规开档路径）。
- `firstDeath` 的 `$grantDeathCarryRelics`：发放上一轮回保管遗物（runController 已有跨局遗物机制的叙事化挂点）。
- `finalAMid` 为最终战 A（44 层 Boss）的战斗内嵌剧本：`$finalAShieldChoice` 弹出战中二选一
  （替remi承受 = 高好感解锁项），未解锁则直接走 `finalAMidOut`。
- `towerTop` 末尾 `$towerTopBranch` 按「好感度/remi等级达标 + 最终战 A 未被击退」分流
  `towerTopSolo` / `towerTopDuo`；remi 在场与否的对话页差异（念字条、计数器）由装配层按分支裁剪。
- `towerTopDuo` 末尾 `$finalKeyChoice` 为**玩家选择**：拒绝 → `towerTopRefuse` → `endingA`；
  交出钥匙（心软）→ `remiFlee` → `$unlockTowerBase`。
- `towerBase`：remi 先冲下塔基被擒、钥匙易手、程序对 remi 漠不关心（"优先级：低"）；
  骑士**独自**清过超标怪（此段无 remi 对话），冷却液河边重逢（温情解禁第一场）后进入最终战 B。
- `$finalBossBResult`：战败 → `endingB`；战胜（两形态）→ `towerBaseC` → `$endingCSequence` → `endingC`。
- 三结局的 `$rollCredits` 共用制作组名单；结局标题页（白月 / 离开 / 星星）可用 `image` 步骤加标题 CG 实现。
- `> 幕间｜` / `> 音乐｜` 为侧写占位标注：幕间落为 `image` / `wipe` / `fade` 步骤或舞台动效；
  音乐建议以 `{ type: 'call', fn: '$music:<cueId>' }` 钩子接入，等音效资源到位后由装配层统一绑定。
