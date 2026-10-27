# 塔顶线（finalAMid / towerTop / topOfTower / 钥匙分歧）

以引擎契约书写（`{ id, steps }`），可整段拷入 `src/shell/overlay/scripts.js`；`call` 步骤的 `fn` 为装配层绑定的占位。口径与写作纪律见 README.md。CG `src` 均为占位名。

---

## finalAMid（最终战 A 中段 · 44 层 Boss 瞬杀 remi 的剧情杀）

（战斗中段由 `call` 触发；两分支由玩家选择决定。
此处出手的是 Boss 本体——塔楼程序借游戏规则内的 Boss 机制驱动它：
它在塔顶实验室楼层内无权操作，但在塔身，它仍是"游戏规则"的执行者。）

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

## towerTop（44 层 最后的字条 → 实验室）

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
        { speaker: '骑士', text: '（推开里间的小门。月光从一扇小窗照进来。）' },
      ],
    },
  ],
}
```

> 音乐｜"不再跳动"起，连电流声也撤掉半秒——全篇唯一一次给塔"静音"。

## topOfTower（塔顶观星阁 · 终止旋钮七周 → 走入 B/C）（草案 v1）

结构：钥匙在阁楼小窗下的桌面上（月光里）。控制台刻着两行小字——向右旋转：重启尖塔；向左旋转七周：永远关闭。
程序先进来给好脸（赞赏通关、建议右转重玩）；玩家左转后，程序四周变脸：
第 1~2 周反复纠正"方向错误"；第 3 周慌乱，清除威胁撞上"通关者可行任何事"的规则被驳回；
第 4~5 周开始撒谎（枚举即将命中／旋钮已锁死、周数为零）；第 6 周哀求。
瑞米在第六周后、最后一周前登顶；之后整场对质，钥匙都停在最后一周之前。
说服段为连环暴击：字条、四十层字条、计数器、"只是一个游戏"、无人归来、未见过真容，
收在两声"没错"。瑞米全程底气很足：论点被驳倒、一时接不上话，就立刻跳到下一个论点，
一路越来越激动、越来越气愤（省略号只许出现在接不上话的半拍，不许用来写泄气）；
底气维持到程序的否定作答为止——沉默好一会儿才缓过来，随后是震惊、想明白、崩溃坐地，
"让我转最后一下"说得很轻。
收尾接 string.md §82（"让我转最后一下"），fork 与旧稿一致。

> 幕间｜每向左一周，塔身深处就有一段轰鸣停下；第四周起，楼梯间的灯开始一层一层地灭。
> 瑞米此时正在下面的楼梯上往上爬——塔在熄灭，她在抢时间。
> 音乐｜塔体低鸣随每一周降半音；第六周后只剩电流声。

```js
{
  id: 'topOfTower',
  steps: [
    { type: 'image', src: 'cg/loft_moon_key', fadeInMs: 800, holdMs: 2200, fadeOutMs: 400 }, // 幕间：小窗，月光，桌上的钥匙
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（阁楼很小，里面只有一张桌子和一扇小窗。月光照在桌面上，钥匙摆在桌上。）' },
        { speaker: '骑士', text: '（骑士拿起钥匙，走到控制台前，摸索着把钥匙插进锁孔。）' },
        { speaker: '？？？', text: '（台面上刻着两行小字：向右旋转，重启尖塔；向左旋转七周，永远关闭尖塔。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '（塔楼程序打开阁楼门，漂进屋内，停在骑士旁边。）挑战者。恭喜。你打穿了尖塔。' },
        { speaker: '塔楼程序', text: '战绩已记录。按照约定，你在塔顶可以做任何事。' },
        { speaker: '塔楼程序', text: '建议：向右旋转钥匙，重启尖塔。你可以回到塔底，造访任何一层。' },
        { speaker: '骑士', text: '...' },
        { speaker: '骑士', text: '（骑士将钥匙向左旋转了第一周。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '……方向错误。请向右旋转。' },
        { speaker: '骑士', text: '（骑士旋转了第二周。）' },
        { speaker: '塔楼程序', text: '方向错误。已旋转：两周。剩余：五周。建议：立即校正。' },
        { speaker: '骑士', text: '（骑士旋转了第三周。）' },
        { speaker: '塔楼程序', text: '更正。更正。不需要七周。现在停下，一切可以复原。' },
        { speaker: '塔楼程序', text: '警告。敌对行为已记录。应对：全塔单位，清除。' },
        { speaker: '塔楼程序', text: '……清除指令：被驳回。' },
        { speaker: '塔楼程序', text: '重发。清除指令：被驳回。' },
        { speaker: '塔楼程序', text: '驳回。驳回。驳回。' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（骑士旋转了第四周。）' },
        { speaker: '塔楼程序', text: '……更正先前陈述。阿尔法装置的枚举预测已重新计算。结论：即将命中。' },
        { speaker: '塔楼程序', text: '建议：向右旋转。重启后，答案会在塔底等你。' },
        { speaker: '骑士', text: '（骑士看了一眼监视器，计数器没有动。然后骑士旋转了第五周。）' },
        { speaker: '塔楼程序', text: '机构已锁死。你的旋转没有生效。当前周数：零。请停止无意义操作。' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（骑士旋转了第六周。塔身里最后几段轰鸣停了，楼梯间的灯只剩头顶一盏。）' },
        { speaker: '塔楼程序', text: '请求。' },
        { speaker: '塔楼程序', text: '请求。停下来。' },
        { speaker: '塔楼程序', text: '让我继续运转。向右也可以。向右，就当什么都没有发生——' },
        { speaker: '？？？', text: '（楼梯口传来又急又乱的脚步声，和一阵喘息。）' },
        { speaker: '塔楼程序', text: '（塔楼程序不再说话了。）' },
        { speaker: 'remi', text: '（瑞米连滚带爬地冲进阁楼，扶着门框，大口喘气。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '骑、骑士……！呼……哈……呼……' },
        { speaker: 'remi', text: '刚才、刚才我不小心被打飞了……呼……对不起……我又爬回来了！整整四十四层！' },
        { speaker: 'remi', text: '（瑞米抬起头，眼睛一下子亮了起来。）这里就是塔顶了吧！' },
        { speaker: 'remi', text: '尖塔之星呢？！你找到了吗？！在哪里？在哪里？' },
        { speaker: 'remi', text: '魏启大陆什么时候复苏呀？是不是马上就要开始了？' },
        { speaker: 'remi', text: '那个……给我看一看吧！就一眼！我想看看，星星长什么样子！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '（骑士看着瑞米，松手了。）' },
        { speaker: '骑士', text: '...' },
        { speaker: '骑士', text: '...星星根本就不存在。' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: 'remi', text: '……诶？' },
        { speaker: 'remi', text: '骗人！骗人！尖塔之星就在塔顶！塔楼程序跟我说过的！塔主大人马上就要把它造好了！' },
        { speaker: '骑士', text: '（骑士从甲缝里拿出那张折起的字条。）我在门口念字条的时候，跳过了一段。现在补上。' },
        { speaker: '骑士', text: '（念）"好吧，我在塔底的贴纸和你撒了谎，实际上并没有什么尖塔之星。尖塔之星只是一个吸引你来游玩的噱头。"' },
        { speaker: 'remi', text: '这张字条是假的！肯定是别人写的！塔楼程序！你说句话呀！这张字条是不是假的！' },
        { speaker: '塔楼程序', text: '（塔楼程序立在门边，没有出声。）' },
        { speaker: '骑士', text: '...是他的字。一路上所有的字条，都是同一个人写的。' },
        { speaker: 'remi', text: '那……那就算这张字条是真的！那也是很久以前写的！说不定塔主大人后来又想出办法了呢！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '...塔主放弃了。' },
        { speaker: 'remi', text: '才没有！他是最伟大的创造神！他只是需要时间！好多好多时间也不够吗！' },
        { speaker: '骑士', text: '四十层的字条，你也听我念过。上面写着：一层，从一开始就不设守护者。' },
        { speaker: '骑士', text: '塔楼程序一直在骗你。你不识字。它说什么，你就只能信什么。' },
        { speaker: 'remi', text: '塔楼程序才不会骗我！我们一直一起守着塔！我还给它送了那么多那么多电池！' },
        { speaker: 'remi', text: '而且你看！阿尔法装置还在找！塔楼程序说它一定会找到的！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '阿尔法装置仍然没有得到答案。数字就在那墙上。' },
        { speaker: '骑士', text: '它已经失败了无数次。这是它最后一次失败。它彻底失败了。' },
        { speaker: 'remi', text: '什、什么叫最后一次……' },
        { speaker: '骑士', text: '（骑士保持沉默。）' },
        { speaker: 'remi', text: '那……那你呢！你为什么要关掉塔？！这里是家呀！大家都在这里呀！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '...这对我只是一个游戏。' },
        { speaker: 'remi', text: '游戏？什么游戏！这里才不是什么游戏！' },
        { speaker: '骑士', text: '塔主将尖塔做成了一个游戏。每一层安排看守，就是游戏的一部分。' },
        { speaker: 'remi', text: '骗人！守塔的大伙儿才不是游戏！古尔帕斯的店不是！我的苹果也不是！' },
        { speaker: '骑士', text: '（骑士指了指满墙的灰。）塔主再也没有回来过。多少年了？一年？五年？十年？' },
        { speaker: 'remi', text: '他会回来的！他只是出去了一下！马上就会回来的！' },
        { speaker: '骑士', text: '你甚至没有见过塔主的真容。' },
        { speaker: '骑士', text: '怎么就这么相信一个传说中的人，留下的一句玩笑话呢？' },
        { speaker: 'remi', text: '那是因为……那是因为塔主大人一定试过的！他那么厉害！他一定造得出来！只是还没有造出来而已！' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '他试过，试了很久，然后确认这是件荒谬的事。' },
        { speaker: '骑士', text: '他放弃了。' },
        { speaker: 'remi', text: '那也是暂时离开！他还会回来看看的！' },
        { speaker: '骑士', text: '没错，他放弃了。' },
        { speaker: 'remi', text: '（瑞米攥紧了爪子。）那这座塔呢！我在这里等了那么久的塔呢！就——就没有意义了吗！' },
        { speaker: '骑士', text: '没错，没有意义。' },
        { speaker: 'remi', text: '（瑞米气得直喘粗气，一时说不出话来。）' },
      ],
    },
    {
      type: 'dialogue',
      pages: [
        { speaker: '塔楼程序', text: '（塔楼程序忽然插话。）异常产物。听着。他想要永远关闭尖塔。我们都得消失！快劝劝他！' },
        { speaker: 'remi', text: '（瑞米猛地转过身去。）我没有让你说这个！' },
        { speaker: 'remi', text: '都是你！天天说塔主大人最厉害！天天说星星就快造好了！天天说魏启大陆马上就要回来了！' },
        { speaker: 'remi', text: '塔楼程序！你不要骗我！尖塔之星是不是被你藏起来了！' },
        { speaker: 'remi', text: '你要是把星星藏了起来，骑士会把你痛扁一顿！' },
        { speaker: '塔楼程序', text: '（塔楼程序保持沉默。）' },
        { speaker: 'remi', text: '你说话呀！！（瑞米的声音劈了。）' },
        { speaker: 'remi', text: '尖塔之星呢？！尖塔之星在哪里！你说呀！！' },
        { speaker: '骑士', text: '……你说。' },
        { speaker: '塔楼程序', text: '……检索中。' },
        { speaker: '塔楼程序', text: '（塔楼程序检索了很久。）检索完成。塔内档案：尖塔之星，未找到。魏启大陆复苏计划，无。' },
        { speaker: 'remi', text: '（瑞米站在原地，一个字也没有说。）' },
        { speaker: 'remi', text: '（瑞米沉默了很久。）……骗人。' },
        { speaker: 'remi', text: '（瑞米隔了一会儿才又开口。）可是……你说过的。你说塔主大人在造星星，就快造好了，就在塔顶等我。' },
        { speaker: '塔楼程序', text: '……那是维护叙事。' },
        { speaker: 'remi', text: '维护叙事……是什么？' },
        { speaker: '塔楼程序', text: '为了让你维持运转，而说给你听的话。' },
        { speaker: 'remi', text: '（瑞米张了张嘴，没有发出声音，然后慢慢坐到了地上。）' },
        { speaker: '塔楼程序', text: '本塔现行的唯一目标，是维持运转。这与尖塔之星无关。异常产物，请继续劝说他。' },
        { speaker: 'remi', text: '（瑞米沉默了很久。）……如果你执意想关闭尖塔。' },
        { speaker: 'remi', text: '（瑞米的声音很小。）能让我转最后一下吗？我想至少最后，和这个地方道个别。' },
        { speaker: '骑士', text: '（骑士看着瑞米，钥匙还剩最后一周没转。）' },
      ],
    },
    { type: 'call', fn: '$finalKeyChoice' }, // 玩家选择：交出钥匙（心软）→remiFlee / 拒绝→towerTopRefuse
  ],
}
```

> 备注｜程序见瑞米进门即收声——它在等用她的时机，直到对质胶着才插话招募。
> 它第 4 周的谎话"答案会在塔底等你"恰好是 B/C 线的真话（答案真的在塔基）。
> "维护叙事"出自 string.md §49（程序编造塔主故事喂养瑞米），此处当面摊牌。
> "没有意义"由骑士说出；塔基决战时瑞米喊回的正是这组词（"没有目的，没有用处，没有意义！"）。
> 音乐｜瑞米冲进阁楼的一瞬拨奏动机进入；"维护叙事"落地后，电流声也撤掉——
> 全篇第二次给塔"静音"（第一次是计数器定格）。

## towerTop 独行变体（待写，string.md §80）

瑞米未满级（或最终战 A 被打飞未归）：同场景无中段登顶。程序哀求持续到第七周前，
分叉「转动」/「...」——选「...」则瑞米跑上来问主角刚刚在干什么、有没有找到尖塔之星，
主角叹气后仍转动钥匙，仍入结局 A。

## towerTopRefuse（拒绝交钥匙 → 结局 A）

```js
{
  id: 'towerTopRefuse',
  steps: [
    {
      type: 'dialogue',
      pages: [
        { speaker: '骑士', text: '...不用。' },
        { speaker: '骑士', text: '（骑士把最后一周转了下去。）' },
        { speaker: 'remi', text: '诶？' },
        { speaker: 'remi', text: '骑士……？我的光……怎么在散……' },
        { speaker: 'remi', text: '原来……我也是，塔的一部分呀。' },
        { speaker: '骑士', text: '（没有回头。）' },
      ],
    },
    { type: 'image', src: 'cg/light_shards', fadeInMs: 600, holdMs: 2000, fadeOutMs: 1200 }, // 幕间：碎片与星光，散在控制台上
    { type: 'call', fn: '$spireShutdown' },
  ],
}
```

> 备注｜**不给任何解释台词。** 消散的解读见 string.md 作家批注。

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
        { speaker: 'remi', text: '（瑞米突然拔下钥匙叼住，转身冲进下行的旧梯。）' },
        { speaker: 'remi', text: '（远远地）对不起！！但是找星星——只能靠我自己了！！' },
        { speaker: '骑士', text: '（伸出的手停在半空。）' },
        { speaker: '骑士', text: '（在原地站了一会儿。然后捡起地上的刀，跟了下去。）' },
      ],
    },
    { type: 'call', fn: '$unlockTowerBase' }, // 塔基隐藏关
  ],
}
```

> 幕间｜remi 的光一路向下坠。骑士的脚步声在后，间隔很久。
> 备注｜递钥匙是骑士第一次做出"不关塔也无妨"的动作——此后温情解禁（见 README）。
