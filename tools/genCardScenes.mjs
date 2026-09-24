// 卡面场景图批量生成（ComfyUI API · Qwen Image 2.1）：「骑士演动作」全幅实底卡图。
// 用法：node tools/genCardScenes.mjs [--variants] [--only key1,key2] [--count N] [--out 目录] [--start k] [--end k]
// 产物：<out>/<key>/cand_<i>_<seed>.png（1344×768，每键默认 3 抽；评审三选一后裁 2:1 入库）
// --variants：等阶变体模式——读 tmp/series_tiers.json（node tmp/dump-series-tiers.mjs 生成），
//   多等阶键为「系列最低阶之外」的每个等阶产出 <key>-<tierIdx> 变体（同一动作，越来越强）。
//
// 风格口径（2026-09-22 用户四轮迭代定稿，锚 = art_src/骑士概念.png + art_src/角色/骑士背面）：
//   粗档厚涂、多边形大色面、美漫式鲜明光影、无勾线、钢灰金属甲（稍压暗但保留金属感）、
//   红围巾唯一亮色、面甲细缝不发光（无瞳孔光）、五指、动作塞满卡面。
//   评审三要素：风格相符 / 与 concept 角色相似（头盔=钢灰而非纯黑！）/ 表达力与美观。
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve(
  (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || 'art_src/cards_scenes');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 3;
const START = Number((process.argv.find(a => a.startsWith('--start=')) || '').split('=')[1]) || 0;
const END = Number((process.argv.find(a => a.startsWith('--end=')) || '').split('=')[1]) || Infinity;
const VARIANTS = process.argv.includes('--variants');

const KNIGHT = 'a burly knight in muted steel-gray full plate armor with restrained metallic sheen, rounded full-cover helmet of the same steel-gray steel with a thin pale horizontal visor slit, no eyes visible behind the visor, a bright red scarf wrapped around the neck';
const STYLE = 'rough painterly gouache sketch, extremely broad coarse brush strokes, very low completion, chunky polygonal color-block planes, simplified blocky anatomy, strong dramatic lighting with clear light and shadow separation, American comic chiaroscuro, cool light from the upper left, muted colors, rough unfinished sketchy edges, no outlines, minimal detail, solid pure black background, subject fills the entire frame edge to edge, tight cinematic close-up crop, no text, no border';
const NEGATIVE = 'outline, line art, ink lines, thin lines, cel shading, flat shading, clean vector, anime, cartoon network style, detailed, intricate, fine texture, realistic, photorealistic, photographic, 3d render, smooth airbrush gradients, airbrush rendering, armor panel lines, rivets, glossy, ornate, environment scenery, text, letter, watermark, signature, border, frame, white background, multiple panels, small subject, tiny subject, distant full body, wide shot, emblem, logo, icon, sticker, glowing eyes, luminous pupils, black helmet, dark helmet, extra fingers, six fingers, mutated hand, deformed fingers, shiny chrome, shield, buckler, kite shield, round shield, tower shield, katana, scimitar, curved saber, dao';

// 动作场景表：每键一句「谁在干什么」，骑士是玩家卡的演员；
// Z 状态/敌方衍生卡没有骑士——画那个东西本身（同一风格）。
// 武装设定（2026-09-22 用户定）：骑士**无盾**（格挡只靠臂甲）；佩**大剑**（直刃双手巨剑，非刀）。
// 防同图纪律（2026-09-22 用户试玩发现「不同系列图完全一样」）：同一演员 + 紧特写口径下，
// 「骑士胸前一点小火光」式 prompt 必然收敛成同一张图——写 prompt 必须**先定构图轴**
// （机位：正面/背影/侧脸/俯视/手部特写/铠甲特写；姿态：站/跪/坐/浮/掷/倒；景别：半身/全身/微距），
// 再填内容物。近义键（掌火系、咏唱系、格挡系）两两构图轴不得相同。
const SCENES = [
  // —— 体修大系 ——
  { id: 'fist', prompt: `${KNIGHT}, exaggerated foreshortening: a huge five-fingered gauntlet fist filling the left half of the frame aimed left, the knight charging right behind it, red scarf sweeping across, bright impact ring on the knuckles` },
  { id: 'blade', prompt: `${KNIGHT}, swinging a heavy two-handed greatsword with a long straight blade diagonally toward the lower left, the blade large in frame with a bright motion arc, both gauntlets on the grip, scarf flying` },
  { id: 'block', prompt: `${KNIGHT}, blocking a heavy blow with crossed armored forearms raised in front of the visor, the vambrace taking the impact with bursting sparks, helmet low behind the arms, braced stance` },
  { id: 'punch', prompt: `${KNIGHT}, lunging toward the left, leading with a heavy straight punch, tight crop on the torso and the leading fist, charging momentum, red scarf streaming behind` },
  { id: 'focusChant', prompt: `extreme close-up of two steel-gray armored gauntlets pressed together in prayer, a single bright drop of light floating between the palms, the hands filling the entire frame, no helmet in frame, dark background` },
  // —— 火大系（火光映甲） ——
  { id: 'common', prompt: `${KNIGHT}, holding a single tall flame aloft overhead on his straight raised arm like a torch, visor tilted up toward it, the flame large above the helmet, torch-bearer silhouette` },
  { id: 'ember', prompt: `${KNIGHT}, cupping a glowing charcoal ember between both gauntlets, ember glow lighting the visor slit from below, sparks rising` },
  { id: 'fireControl', prompt: `${KNIGHT}, a small flame hovering over his open palm, fingers conducting it like a puppet master, firelight on the gauntlet` },
  { id: 'burst', prompt: `${KNIGHT}, hurling an exploding fireball toward the left, the explosion burst large in frame, arm still extended from the throw` },
  { id: 'fireBall', prompt: `${KNIGHT}, throwing a flying fireball with a short bright tail toward the left, lean-forward follow-through pose` },
  { id: 'ignite', prompt: `extreme close-up of a steel-gray armored hand snapping its fingers, a small flame just catching on the thumb tip, sparks flying from the snap, dark background` },
  { id: 'fuel', prompt: `${KNIGHT}, tossing a playing card into a large blaze at his feet, the card catching fire mid-air above the flames, the flare lighting his armor from below` },
  { id: 'selfImmolate', prompt: `${KNIGHT}, wreathed in flames, fists clenched at his sides, fire crawling over the shoulders and arms, visor slit glowing through the fire` },
  { id: 'depth', prompt: `${KNIGHT}, arms spread wide as his own cards burst into flame around him, burning card scraps swirling upward, drawing a violent surge of fiery power out of the burning cards, desperate all-in eruption` },
  { id: 'condense', prompt: `${KNIGHT}, arms circled around a large compressed fireball spinning between his gauntlets, the blinding orb big in the center of the frame, arms framing a ring, heat swirl` },
  { id: 'flameHeal', prompt: `${KNIGHT}, head tilted up with arms open at his sides as warm golden light pours down over his shoulders and helmet from above, healing glow washing the armor, gentle embers rising` },
  { id: 'fever', prompt: `${KNIGHT}, blazing with wild feverish flames, aggressive forward-leaning stance, heat waves distorting around the armor` },
  { id: 'fireChant', prompt: `${KNIGHT} seen from behind, holding a single candle flame far ahead at arm's length, the small warm flame lighting the steel silhouette from the front, dark back view` },
  { id: 'melt', prompt: `${KNIGHT}, pouring a stream of molten metal from a crucible, the glowing liquid bright against the dark, visor reflecting the glow` },
  { id: 'explosiveArt', prompt: `${KNIGHT}, launching a fireworks burst into the sky from his raised hand, the festive burst large above him, looking up` },
  { id: 'fireWhirl', prompt: `${KNIGHT}, spinning with a tornado of fire around him, the fire whirl wrapping the frame, scarf pulled into the spiral` },
  { id: 'residualHeat', prompt: `${KNIGHT}, holding up a cooling gauntlet with faint heat waves and dim embers, the fight already over, subdued orange glow` },
  { id: 'fireTemper', prompt: `${KNIGHT}, raising a heavy hammer high overhead about to strike a glowing hot blade lying on an anvil, sparks and steam bursting, the hammer a large vertical silhouette` },
  { id: 'hotHands', prompt: `${KNIGHT}, shaking his burning-hot gauntlets, small flames dancing on the fingers, recoiling pose` },
  { id: 'silence', prompt: `${KNIGHT}, snuffing a candle flame between two gauntlets, a thin smoke wisp rising, the light just dying out` },
  { id: 'relief', prompt: `${KNIGHT}, wrenching open a round pressure valve, steam blasting out sideways, both hands on the valve wheel` },
  { id: 'kindling', prompt: `${KNIGHT}, a bleeding cut on his forearm, the blood drops catching small flames, arm held up close in frame` },
  { id: 'fireRain', prompt: `${KNIGHT}, an armored forearm raised overhead as cover under a rain of burning drops, fire rain streaking down around him` },
  { id: 'firstStrike', prompt: `${KNIGHT}, hurling a fire javelin overhand toward the left, arm fully extended in the throwing follow-through, the flaming dart leaving with a long bright trail, body twisted in the throw` },
  { id: 'patience', prompt: `extreme close-up of an upturned steel-gray armored palm, a drop of dark blood on it with a slow dark-red flame rising from the drop, ominous stillness, dark background` },
  { id: 'fireWall', prompt: `${KNIGHT}, standing behind a rising wall of flames, the fire wall filling the left frame, silhouetted through the fire` },
  { id: 'burnDoubler', prompt: `${KNIGHT}, watching a single flame on his open palm split into two identical flames drifting apart mid-air, the doubling moment, mirrored fire` },
  { id: 'willOWisp', prompt: `${KNIGHT}, reaching toward a pale blue-white ghost flame floating freely in the air beside him, cold wisp light on the visor and gauntlet, the wisp drifting just beyond his fingers` },
  { id: 'mirrorBurn', prompt: `${KNIGHT}, holding up a mirror shard reflecting a bright flame, the reflected fire large in the shard, dark around` },
  { id: 'spark', prompt: `${KNIGHT}, striking a burst of tiny sparks off his gauntlets, the spark burst filling the frame, sharp bright points` },
  { id: 'shock', prompt: `${KNIGHT}, landing a fiery impact punch toward the left, a shockwave ring exploding from the fist, debris pushed outward` },
  { id: 'magmaArmor', prompt: `extreme close-up of a steel-gray breastplate and pauldron with glowing lava cracks veining the metal, molten orange light in the fissures, helmet cropped out of frame` },
  // —— 木大系 ——
  { id: 'woodHerb', prompt: `${KNIGHT}, holding a sprouting herb with two bright leaves in his gauntlet, soft green light, careful gentle grip` },
  { id: 'woodMiasma', prompt: `${KNIGHT}, conjuring a swamp miasma cloud with droplets over his palm, sickly green vapor curling around the arm` },
  { id: 'woodBark', prompt: `extreme close-up of a steel-gray armored forearm held across the frame, thick tree-bark plates sprouting over the vambrace, bark texture in big planes, no helmet in frame` },
  { id: 'woodChant', prompt: `top-down view: two steel-gray armored gauntlets cupping soil with a tiny sprouting seedling inside a ring of soft light, the rim of a rounded helmet just at the top edge of the frame, ground-level composition` },
  { id: 'woodSting', prompt: `${KNIGHT}, hurling a thorny stinger toward the left, a poison drop glistening on its tip, throwing motion` },
  { id: 'woodBlood', prompt: `close-up of a steel-gray armored hand pressing onto a thorned black vine, thorns pricking the palm seam, drops of glowing dark-red sap welling up, the vine coiling around the wrist` },
  // —— 风大系 ——
  { id: 'airBlade', prompt: `${KNIGHT}, slashing a crescent wind blade toward the left, the cyan slash large in frame, scarf whipped by the gust` },
  { id: 'airDodge', prompt: `${KNIGHT}, dissolving into a swirling gust spiral, motion-blurred dodge toward the right, cyan air rings` },
  { id: 'airChant', prompt: `${KNIGHT}, releasing a single feather from his fingers, air rings floating around it, head tilted in chant` },
  { id: 'airEase', prompt: `${KNIGHT}, floating cross-legged on a soft cloud puff, relaxed weightless pose, scarf drifting slowly` },
  { id: 'airFloat', prompt: `${KNIGHT}, levitating high off the ground at a tilted diagonal, boots dangling, red scarf drifting straight upward, a ring of pale cyan air beneath him, weightless floating pose` },
  // —— 通用灰卡家族（骑士的日常动作） ——
  { id: 'purify', prompt: `${KNIGHT}, washing a dark stain off his gauntlet with a bright clear water drop, the stain dissolving, close on the hands` },
  { id: 'extract', prompt: `${KNIGHT}, pulling a long bright ribbon of light out of a small gray rock with two fingers, the ribbon stretched taut between the rock and his hand, sparks trailing from the rock` },
  { id: 'drawQi', prompt: `${KNIGHT}, leaning back with chest open as many thin streams of pale breath-light converge from all around into his visor and chest, inhaling the air, inward rushing motion lines` },
  { id: 'manaJar', prompt: `${KNIGHT}, pulling the cork from a small round glass potion jar, soft glow escaping from the jar mouth, close-up` },
  { id: 'stimulant', prompt: `${KNIGHT}, a rising bolt of energy crackling around his forearm, sudden jolt of vigor, sharp bright lines` },
  { id: 'psiShield', prompt: `${KNIGHT}, projecting a hexagonal energy barrier from his open palm toward the left, the barrier large and bright` },
  { id: 'acrobatics', prompt: `${KNIGHT}, juggling three balls in a smooth arc, mid-motion, visor tilted up following the balls` },
  { id: 'prePrepared', prompt: `${KNIGHT}, leaning casually on a folded closed umbrella like a cane, ready relaxed pose, umbrella tip on the ground` },
  { id: 'panpanBread', prompt: `${KNIGHT}, holding up a small round bread loaf in his gauntlet, warm homely light on the crust, close on the bread` },
  { id: 'noonNap', prompt: `${KNIGHT}, dozing off sitting, helmet nodding down onto the crossed arms resting on the pommel of his planted greatsword, a crescent moon above, quiet warm scene` },
  { id: 'holdOut', prompt: `${KNIGHT}, bracing behind a rising brick wall, armored forearm up and shoulder set, dust in the air, determined hold` },
  { id: 'instantCooldown', prompt: `${KNIGHT}, holding up an hourglass with the sand frozen mid-fall, close on the hourglass and the gauntlet` },
  { id: 'murmurChant', prompt: `extreme close-up side profile of a rounded steel-gray helmet with a thin horizontal visor slit, soft glowing rings of sound rippling out from the slit toward the left, dark background` },
  { id: 'expandChant', prompt: `${KNIGHT}, both palms upturned with three small glowing chant flames floating in a row above them, holding several flames aloft at once, calm expanded focus` },
  { id: 'helicopter', prompt: `${KNIGHT}, a little toy helicopter taking off from his open gauntlet, the knight watching it lift, whimsical small rotor wash` },
  // —— Z 状态卡（没有骑士——画那个东西本身，同一风格） ——
  { id: 'badOmen', prompt: `a huge dark question-mark-shaped shadow looming on a black field, faint cold rim light, ominous painterly smog` },
  { id: 'burnWound', prompt: `a close-up of a bandaged burned forearm, scorched skin edges under the wraps, muted warm pain light` },
  { id: 'dustCloud', prompt: `a billowing blinding dust cloud filling the frame, gray swirling masses, grit in the air` },
  { id: 'inkBlot', prompt: `a black ink splatter exploding across the frame, glossy dark masses with sharp tendrils, high contrast` },
  { id: 'looseLeaf', prompt: `a single loose paper sheet caught mid-air in a gust, tumbling with motion lines, pale sheet on black` },
  { id: 'sidestep', prompt: `a pair of armored boots mid-dodge sliding sideways, sharp motion lines, dust kicking up, close crop` },
  // —— 特殊 ——
  { id: 'enemyJunk', prompt: `a dripping goo slime blob monster lunging slightly forward, glossy dark masses with pale drips, crude menace` },
  { id: 'relic', prompt: `a gun muzzle firing toward the left in extreme close-up, the bullet leaving with sharp speed lines, warm muzzle flash` },
];

// —— 等阶增强后缀（--variants）：按绝对等阶索引分级（1=C … 4=S），跨系列同阶同强度口径 ——
const ESCALATION = {
  1: ', the same action, slightly stronger: a touch more energy and glow, a wider motion',
  2: ', the same action, clearly stronger: more intense energy, brighter glow, wider stronger motion, heightened drama',
  3: ', the same action, much stronger: blazing bright energy, large sweeping motion, sparks and debris flying',
  4: ', the same action at overwhelming ultimate power: massive erupting energy, huge blazing arcs, storm of sparks and debris filling the frame',
};
// 安静/生活场景的能量后缀会读岔，单独给「更丰盈/更深沉」的分级
const ESCALATION_QUIET = {
  woodHerb: {
    1: ', the same gentle grip, the herb larger with more bright leaves, the soft green glow a little stronger',
    2: ', the same gentle grip, the herb grown lush: a small bundle of bright sprouting leaves, vivid green glow, drifting motes of light',
    3: ', the same gentle grip, the herb bursting with life: a large lush spray of glowing leaves and tendrils, strong green radiance',
    4: ', the same gentle grip, the herb at overflowing vitality: a huge radiant bouquet of glowing leaves and vines, brilliant green light flooding the frame',
  },
  manaJar: {
    1: ', the same jar, the glow escaping a little brighter, a wisp of light rising',
    2: ', the same jar, bright glow pouring from the mouth, light wisps swirling',
    3: ', the same jar, radiant light bursting from the mouth, brilliant wisps swirling around',
    4: ', the same jar, a dazzling geyser of light erupting from the mouth, the frame flooded with glow',
  },
  panpanBread: {
    1: ', the same bread, a little larger and fresher, steam rising, warmer light',
    2: ', the same bread, bigger and golden, generous steam, rich warm glow',
    3: ', the same bread, huge and fragrant, thick steam, abundant warm radiance',
    4: ', the same bread, a magnificent feast-sized loaf glowing golden, lavish steam and warm light filling the frame',
  },
  noonNap: {
    1: ', the same dozing scene, a little warmer and cozier, softer moon glow',
    2: ', the same dozing scene, deeply cozy, warm ember light mixing with the moon glow',
    3: ', the same dozing scene, utterly serene, a blanket of warm light, bright gentle moon',
    4: ', the same dozing scene, perfect tranquil rest, a radiant warm aura around him, large glowing moon',
  },
  murmurChant: {
    1: ', the same whisper, the sound ripples a little clearer and brighter',
    2: ', the same whisper, vivid glowing ripples drifting farther out',
  },
  patience: {
    2: ', the same upturned palm, the dark-red flame larger and hungrier, more blood welling up',
    3: ', the same upturned palm, the dark-red flame raging high, blood dripping, an ominous blaze',
  },
  willOWisp: {
    3: ', the same floating ghost flame, larger and brighter, cold blue-white light washing the armor, wisps of cold mist',
  },
  woodBlood: {
    2: ', the same hand and vine, more thorns coiling further up the wrist, more glowing dark-red sap dripping',
  },
  prePrepared: {
    1: ', the same relaxed lean, a bit more poised, a subtle glint of readiness',
    2: ', the same relaxed lean, a confident poised aura, the umbrella gleaming',
    3: ', the same casual pose, radiating quiet confidence, dramatic rim light, the umbrella held like a sword',
  },
  holdOut: {
    1: ', the same hold, the wall a little higher and sturdier, more dust in the air',
    2: ', the same hold, a tall solid wall, rubble and dust in the air, a stronger impact',
    3: ', the same hold, a massive bulwark wall, debris flying, an unbreakable stance',
  },
};

// 变体场景表：多等阶键（tmp/series_tiers.json）为最低阶之外的每个等阶出一行 <key>-<tierIdx>
function variantScenes() {
  const tiersPath = path.resolve('tmp/series_tiers.json');
  if (!fs.existsSync(tiersPath)) throw new Error('缺 tmp/series_tiers.json——先跑 node tmp/dump-series-tiers.mjs');
  const tiers = JSON.parse(fs.readFileSync(tiersPath, 'utf8'));
  const out = [];
  for (const s of SCENES) {
    const t = tiers[s.id];
    if (!t || t.length < 2) continue;
    const min = Math.min(...t);
    for (const idx of t) {
      if (idx === min) continue;
      const esc = (ESCALATION_QUIET[s.id] ?? ESCALATION)[idx] ?? ESCALATION[idx];
      out.push({ id: `${s.id}-${idx}`, prompt: s.prompt + esc });
    }
  }
  return out;
}

function buildWorkflow(scene, seed) {
  return {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['453', 0], prompt: `${scene.prompt}, ${STYLE}`, negative_prompt: NEGATIVE, resolution: 1024 },
    },
    '456': { class_type: 'EmptyLatentImage', inputs: { width: 1344, height: 768, batch_size: 1 } },
    '458': {
      class_type: 'KSampler',
      inputs: {
        model: ['451', 0], positive: ['452', 0], negative: ['452', 1], latent_image: ['456', 0],
        seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': {
      class_type: 'SaveImageAdvanced',
      inputs: {
        images: ['457', 0], filename_prefix: 'wekyspire_cardscene', format: 'png',
        'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB',
      },
    },
  };
}

async function queuePrompt(scene, seed) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow(scene, seed) }),
  });
  if (!res.ok) throw new Error(`queuePrompt failed: ${res.status} ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitDone(promptId) {
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${COMFY}/history/${promptId}`);
    const hist = await res.json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error(`generation error: ${JSON.stringify(hist[promptId].status)}`);
  }
  throw new Error('timeout');
}

async function downloadImage(hist, outPath) {
  const outputs = hist.outputs?.['461']?.images;
  if (!outputs?.length) throw new Error('no output image');
  const img = outputs[0];
  const res = await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

const POOL = VARIANTS ? variantScenes() : SCENES;
let targets = ONLY ? POOL.filter(s => ONLY.includes(s.id)) : POOL.slice(START, END === Infinity ? undefined : END);
targets = targets.filter(s => {
  // 已有 COUNT 张候选的键跳过（除非 --only 显式点名）
  if (ONLY) return true;
  const dir = path.join(OUT_DIR, s.id);
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).length : 0;
  if (have >= COUNT) { console.log(`跳过 ${s.id}（已有 ${have} 张候选）`); return false; }
  return true;
});
console.log(`目标 ${targets.length} 键 × ${COUNT} 抽，输出到 ${OUT_DIR}`);
for (const s of targets) {
  const dir = path.join(OUT_DIR, s.id);
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
  for (let i = have; i < COUNT; i++) {
    const seed = Math.floor(Math.random() * 1e15);
    const outPath = path.join(dir, `cand_${i}_${seed}.png`);
    console.log(`生成 ${s.id} [${i + 1}/${COUNT}]（seed ${seed}）…`);
    try {
      const pid = await queuePrompt(s, seed);
      const hist = await waitDone(pid);
      await downloadImage(hist, outPath);
      console.log(`  ✓ ${outPath}`);
    } catch (e) {
      console.error(`  ✗ ${s.id}#${i}: ${e.message}`);
    }
  }
}
console.log('全部完成。');
