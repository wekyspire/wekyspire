<script setup>
// 调试面板（仅调试用，dev 工具）：把 run 当成一张可随意拨弄的表——层数/资源/卡组/遗物/灵脉/
// 房间/战斗，全部一击即改，改完立刻在真实前后端链路上看到结果。
//
// 分工（别把逻辑写进这里）：
//   · 写：一律经 `ctrl.debug.*`（shell/runDebug.js → core/debug/*.js）——它负责 core 守卫
//     与"改完之后前端怎么刷新"（状态栏/面板/换台/进房演出）
//   · 读：直读 `ctrl.run`（Vue reactive，自动跟随）与各注册表；**不走 panelSnapshot**
//     （那是玩法 UI 的数据下行通道，调试面板没资格插进去）
//
// 面板 z 压过幕间内容层与切幕黑幕：幕间卡住/黑屏时还能点「跳过幕间」「重载局面」——
// 这正是这个工具存在的意义（不然调试卡幕间只能刷新页面）。
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { allSkills, getSkillDefinition } from '../../core/skills/registry.js';
import { allRelics, getRelicDefinition } from '../../core/relics/registry.js';
import { allEffects, getEffectDefinition } from '../../core/effects/registry.js';
import { LEINO_DIMENSIONS } from '../../core/run/ascension.js';
import { gatedPromotionTargets } from '../../core/run/promotion.js';
import { DIM_META } from '../../stage/panels/shared.js';
import { snapshotRun, modeOf } from '../saves.js';

const props = defineProps({ ctrl: { type: Object, required: true } });
const emit = defineEmits(['close', 'restart']);

const run = computed(() => props.ctrl.run);
const dbg = props.ctrl.debug;
const tab = ref('state');
const importText = ref('');
const exportText = ref('');
const pick = ref({ card: '', relic: '', effect: 'burn', battleCard: '', pack: '' });

const TABS = [
  ['state', '状态'], ['deck', '卡组'], ['relics', '遗物'],
  ['flow', '流程'], ['battle', '战斗'], ['save', '存档'],
];

// ---- 内容清单（一次算好；注册表是静态的）----
const TIER_ORDER = ['D', 'C', 'B', 'A', 'S', 'Z'];
const cardsByTier = computed(() => {
  const out = {};
  for (const def of allSkills()) {
    const t = def.tier ?? '?';
    (out[t] ??= []).push(def);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
});
const tiersPresent = computed(() => TIER_ORDER.filter(t => cardsByTier.value[t]?.length));
const relicsByRarity = computed(() => {
  const out = {};
  for (const def of allRelics()) (out[def.rarity ?? 'C'] ??= []).push(def);
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
});
const raritiesPresent = computed(() => ['C', 'B', 'A', 'S'].filter(r => relicsByRarity.value[r]?.length));
const effectDefs = computed(() => allEffects().slice().sort((a, b) => String(a.name).localeCompare(String(b.name))));

// ---- 读侧小工具 ----
const p = computed(() => run.value.player);
const nameOfCard = (defId) => getSkillDefinition(defId)?.name ?? defId;
const tierOfCard = (defId) => getSkillDefinition(defId)?.tier ?? '?';
const nameOfRelic = (id) => getRelicDefinition(id)?.name ?? id;
const rarityOfRelic = (id) => getRelicDefinition(id)?.rarity ?? 'C';
const promoteTargetOf = (rt) => gatedPromotionTargets(run.value, getSkillDefinition(rt.defId))[0] ?? null;
const invulnerable = computed(() => p.value.getEffectStacks('invulnerable') > 0);
const effectsOnPlayer = computed(() => (p.value.effects ?? [])
  .map(e => ({ ...e, def: getEffectDefinition(e.effectId) })));
// 战斗内的数值/血条由 bridge 投影驱动（不是 Vue 响应式）——面板里给一个心跳重算，
// 免得看着旧数字做判断（500ms 足够，调试面板不追求丝滑）
const tick = ref(0);
let tickTimer = null;
onMounted(() => { tickTimer = setInterval(() => { tick.value++; }, 500); });
onBeforeUnmount(() => { if (tickTimer) clearInterval(tickTimer); });
const enemies = computed(() => {
  tick.value;
  return run.value.gameStage === 'battle' ? dbg.enemyViews() : [];
});

// ---- 写侧：全部经门面 ----
const setNum = (field, e) => dbg.setField(field, Number(e.target.value));
const bump = (field, delta) => dbg.setField(field, Number(p.value[field] ?? 0) + delta);
const bumpBase = (field, delta) => dbg.setField(field, Number(p.value.baseStats?.[field] ?? 0) + delta);
const bumpLeino = (dim, delta) => dbg.setLeino(dim, Number(p.value.leino?.[dim] ?? 0) + delta);
const jumpFloor = (delta) => dbg.setFloor(Number(run.value.floor) + delta);
const jumpToFloor = (e) => dbg.setFloor(Number(e.target.value));

function addPickedCard() {
  if (pick.value.card) dbg.addCard(pick.value.card);
}
function addPickedRelic() {
  if (pick.value.relic) dbg.addRelic(pick.value.relic);
}
function addPickedBattleCard() {
  if (pick.value.battleCard) dbg.addCardToHand(pick.value.battleCard);
}
function addAllRelics() {
  for (const def of allRelics()) {
    if (!p.value.relics.includes(def.id)) dbg.addRelic(def.id);
  }
}
function startPickedReward() {
  dbg.startReward(pick.value.pack ? { packId: pick.value.pack } : {});
}
function doExport() {
  exportText.value = JSON.stringify(snapshotRun(run.value), null, 1);
}
function copyExport() {
  doExport();
  navigator.clipboard?.writeText(exportText.value);
}
function importRestart() {
  let save = null;
  try { save = JSON.parse(importText.value); } catch { dbg.note('导入失败：不是合法 JSON'); return; }
  if (!save?.player?.deck) { dbg.note('导入失败：这不像一份存档（缺 player.deck）'); return; }
  emit('restart', { loadSave: save });
}
function reloadCurrent() {
  emit('restart', { loadSave: snapshotRun(run.value) });
}
</script>

<template>
  <div class="dbg">
    <div class="head">
      <span class="title">调试模式</span>
      <span class="tag" :class="{ live: dbg.session }">{{ dbg.session ? '调试局 · debug 槽' : '普通局（改一下就转调试局）' }}</span>
      <button class="x" @click="emit('close')">收起 (F9)</button>
    </div>

    <div class="tabs">
      <button v-for="[id, label] in TABS" :key="id" :class="{ on: tab === id }" @click="tab = id">{{ label }}</button>
    </div>

    <div class="body">
      <!-- ================= 状态 ================= -->
      <div v-if="tab === 'state'" class="pane">
        <div class="row">
          <span class="k">阶段</span>
          <span class="v">{{ run.gameStage }}<template v-if="run.currentRoom"> · {{ run.currentRoom }}</template></span>
        </div>
        <div class="row">
          <span class="k">层数</span>
          <button @click="jumpFloor(-1)">-1</button>
          <input class="num" type="number" :value="run.floor" @change="jumpToFloor">
          <span class="v">/ {{ run.totalFloors }}</span>
          <button @click="jumpFloor(1)">+1</button>
          <button @click="dbg.nextFloor()">下一层</button>
          <button @click="dbg.reloadFloor()">重开本层</button>
        </div>

        <div class="grid">
          <label>生命 <input class="num" type="number" :value="p.hp" @change="setNum('hp', $event)"></label>
          <label>上限 <input class="num" type="number" :value="p.maxHp" @change="setNum('maxHp', $event)"></label>
          <label>魏启 <input class="num" type="number" :value="p.mana" @change="setNum('mana', $event)"></label>
          <label>魏启上限 <input class="num" type="number" :value="p.maxMana" @change="setNum('maxMana', $event)"></label>
          <label>行动力 <input class="num" type="number" :value="p.actionPoints" @change="setNum('actionPoints', $event)"></label>
          <label>AP 上限 <input class="num" type="number" :value="p.maxActionPoints" @change="setNum('maxActionPoints', $event)"></label>
          <label>金币 <input class="num" type="number" :value="p.money" @change="setNum('money', $event)"></label>
          <label>手牌上限 <input class="num" type="number" :value="p.maxHandSize" @change="setNum('maxHandSize', $event)"></label>
          <label>训练次数 <input class="num" type="number" :value="p.trainingCount" @change="setNum('trainingCount', $event)"></label>
          <label>进阶次数 <input class="num" type="number" :value="p.ascensionCount" @change="setNum('ascensionCount', $event)"></label>
          <label>体修等级 <input class="num" type="number" :value="p.bodyLevel" @change="setNum('bodyLevel', $event)"></label>
          <label>遗物槽 <input class="num" type="number" :value="p.relicSlots" @change="setNum('relicSlots', $event)"></label>
        </div>

        <div class="row quick">
          <span class="k">快捷</span>
          <button @click="bumpBase('maxHp', 50)">上限 +50</button>
          <button @click="bumpBase('maxHp', -50)">上限 -50</button>
          <button @click="bump('money', 100)">金币 +100</button>
          <button @click="dbg.setField('mana', p.maxMana)">魏启回满</button>
        </div>

        <div class="row">
          <span class="k">灵脉</span>
          <template v-for="dim in LEINO_DIMENSIONS" :key="dim">
            <span class="dim" :style="{ color: DIM_META[dim]?.color }">{{ DIM_META[dim]?.label ?? dim }}</span>
            <button @click="bumpLeino(dim, -1)">-</button>
            <span class="v">{{ p.leino?.[dim] ?? 0 }}</span>
            <button @click="bumpLeino(dim, 1)">+</button>
          </template>
        </div>

        <div class="row">
          <span class="k">无敌</span>
          <label class="cbx"><input type="checkbox" :checked="invulnerable" @change="dbg.setInvulnerable($event.target.checked)"> 生命不降到 1 以下</label>
          <button @click="dbg.clearDebuffs()">清负面</button>
        </div>
        <div class="row">
          <span class="k">玩家效果</span>
          <span class="v">{{ effectsOnPlayer.map(e => `${e.def?.name ?? e.effectId}${e.stacks > 1 ? '×' + e.stacks : ''}`).join('、') || '（无）' }}</span>
        </div>
      </div>

      <!-- ================= 卡组 ================= -->
      <div v-else-if="tab === 'deck'" class="pane">
        <div class="row">
          <span class="k">共 {{ p.deck.length }} 张</span>
          <select v-model="pick.card">
            <option value="">（选一张卡加入）</option>
            <template v-for="t in tiersPresent" :key="t">
              <optgroup :label="`${t} 级`">
                <option v-for="def in cardsByTier[t]" :key="def.id" :value="def.id">{{ def.name }}（{{ def.id }}）</option>
              </optgroup>
            </template>
          </select>
          <button class="pri" @click="addPickedCard()">加入</button>
          <button @click="dbg.addCard('onePunch')">发一拳</button>
          <button @click="dbg.resetDeck()">重置牌组</button>
        </div>
        <div class="list">
          <div v-for="(rt, i) in p.deck" :key="rt.uniqueID" class="item">
            <span class="idx">{{ i + 1 }}</span>
            <span class="nm">{{ nameOfCard(rt.defId) }}</span>
            <span class="dim-tag">{{ tierOfCard(rt.defId) }}</span>
            <span class="sub">{{ promoteTargetOf(rt) ? '→ ' + nameOfCard(promoteTargetOf(rt)) : '（无晋升）' }}</span>
            <button @click="dbg.promoteCard(rt.uniqueID)">升级</button>
            <button class="del" @click="dbg.removeCard(rt.uniqueID)">删除</button>
          </div>
        </div>
      </div>

      <!-- ================= 遗物 ================= -->
      <div v-else-if="tab === 'relics'" class="pane">
        <div class="row">
          <span class="k">共 {{ p.relics.length }} 件</span>
          <select v-model="pick.relic">
            <option value="">（选一件遗物加入）</option>
            <template v-for="r in raritiesPresent" :key="r">
              <optgroup :label="`${r} 级`">
                <option v-for="def in relicsByRarity[r]" :key="def.id" :value="def.id">{{ def.name }}（{{ def.id }}）</option>
              </optgroup>
            </template>
          </select>
          <button class="pri" @click="addPickedRelic()">加入</button>
          <button @click="addAllRelics()">一键全遗物</button>
        </div>
        <div class="row quick">
          <span class="k">随机</span>
          <button v-for="r in ['C', 'B', 'A', 'S']" :key="r" @click="dbg.addRandomRelic(r)">发 {{ r }} 级</button>
        </div>
        <div class="list">
          <div v-for="id in p.relics" :key="id" class="item">
            <span class="nm">{{ nameOfRelic(id) }}</span>
            <span class="dim-tag">{{ rarityOfRelic(id) }}</span>
            <span class="sub">{{ id }}</span>
            <span v-if="p.equippedRelics.includes(id)" class="on-tag">已装备</span>
            <button v-else @click="dbg.equip(id)">装备</button>
            <button v-if="p.equippedRelics.includes(id)" @click="dbg.unequip(id)">卸下</button>
            <button class="del" @click="dbg.removeRelic(id)">移除</button>
          </div>
        </div>
      </div>

      <!-- ================= 流程 ================= -->
      <div v-else-if="tab === 'flow'" class="pane">
        <div class="row">
          <span class="k">进房</span>
          <button @click="dbg.enterRoom('campTraining')">营地·训练场</button>
          <button @click="dbg.enterRoom('slot')">老虎机</button>
          <button @click="dbg.enterRoom('shop')">售货机</button>
          <button @click="dbg.enterRoom('gurpas')">古尔帕斯</button>
          <button @click="dbg.enterRoom('event')">事件房</button>
        </div>
        <div class="row">
          <span class="k">进阶</span>
          <button @click="dbg.triggerAscension()">触发进阶事件</button>
          <button @click="dbg.skipCutscene()">跳过当前幕间</button>
        </div>
        <div class="row">
          <span class="k">奖励</span>
          <select v-model="pick.pack">
            <option value="">（随机开包）</option>
            <option v-for="id in dbg.packIds()" :key="id" :value="id">{{ id }}</option>
          </select>
          <button @click="startPickedReward()">开战后奖励</button>
          <button @click="dbg.addRandomRelic()">发随机遗物</button>
        </div>
        <div class="row">
          <span class="k">战斗</span>
          <button @click="ctrl.startBattle()">开始战斗（本层遭遇）</button>
          <button @click="ctrl.enterRoomPresentation()">重放进房演出</button>
        </div>
        <div class="hint">「进房」走真实路径：换台 + 幕间黑幕 + 房间场景/事件幕间；训练房由此直接跳到现场。</div>
      </div>

      <!-- ================= 战斗 ================= -->
      <div v-else-if="tab === 'battle'" class="pane">
        <div v-if="run.gameStage !== 'battle'" class="hint">当前不在战斗中（先「开始战斗」，或用流程页进房）。</div>
        <template v-else>
          <div class="row quick">
            <span class="k">玩家</span>
            <button @click="dbg.healFull()">回满血</button>
            <button @click="dbg.gainShieldInBattle(50)">护盾 +50</button>
            <button @click="dbg.gainManaInBattle(3)">魏启 +3</button>
            <button @click="dbg.gainApInBattle(3)">AP +3</button>
            <button @click="dbg.drawCards(5)">抽 5 张</button>
          </div>
          <div class="row">
            <span class="k">加卡</span>
            <select v-model="pick.battleCard">
              <option value="">（选一张加到手牌）</option>
              <template v-for="t in tiersPresent" :key="t">
                <optgroup :label="`${t} 级`">
                  <option v-for="def in cardsByTier[t]" :key="def.id" :value="def.id">{{ def.name }}（{{ def.id }}）</option>
                </optgroup>
              </template>
            </select>
            <button class="pri" @click="addPickedBattleCard()">加到手里</button>
            <button @click="dbg.addCardToHand('gmPunch50')">塞调试重拳</button>
            <button @click="dbg.addCardToHand('onePunch')">塞一拳</button>
          </div>
          <div class="row">
            <span class="k">效果</span>
            <select v-model="pick.effect">
              <option v-for="def in effectDefs" :key="def.id" :value="def.id">{{ def.name }}（{{ def.id }}）</option>
            </select>
            <button @click="dbg.addBattleEffect('player', pick.effect, 3)">给自己 ×3</button>
            <button @click="dbg.addBattleEffect('enemy', pick.effect, 3)">给敌人 ×3</button>
          </div>
          <div class="row">
            <span class="k">敌人</span>
            <button class="pri" @click="dbg.killAllEnemies()">秒杀全部</button>
            <button class="del" @click="dbg.hardResetBattle()">硬重置（丢弃本场）</button>
          </div>
          <div class="list">
            <div v-for="e in enemies" :key="e.uniqueID" class="item">
              <span class="nm">#{{ e.index }} {{ e.name }}</span>
              <span class="sub">{{ e.hp }}/{{ e.maxHp }}<template v-if="e.shield"> · 盾 {{ e.shield }}</template></span>
              <button :disabled="e.dead" @click="dbg.killEnemy(e.index)">秒杀</button>
            </div>
          </div>
        </template>
      </div>

      <!-- ================= 存档 ================= -->
      <div v-else class="pane">
        <div class="row"><span class="k">槽位</span><span class="v">{{ modeOf(run) }} ｜ seed {{ run.seed }} ｜ debugMode {{ String(!!run.debugMode) }}</span></div>
        <div class="row">
          <button @click="doExport()">导出当前存档 JSON</button>
          <button @click="copyExport()">复制</button>
          <button class="pri" @click="reloadCurrent()">重载当前局面（重建舞台）</button>
        </div>
        <textarea v-model="exportText" class="ta" placeholder="（导出的存档 JSON 会出现在这里）"></textarea>
        <div class="row">
          <span class="k">导入</span>
          <button class="pri" @click="importRestart()">从下面的 JSON 重开</button>
        </div>
        <textarea v-model="importText" class="ta" placeholder="把存档 JSON 粘到这里（tools/saveForge.mjs 产出 / 面板导出）"></textarea>
        <div class="hint">
          调试局只写 debug 存档槽，真实存档不受影响。<br>
          命令行造档：<code>node tools/saveForge.mjs --out 名字 …</code>；
          直接起跑：<code>?debug=1&amp;save=名字</code>。
        </div>
      </div>
    </div>

    <div class="log">
      <div v-for="m in dbg.messages.slice(0, 4)" :key="m.id" class="line">{{ m.text }}</div>
      <div v-if="!dbg.messages.length" class="line dim">（动作回执会显示在这里）</div>
    </div>
  </div>
</template>

<style scoped>
/* 扁平深底 + 白字 + 淡蓝描边（与全局 UI 风格一致）；z 压过幕间内容层与切幕黑幕 */
.dbg {
  position: fixed; top: 10px; left: 10px; z-index: 120;
  width: 470px; max-height: calc(100% - 20px); display: flex; flex-direction: column;
  background: rgba(8, 11, 18, .94); border: 1px solid #3f5f8c; border-radius: 4px;
  color: #e8eefb; font-family: sans-serif; font-size: 12px;
}
.head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #26324a; }
.title { font-size: 13px; letter-spacing: 1px; }
.tag { font-size: 11px; color: #c3cee0; }
.tag.live { color: #ffd479; }
.x { margin-left: auto; }
.tabs { display: flex; gap: 4px; padding: 6px 8px 0; }
.tabs button { flex: 1; }
.body { overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.pane { display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.row .k { color: #9aa3b8; min-width: 54px; }
.row .v { color: #e8eefb; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.grid label { display: flex; align-items: center; gap: 4px; color: #c3cee0; }
.list { max-height: 40vh; overflow: auto; border: 1px solid #26324a; }
.item { display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-bottom: 1px solid #1b2436; }
.item .idx { color: #6f7a92; width: 20px; }
.item .nm { color: #e8eefb; }
.item .sub { color: #9aa3b8; font-size: 11px; }
.item .dim-tag { color: #8fb6dd; }
.item .on-tag { color: #7fd18b; }
.item button { margin-left: 4px; }
.item button:first-of-type { margin-left: auto; }
button {
  font-family: inherit; font-size: 11px; padding: 2px 7px; cursor: pointer;
  background: rgba(16, 22, 34, .95); color: #eaf1fb; border: 1px solid #3f5f8c; border-radius: 3px;
}
button:hover { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
button.on { background: rgba(52, 84, 126, .95); border-color: #8fb6dd; }
button.pri { border-color: #6f9fd0; color: #ffffff; }
button.del { border-color: #8c4a4a; }
button:disabled { opacity: .4; cursor: default; }
input.num { width: 58px; }
input, select, textarea {
  font-family: inherit; font-size: 11px; background: #121a28; color: #eaf1fb;
  border: 1px solid #33445f; border-radius: 3px; padding: 2px 4px;
}
select { max-width: 190px; }
.cbx { display: flex; align-items: center; gap: 4px; color: #c3cee0; }
.dim { color: #8a93b2; }
.dim-tag { font-size: 11px; }
.ta { width: 100%; height: 90px; resize: vertical; font-family: monospace; font-size: 10px; }
.hint { color: #8a93b2; font-size: 11px; line-height: 1.5; }
.hint code { color: #c3cee0; }
.log { border-top: 1px solid #26324a; padding: 5px 8px; font-size: 11px; color: #c3cee0; }
.log .line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
