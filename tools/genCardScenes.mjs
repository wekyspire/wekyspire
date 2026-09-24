// 卡面场景图批量生成（ComfyUI API · Qwen Image 2.1）：「骑士演动作」全幅实底卡图。
// 用法：node tools/genCardScenes.mjs [--only key1,key2] [--count N] [--out 目录] [--start k] [--end k]
// 产物：<out>/<key>/cand_<i>_<seed>.png（1344×768，每键默认 3 抽；评审三选一后裁 2:1 入库）
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

const KNIGHT = 'a burly knight in muted steel-gray full plate armor with restrained metallic sheen, rounded full-cover helmet of the same steel-gray steel with a thin pale horizontal visor slit, no eyes visible behind the visor, a bright red scarf wrapped around the neck';
const STYLE = 'rough painterly gouache sketch, extremely broad coarse brush strokes, very low completion, chunky polygonal color-block planes, simplified blocky anatomy, strong dramatic lighting with clear light and shadow separation, American comic chiaroscuro, cool light from the upper left, muted colors, rough unfinished sketchy edges, no outlines, minimal detail, solid pure black background, subject fills the entire frame edge to edge, tight cinematic close-up crop, no text, no border';
const NEGATIVE = 'outline, line art, ink lines, thin lines, cel shading, flat shading, clean vector, anime, cartoon network style, detailed, intricate, fine texture, realistic, photorealistic, photographic, 3d render, smooth airbrush gradients, airbrush rendering, armor panel lines, rivets, glossy, ornate, environment scenery, text, letter, watermark, signature, border, frame, white background, multiple panels, small subject, tiny subject, distant full body, wide shot, emblem, logo, icon, sticker, glowing eyes, luminous pupils, black helmet, dark helmet, extra fingers, six fingers, mutated hand, deformed fingers, shiny chrome, shield, buckler, kite shield, round shield, tower shield, katana, scimitar, curved saber, dao';

// 动作场景表：每键一句「谁在干什么」，骑士是玩家卡的演员；
// Z 状态/敌方衍生卡没有骑士——画那个东西本身（同一风格）。
// 武装设定（2026-09-22 用户定）：骑士**无盾**（格挡只靠臂甲）；佩**大剑**（直刃双手巨剑，非刀）。
const SCENES = [
  // —— 体修大系 ——
  { id: 'fist', prompt: `${KNIGHT}, exaggerated foreshortening: a huge five-fingered gauntlet fist filling the left half of the frame aimed left, the knight charging right behind it, red scarf sweeping across, bright impact ring on the knuckles` },
  { id: 'blade', prompt: `${KNIGHT}, swinging a heavy two-handed greatsword with a long straight blade diagonally toward the lower left, the blade large in frame with a bright motion arc, both gauntlets on the grip, scarf flying` },
  { id: 'block', prompt: `${KNIGHT}, blocking a heavy blow with crossed armored forearms raised in front of the visor, the vambrace taking the impact with bursting sparks, helmet low behind the arms, braced stance` },
  { id: 'punch', prompt: `${KNIGHT}, lunging toward the left, leading with a heavy straight punch, tight crop on the torso and the leading fist, charging momentum, red scarf streaming behind` },
  { id: 'focusChant', prompt: `${KNIGHT}, kneeling in meditation, gauntlets pressed together before the chest, a single bright drop of light floating between the palms, calm closed posture` },
  // —— 火大系（火光映甲） ——
  { id: 'common', prompt: `${KNIGHT}, holding a tall standing flame on his open palm, warm firelight washing the steel armor, flame large in frame` },
  { id: 'ember', prompt: `${KNIGHT}, cupping a glowing charcoal ember between both gauntlets, ember glow lighting the visor slit from below, sparks rising` },
  { id: 'fireControl', prompt: `${KNIGHT}, a small flame hovering over his open palm, fingers conducting it like a puppet master, firelight on the gauntlet` },
  { id: 'burst', prompt: `${KNIGHT}, hurling an exploding fireball toward the left, the explosion burst large in frame, arm still extended from the throw` },
  { id: 'fireBall', prompt: `${KNIGHT}, throwing a flying fireball with a short bright tail toward the left, lean-forward follow-through pose` },
  { id: 'ignite', prompt: `${KNIGHT}, thrusting a rising tongue of flame upward from his palm, flame column filling the frame, face lit from below` },
  { id: 'fuel', prompt: `${KNIGHT}, tossing a bundle of firewood into a large blaze, sparks and embers flying, firelight on the armor` },
  { id: 'selfImmolate', prompt: `${KNIGHT}, wreathed in flames, fists clenched at his sides, fire crawling over the shoulders and arms, visor slit glowing through the fire` },
  { id: 'depth', prompt: `${KNIGHT}, arms spread wide as his own cards burst into flame around him, burning card scraps swirling upward, drawing a violent surge of fiery power out of the burning cards, desperate all-in eruption` },
  { id: 'condense', prompt: `${KNIGHT}, compressing a bright fire orb between both gauntlets, the orb small and blinding, arms straining inward` },
  { id: 'flameHeal', prompt: `${KNIGHT}, holding a gentle warm flame in his open palm against his chest, soft warm light, calm healing posture` },
  { id: 'fever', prompt: `${KNIGHT}, blazing with wild feverish flames, aggressive forward-leaning stance, heat waves distorting around the armor` },
  { id: 'fireChant', prompt: `${KNIGHT}, holding a single candle flame between his gauntlets at chest level, head bowed slightly in chant, warm point of light` },
  { id: 'melt', prompt: `${KNIGHT}, pouring a stream of molten metal from a crucible, the glowing liquid bright against the dark, visor reflecting the glow` },
  { id: 'explosiveArt', prompt: `${KNIGHT}, launching a fireworks burst into the sky from his raised hand, the festive burst large above him, looking up` },
  { id: 'fireWhirl', prompt: `${KNIGHT}, spinning with a tornado of fire around him, the fire whirl wrapping the frame, scarf pulled into the spiral` },
  { id: 'residualHeat', prompt: `${KNIGHT}, holding up a cooling gauntlet with faint heat waves and dim embers, the fight already over, subdued orange glow` },
  { id: 'fireTemper', prompt: `${KNIGHT}, quenching a glowing blade at an anvil, flames and steam around the blade, hammer raised` },
  { id: 'hotHands', prompt: `${KNIGHT}, shaking his burning-hot gauntlets, small flames dancing on the fingers, recoiling pose` },
  { id: 'silence', prompt: `${KNIGHT}, snuffing a candle flame between two gauntlets, a thin smoke wisp rising, the light just dying out` },
  { id: 'relief', prompt: `${KNIGHT}, wrenching open a round pressure valve, steam blasting out sideways, both hands on the valve wheel` },
  { id: 'kindling', prompt: `${KNIGHT}, a bleeding cut on his forearm, the blood drops catching small flames, arm held up close in frame` },
  { id: 'fireRain', prompt: `${KNIGHT}, an armored forearm raised overhead as cover under a rain of burning drops, fire rain streaking down around him` },
  { id: 'firstStrike', prompt: `${KNIGHT}, snap-firing a small fast firebolt from his palm toward the left, sharp speed lines, quick drawn motion` },
  { id: 'patience', prompt: `${KNIGHT}, a slow dark-red flame floating over a drop of blood on his open palm, ominous still pose` },
  { id: 'fireWall', prompt: `${KNIGHT}, standing behind a rising wall of flames, the fire wall filling the left frame, silhouetted through the fire` },
  { id: 'burnDoubler', prompt: `${KNIGHT}, merging two flames between his gauntlets into one much bigger flame, arms spread wide, fire doubling up` },
  { id: 'willOWisp', prompt: `${KNIGHT}, a ghostly pale wisp flame floating right before his visor, the knight leaning in to look, eerie cool-warm mix light` },
  { id: 'mirrorBurn', prompt: `${KNIGHT}, holding up a mirror shard reflecting a bright flame, the reflected fire large in the shard, dark around` },
  { id: 'spark', prompt: `${KNIGHT}, striking a burst of tiny sparks off his gauntlets, the spark burst filling the frame, sharp bright points` },
  { id: 'shock', prompt: `${KNIGHT}, landing a fiery impact punch toward the left, a shockwave ring exploding from the fist, debris pushed outward` },
  { id: 'magmaArmor', prompt: `${KNIGHT}, wearing cracked glowing magma plates over his armor, orange light in the cracks, heavy stance` },
  // —— 木大系 ——
  { id: 'woodHerb', prompt: `${KNIGHT}, holding a sprouting herb with two bright leaves in his gauntlet, soft green light, careful gentle grip` },
  { id: 'woodMiasma', prompt: `${KNIGHT}, conjuring a swamp miasma cloud with droplets over his palm, sickly green vapor curling around the arm` },
  { id: 'woodBark', prompt: `${KNIGHT}, thick tree-bark plates sprouting over the raised forearm and shoulder armor, bark texture in big planes, the armored arm presented forward, braced pose` },
  { id: 'woodChant', prompt: `${KNIGHT}, kneeling to plant a small seedling inside a circle of soft light, hands cupping the soil` },
  { id: 'woodSting', prompt: `${KNIGHT}, hurling a thorny stinger toward the left, a poison drop glistening on its tip, throwing motion` },
  { id: 'woodBlood', prompt: `${KNIGHT}, holding a dark leaf with a drop of black blood falling from it, ritual stillness, close on the hand` },
  // —— 风大系 ——
  { id: 'airBlade', prompt: `${KNIGHT}, slashing a crescent wind blade toward the left, the cyan slash large in frame, scarf whipped by the gust` },
  { id: 'airDodge', prompt: `${KNIGHT}, dissolving into a swirling gust spiral, motion-blurred dodge toward the right, cyan air rings` },
  { id: 'airChant', prompt: `${KNIGHT}, releasing a single feather from his fingers, air rings floating around it, head tilted in chant` },
  { id: 'airEase', prompt: `${KNIGHT}, floating cross-legged on a soft cloud puff, relaxed weightless pose, scarf drifting slowly` },
  { id: 'airFloat', prompt: `${KNIGHT}, levitating slightly off the ground, a feather rising past the visor, arms loose, cyan lift lines` },
  // —— 通用灰卡家族（骑士的日常动作） ——
  { id: 'purify', prompt: `${KNIGHT}, washing a dark stain off his gauntlet with a bright clear water drop, the stain dissolving, close on the hands` },
  { id: 'extract', prompt: `${KNIGHT}, drawing a droplet of light upward out of a gray rock held in his other hand, thin stream of light` },
  { id: 'drawQi', prompt: `${KNIGHT}, inhaling a visible swirl of air and light, chest expanded, the swirl spiraling into the visor slit` },
  { id: 'manaJar', prompt: `${KNIGHT}, pulling the cork from a small round glass potion jar, soft glow escaping from the jar mouth, close-up` },
  { id: 'stimulant', prompt: `${KNIGHT}, a rising bolt of energy crackling around his forearm, sudden jolt of vigor, sharp bright lines` },
  { id: 'psiShield', prompt: `${KNIGHT}, projecting a hexagonal energy barrier from his open palm toward the left, the barrier large and bright` },
  { id: 'acrobatics', prompt: `${KNIGHT}, juggling three balls in a smooth arc, mid-motion, visor tilted up following the balls` },
  { id: 'prePrepared', prompt: `${KNIGHT}, leaning casually on a folded closed umbrella like a cane, ready relaxed pose, umbrella tip on the ground` },
  { id: 'panpanBread', prompt: `${KNIGHT}, holding up a small round bread loaf in his gauntlet, warm homely light on the crust, close on the bread` },
  { id: 'noonNap', prompt: `${KNIGHT}, dozing off sitting, helmet nodding down onto the crossed arms resting on the pommel of his planted greatsword, a crescent moon above, quiet warm scene` },
  { id: 'holdOut', prompt: `${KNIGHT}, bracing behind a rising brick wall, armored forearm up and shoulder set, dust in the air, determined hold` },
  { id: 'instantCooldown', prompt: `${KNIGHT}, holding up an hourglass with the sand frozen mid-fall, close on the hourglass and the gauntlet` },
  { id: 'murmurChant', prompt: `${KNIGHT}, whispering a chant, soft sound ripples drifting out from the visor slit, head bowed` },
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

let targets = ONLY ? SCENES.filter(s => ONLY.includes(s.id)) : SCENES.slice(START, END === Infinity ? undefined : END);
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
