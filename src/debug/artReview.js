// 美术审核页主逻辑：卡面走真实 bakeCardFace 渲染（费用/名称/富文本/美术裁切渐隐全真），
// 立牌走战场底色 + UNIT_HEIGHT_FACTOR 游戏高度比例。仅供人工审核，不进任何游戏链路。
import '../core/content/index.js';
import { allSkills } from '../core/skills/registry.js';
import { ART_KEY_OVERRIDES } from '../core/skills/artKeys.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { bakeCardFace } from '../stage/richtext/cardFace.js';
import { sharedCardArtCache } from '../stage/art/cardArtCache.js';
import { allEnemies } from '../core/enemies/registry.js';
import { unitHeightFactor, sharedUnitArtCache } from '../stage/art/unitArt.js';

// —— 本批变更清单（与 git status 对账维护）——
const NEW_KEYS = ['blackBomb','bloodFlame','blueBomb','burnOff','distort','evilHex','fireControlDetonate','fireControlFinderAcroC','fireControlFinderAtkC','fireControlFinderGuardC','fireControlGather','fireControlHarvest','fireControlShift','fireControlSpread','fireWhirlS','forget','giantFireball','greatSweep','heavenFireball','homecoming','hush','impulse','malice','painCurse','pourOil','redBomb','redCloud','reminiscence','selfImmolateRite','sparkStormS','stackFirewood','stealTime','transcend','turbo','vacuumBlade','vacuumBladeS','whiteBomb'];
const MOD_KEYS = ['berserkStance','bladeArt','burnWound','burstStimulant','cleave','counterDraw','cycloneSlash','defensePrep','doubleStrike','drawQi','duckHead','edgeBreath','elbowReturn','elbowStrike','endure','expand','fineDagger','fireMastery','flyingDagger','fullCharge','fullStimulant','graceDance','handCleave','heatWave','helicopter','highFever','holdOut','honeBlade','inkBlot','instantCooldown','instantThousand','manaJarRoyal','martialStance','nirvana','novice','perfectCleave','perfectDagger','powerStance','prepareMove','quickDrawShield','rapidFire','redHotBlade','shatterHit','shock','silverDance','smeltCard','stimulant','storeEdge','swiftManaJar','swiftManaJarPlus','warmUp','wildPunch'];
// 返工2 批次（第二轮全量反馈的不合格重设计/重抽 + endure 换图 + 少量改进尝试）
const R2_KEYS = ['berserkStance','blackBomb','bladeArt','breath','burnSnap','burnWound','edgeBreath','endure','expand','fistPress','fineDagger','fireBolt','fireControlDetonate','fireControlFinderAtkC','fireControlShift','fireControlSupreme','fullCharge','greaterFireBall','greatSweep','giantFireball','handCleave','heatSurge','helicopter','highFever','instantCooldown','novice','perfectCleave','pluckStar','prepareMove','rapidFire','relief','residualHeatPlus','returningDagger','shock','shockCard','snakeFist','spark','sparkStormS','stealTime','wildFlurry'];
const PROC_KEYS = ['cleave'];
const NEW_UNITS = ['kardas','mefm1','pangolinKing','corruptSource','rottenRoot','rottenTreeHeart','youngRakshasa','bigSlime','knightCommander','courtSquire','candleWarden','bishopMarchand'];

const TIER_ART_INDEX = { D: 0, C: 1, B: 2, A: 3, S: 4 };
const grid = document.getElementById('grid');
const errBox = document.getElementById('err');
const countBox = document.getElementById('count');
const lightbox = document.getElementById('lightbox');
lightbox.addEventListener('click', () => lightbox.style.display = 'none');
function zoom(src) { lightbox.querySelector('img').src = src; lightbox.style.display = 'grid'; }

function resolveKey(def) {
  return ART_KEY_OVERRIDES[def.id] ?? def.image ?? def.series ?? `${def.type}-${TIER_ART_INDEX[def.tier] ?? '?'}`;
}

// —— 卡面：按美术键分组，每键取链内最低阶代表卡 → cardView → bakeCardFace ——
function buildCardEntries() {
  const byKey = new Map();
  const order = { D: 0, C: 1, B: 2, A: 3, S: 4 };
  for (const def of allSkills()) {
    if (def.id === 'onePunch' || def.id === 'gmPunch50') continue; // GM 卡无卡面
    const key = resolveKey(def);
    const cur = byKey.get(key);
    if (!cur || (order[def.tier] ?? 9) < (order[cur.tier] ?? 9)) byKey.set(key, def);
  }
  return [...byKey.entries()].map(([key, def]) => {
    const view = cardViewFromDef(def, {});
    const artUrl = sharedCardArtCache.resolveUrl(view);
    return { key, def, view, artUrl, tag: R2_KEYS.includes(key) ? 'r2' : NEW_KEYS.includes(key) ? 'new' : MOD_KEYS.includes(key) ? 'mod' : null };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function loadImg(url) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

async function renderCards(filter, search) {
  grid.innerHTML = '';
  const entries = buildCardEntries().filter(e => {
    if (filter === 'new' && e.tag !== 'new') return false;
    if (filter === 'mod' && e.tag !== 'mod') return false;
    if (filter === 'r2' && e.tag !== 'r2') return false;
    if (filter === 'proc' && !PROC_KEYS.includes(e.key)) return false;
    if (search && !e.key.toLowerCase().includes(search)) return false;
    return true;
  });
  countBox.textContent = `${entries.length} 键`;
  // 先建格子，美术并行加载后统一烘焙（逐格 await 会串行拖慢首屏）
  const tasks = [];
  for (const e of entries) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `<div class="head"><span class="key">${e.key}</span>${
      e.tag === 'r2' ? '<span class="badge b-r2">返工2</span>' : e.tag === 'new' ? '<span class="badge b-new">新增</span>' : e.tag === 'mod' ? '<span class="badge b-mod">重做</span>' : ''}${
      PROC_KEYS.includes(e.key) ? '<span class="badge b-proc">程序化</span>' : ''}<span class="b-art">${e.def.name}</span></div>`;
    cell.querySelector('.head').appendChild(copyBtn(`${e.key} ${e.def.name} (${e.def.id})`));
    const raw = document.createElement('img');
    raw.className = 'raw';
    if (e.artUrl) { raw.src = e.artUrl; raw.addEventListener('click', () => zoom(e.artUrl)); }
    else raw.replaceWith(Object.assign(document.createElement('div'), { className: 'raw', textContent: '（无美术占位）',
      style: 'display:grid;place-items:center;color:#54617c;font:11px monospace' }));
    cell.appendChild(raw);
    const face = document.createElement('img');
    face.className = 'face';
    cell.appendChild(face);
    grid.appendChild(cell);
    // 真渲染：bakeCardFace（art/decor 就绪后）
    const bake = (art, decor) => {
      const { canvas } = bakeCardFace(e.view, { scale: 1.5, art, decor });
      face.src = canvas.toDataURL('image/png');
      face.onclick = () => zoom(face.src);
    };
    if (!e.artUrl) { bake(null, null); continue; }
    tasks.push((async () => {
      const [art, decor] = await Promise.all([loadImg(e.artUrl), loadImg(sharedCardArtCache.resolveDecorUrl(e.view) ?? '')]);
      if (art) bake(art, decor); else { errBox.textContent += `美术加载失败: ${e.key} `; bake(null, null); }
    })());
  }
  await Promise.all(tasks);
}

// —— 立牌：战场底色 + 游戏高度比例（unitHeightFactor × 基准）；url 走 sharedUnitArtCache
// 的解析（与游戏加载同口径——审核所见即玩家所得）——
function unitUrlFor(defId) {
  return sharedUnitArtCache.resolveUrl(defId, 'enemy') ?? sharedUnitArtCache.resolveUrl(defId, 'player');
}
function renderUnits(mode, bg) {
  grid.innerHTML = '';
  grid.className = '';
  grid.id = 'stage-bg-' + bg;
  const seen = new Set();
  const defs = allEnemies().filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => {
    const na = NEW_UNITS.includes(a.id) ? 0 : 1, nb = NEW_UNITS.includes(b.id) ? 0 : 1;
    return na - nb || a.id.localeCompare(b.id);
  });
  countBox.textContent = `${defs.length} 立牌`;
  const BASE_H = mode === 'game' ? 240 : 320; // 游戏比例模式：factor=1 ≈ 240px；等高模式全 320
  for (const def of defs) {
    const defId = def.id;
    const url = unitUrlFor(defId);
    if (!url) continue;
    const cell = document.createElement('div');
    cell.className = 'ucell';
    const img = document.createElement('img');
    img.src = url;
    img.style.height = mode === 'game' ? `${Math.round(unitHeightFactor(defId, 'enemy') * BASE_H)}px` : '320px';
    img.addEventListener('click', () => zoom(url));
    cell.appendChild(img);
    const meta = document.createElement('div');
    meta.innerHTML = `<div class="key">${defId}${NEW_UNITS.includes(defId) ? ' <span class="badge b-new">新</span>' : ''} ${def.name ?? ''}</div><div class="fac">h=${unitHeightFactor(defId, 'enemy')}</div>`;
    meta.style.textAlign = 'center';
    cell.appendChild(meta);
    meta.querySelector('.key').appendChild(copyBtn(`${defId} ${def.name ?? ''}`));
    grid.appendChild(cell);
  }
}

// 一键复制「键名 卡名」（代表卡 id 附后，写反馈直接引用）
function copyBtn(text) {
  const b = document.createElement('button');
  b.className = 'copy'; b.textContent = '⧉'; b.title = `复制：${text}`;
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      b.textContent = '✓'; b.classList.add('done');
      setTimeout(() => { b.textContent = '⧉'; b.classList.remove('done'); }, 900);
    });
  });
  return b;
}

// —— 本批候选（返工批 39 + 拆名批 49，各 2 抽）：三选一点选 + 一键导出 ——
const SPLIT_KEYS = ['rapidCombo','stormCombo','bronzeCity','berserkMastery','pierceHeart','comboStrike','quadrupleHit','powerCleave','riftCleave','guardStance','mysticTurtle','squeezeQi','perfectBlock','fierceElbow','strongElbow','pureElbow','deepExtract','limitExtract','collapseFistS','fireBall','fireStream','smallBurst','karadiaBurst','firstArrow','firstFireBall','fullSpirit','veilCleave','heatBallPlus','heatBallMaster','whirlLeg','whiteFever','hunYuanS','taijiS','heavenStance','meltCollapse','leopardFist','tigerFist','peerlessS','greaterPsiShield','deepPurify','peakPurify','goldHotBlade','whiteHotBlade','shatterHead','doomBlast','concealEdge','rainFist','thousandHands','myriadHands'];
// 第三轮后待审清单（47 键）：修复批 26（重设计/i2i/重抽）+ 保留现行待家族对齐 19 + 精通/大火球（家族/fail 记录）2。
// 已部署且无遗留问题的键已移除。
const CAND_BATCH = [
  // 第六轮迭代 5 键（白炽/金热/白热已程序化改色直发；其余通过键已移除）
  'fireBall', 'smallBurst', 'karadiaBurst', 'leverage', 'martialStance',
];
const CAND_TITLES = { r2: '返工2', split: '拆名' };
function candBatchOf(key) { return SPLIT_KEYS.includes(key) ? 'split' : 'r2'; }
const SEL = JSON.parse(localStorage.getItem('artCandSel') || '{}'); // key -> '0'|'1'|'keep'|'none'
const saveSel = () => localStorage.setItem('artCandSel', JSON.stringify(SEL));

// 键 -> 消费卡清单（中文名 + 等阶 + id，防键-卡漂移）
function cardsByKey() {
  const m = new Map();
  for (const def of allSkills()) {
    if (!def?.id || def.id === 'onePunch' || def.id === 'gmPunch50') continue;
    const key = resolveKey(def);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(def);
  }
  return m;
}

let candFilter = 'all';
async function renderCands() {
  grid.innerHTML = '';
  const byKey = cardsByKey();
  const byEntry = new Map(buildCardEntries().map(e => [e.key, e]));
  const keys = CAND_BATCH.filter(k => {
    if (candFilter !== 'all' && candBatchOf(k) !== candFilter) return false;
    if (search && !k.toLowerCase().includes(search)) return false;
    return true;
  });
  countBox.textContent = `${keys.length} 键（已选 ${keys.filter(k => SEL[k]).length}）`;
  for (const key of keys) {
    const cards = byKey.get(key) ?? [];
    const names = [...new Set(cards.map(c => c.name))].join('/');
    const tierStr = cards.map(c => c.tier).join('');
    const idStr = cards.map(c => c.id).join(', ');
    const e = byEntry.get(key);
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.width = '360px';
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `<span class="key">${key}</span><span class="badge ${candBatchOf(key) === 'split' ? 'b-split' : 'b-r2'}">${CAND_TITLES[candBatchOf(key)]}</span>` +
      (cards.length ? `<span class="b-art" title="${idStr}">${names} ${tierStr} · ${idStr}</span>` : `<span class="b-art" style="color:#ff8890">无对应卡！</span>`);
    head.appendChild(copyBtn(`${key} ${names}`));
    cell.appendChild(head);
    const row = document.createElement('div');
    row.className = 'opt-row';
    cell.appendChild(row);
    grid.appendChild(cell);

    const opt = (value, label, node) => {
      const wrap = document.createElement('div');
      wrap.className = 'opt' + (SEL[key] === value ? ' sel' : '');
      wrap.appendChild(node);
      const cap = document.createElement('div');
      cap.className = 'opt-cap'; cap.textContent = label;
      wrap.appendChild(cap);
      wrap.addEventListener('click', ev => {
        if (ev.target.closest('.copy')) return;
        SEL[key] = SEL[key] === value ? undefined : value;
        if (!SEL[key]) delete SEL[key];
        saveSel();
        wrap.parentElement.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
        if (SEL[key]) wrap.classList.add('sel');
        countBox.textContent = `${keys.length} 键（已选 ${keys.filter(k => SEL[k]).length}）`;
      });
      row.appendChild(wrap);
      return wrap;
    };
    // 候选 0 / 1
    for (const idx of [0, 1]) {
      const img = document.createElement('img');
      img.className = 'raw';
      (async () => {
        const list = await (await fetch(`/art_src/cards_scenes/${key}/list.json`).catch(() => null))?.json().catch(() => null);
        const name = list?.find(n => n.startsWith(`cand_${idx}_`));
        if (name) {
          img.src = `/art_src/cards_scenes/${key}/${name}`;
          img.addEventListener('dblclick', ev => { ev.stopPropagation(); zoom(img.src); });
        } else img.replaceWith(Object.assign(document.createElement('div'), { className: 'raw', textContent: `候选${idx}缺`, style: 'display:grid;place-items:center;color:#54617c;font:11px monospace' }));
      })();
      opt(String(idx), `候选${idx}`, img);
    }
    // 第三选项：有现行图 = 保留现行；无 = 都不行
    if (e?.artUrl) {
      const cur = document.createElement('img');
      cur.className = 'raw'; cur.src = e.artUrl;
      cur.addEventListener('dblclick', ev => { ev.stopPropagation(); zoom(e.artUrl); });
      opt('keep', '保留现行', cur);
    } else {
      const none = document.createElement('div');
      none.className = 'raw';
      none.style.cssText = 'display:grid;place-items:center;color:#54617c;font:11px monospace';
      none.textContent = '都不行';
      opt('none', '都不行', none);
    }
  }
}

// —— 同名统一（同名必同图，等阶变体不算数）：逐组点选一键 ——
const NAMESEL = JSON.parse(localStorage.getItem('artNameSel') || '{}'); // 名字 -> 文件键
const saveNameSel = () => localStorage.setItem('artNameSel', JSON.stringify(NAMESEL));

function nameGroups() {
  const byName = new Map();
  for (const def of allSkills()) {
    if (!def?.id || def.id === 'onePunch' || def.id === 'gmPunch50') continue;
    const view = cardViewFromDef(def, {});
    const url = sharedCardArtCache.resolveUrl(view);
    const file = url ? url.split('/').pop().replace(/\.(png|webp|jpe?g)$/, '') : null;
    if (!file) continue;
    if (!byName.has(def.name)) byName.set(def.name, []);
    byName.get(def.name).push({ def, file });
  }
  return [...byName].filter(([, cards]) => new Set(cards.map(c => c.file)).size > 1).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
}

function renderNames() {
  grid.innerHTML = '';
  const groups = nameGroups();
  countBox.textContent = `${groups.length} 组（已选 ${groups.filter(([n]) => NAMESEL[n]).length}）`;
  for (const [name, cards] of groups) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.width = '360px';
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `<span class="key">${name}</span><span class="badge b-split">同名异图</span><span class="b-art">${cards.map(c => `${c.def.tier}`).join('')}</span>`;
    head.appendChild(copyBtn(`${name}（${[...new Set(cards.map(c => c.def.id))].join(',')}）`));
    cell.appendChild(head);
    const row = document.createElement('div');
    row.className = 'opt-row';
    cell.appendChild(row);
    grid.appendChild(cell);
    const byFile = new Map();
    for (const c of cards) {
      if (!byFile.has(c.file)) byFile.set(c.file, []);
      byFile.get(c.file).push(c);
    }
    for (const [file, members] of byFile) {
      const wrap = document.createElement('div');
      wrap.className = 'opt' + (NAMESEL[name] === file ? ' sel' : '');
      const img = document.createElement('img');
      img.className = 'raw';
      const url = sharedCardArtCache.resolveUrl(cardViewFromDef(members[0].def, {}));
      img.src = url;
      img.addEventListener('dblclick', ev => { ev.stopPropagation(); zoom(url); });
      wrap.appendChild(img);
      const cap = document.createElement('div');
      cap.className = 'opt-cap';
      cap.textContent = `${file}（${members.map(m => m.def.tier).join('+')}）`;
      wrap.appendChild(cap);
      wrap.addEventListener('click', () => {
        if (NAMESEL[name] === file) delete NAMESEL[name];
        else NAMESEL[name] = file;
        saveNameSel();
        wrap.parentElement.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
        if (NAMESEL[name]) wrap.classList.add('sel');
        countBox.textContent = `${groups.length} 组（已选 ${document.querySelectorAll('#grid .opt.sel').length}）`;
      });
      row.appendChild(wrap);
    }
  }
}

function exportNameSel() {
  const groups = nameGroups();
  const lines = [], missing = [];
  for (const [name, cards] of groups) {
    const pick = NAMESEL[name];
    if (pick) lines.push(`${name} [${[...new Set(cards.map(c => c.def.id))].join(',')}]: ${pick}`);
    else missing.push(name);
  }
  const out = [];
  if (lines.length) out.push('== 同名统一选择 ==\n' + lines.join('\n'));
  if (missing.length) out.push(`== 未选 ==\n${missing.join(', ')}`);
  return out.join('\n\n') || '（无待选组）';
}
function exportSelection() {
  const byKey = cardsByKey();
  const out = [];
  for (const batch of ['r2', 'split']) {
    const keys = CAND_BATCH.filter(k => candBatchOf(k) === batch);
    const lines = [];
    for (const k of keys) {
      const cards = byKey.get(k) ?? [];
      const names = [...new Set(cards.map(c => c.name))].join('/') || '?';
      const v = SEL[k];
      const mark = v === '0' ? '候选0' : v === '1' ? '候选1' : v === 'keep' ? '保留现行' : v === 'none' ? '都不行' : null;
      if (mark) lines.push(`${k} ${names}: ${mark}`);
    }
    if (lines.length) out.push(`== ${CAND_TITLES[batch]} ==\n` + lines.join('\n'));
  }
  const missing = CAND_BATCH.filter(k => !SEL[k]);
  if (missing.length) out.push(`== 未选 ==\n${missing.join(', ')}`);
  return out.join('\n\n') || '（尚未选择）';
}

// —— 工具栏 ——
let tab = 'cards', filter = 'all', search = '', unitMode = 'game', unitBg = 'dark';
const tabC = document.getElementById('tab-cards'), tabU = document.getElementById('tab-units'), tabK = document.getElementById('tab-cands'), tabN = document.getElementById('tab-names');
const cardsF = document.getElementById('cards-filters'), unitF = document.getElementById('unit-filters'), candF = document.getElementById('cand-filters'), nameF = document.getElementById('name-filters');
function switchTab(t) {
  tab = t;
  tabC.classList.toggle('on', t === 'cards'); tabU.classList.toggle('on', t === 'units'); tabK.classList.toggle('on', t === 'cands'); tabN?.classList.toggle('on', t === 'names');
  cardsF.style.display = t === 'cards' ? 'flex' : 'none'; unitF.style.display = t === 'units' ? 'flex' : 'none';
  candF.style.display = t === 'cands' ? 'flex' : 'none'; if (nameF) nameF.style.display = t === 'names' ? 'flex' : 'none';
  if (t === 'cards') renderCards(filter, search); else if (t === 'cands') renderCands(); else if (t === 'names') renderNames(); else renderUnits(unitMode, unitBg);
}
tabC.onclick = () => switchTab('cards');
tabU.onclick = () => switchTab('units');
if (tabK) tabK.onclick = () => switchTab('cands');
if (tabN) tabN.onclick = () => switchTab('names');
candF?.querySelectorAll('button[data-f]').forEach(b => b.onclick = () => {
  candF.querySelectorAll('button[data-f]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); candFilter = b.dataset.f; renderCands();
});
document.getElementById('export-sel')?.addEventListener('click', () => {
  const box = document.getElementById('export-box');
  box.querySelector('textarea').value = exportSelection();
  box.style.display = 'grid';
});
document.getElementById('export-copy')?.addEventListener('click', ev => {
  const ta = document.querySelector('#export-box textarea');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => { ev.target.textContent = '已复制✓'; setTimeout(() => ev.target.textContent = '复制', 900); });
});
document.getElementById('export-close')?.addEventListener('click', () => { document.getElementById('export-box').style.display = 'none'; });
document.getElementById('clear-sel')?.addEventListener('click', () => {
  for (const k of Object.keys(SEL)) delete SEL[k];
  saveSel();
  if (tab === 'cands') renderCands();
});
document.getElementById('clear-name-sel')?.addEventListener('click', () => {
  for (const k of Object.keys(NAMESEL)) delete NAMESEL[k];
  saveNameSel();
  if (tab === 'names') renderNames();
});
document.getElementById('export-box')?.addEventListener('click', ev => { if (ev.target.id === 'export-box') ev.target.style.display = 'none'; });
cardsF.querySelectorAll('button[data-f]').forEach(b => b.onclick = () => {
  cardsF.querySelectorAll('button[data-f]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); filter = b.dataset.f; renderCards(filter, search);
});
document.getElementById('search').addEventListener('input', e => {
  search = e.target.value.trim().toLowerCase();
  if (tab === 'cands') renderCands(); else if (tab === 'names') renderNames(); else renderCards(filter, search);
});
document.getElementById('export-name')?.addEventListener('click', () => {
  const box = document.getElementById('export-box');
  box.querySelector('textarea').value = exportNameSel();
  box.style.display = 'grid';
});
unitF.querySelectorAll('button[data-m]').forEach(b => b.onclick = () => {
  unitF.querySelectorAll('button[data-m]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); unitMode = b.dataset.m; renderUnits(unitMode, unitBg);
});
unitF.querySelectorAll('button[data-bg]').forEach(b => b.onclick = () => {
  unitF.querySelectorAll('button[data-bg]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); unitBg = b.dataset.bg; renderUnits(unitMode, unitBg);
});

switchTab('cards');
