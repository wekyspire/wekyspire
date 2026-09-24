// 批量生图（ComfyUI API · Qwen Image 2.1）：卡面系列符号图。
// 用法：node tools/genCardArt.mjs [--dry] [--only id1,id2] [--out 目录] [--force]
// 产物：<out>/<series>.png（白底 PNG；抠图垫透明走 tools/cutCardArt.py → assets/cards/）
//
// 卡面图纪律（用户 2026-09-24 定）：
//   ① 传达/符号性优先，美观其次——一张卡图就是一个「纹章」，不是一个场景；
//   ② 每大系固定主题色（火=红橙黄白黑；体修=岩灰白黑赭；木=深浅绿黄白；风=青蓝白），
//      其它颜色只许点缀；
//   ③ 绝对绝对不要扣细节——一块大形状 + 最多一个点缀笔画。
//   ④ 项目内残存卡面图不可参考（风格锚点仍是 art_src/角色/ 的手绘族）。
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve(
  (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || 'art_src/cards_qwen');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;

// 大系色板（写进 prompt 的硬约束）
const PALETTES = {
  fire: 'red, orange, yellow, white and black only',
  body: 'rock gray, off-white, black with subtle ochre accents only',
  wood: 'deep green, moss green, yellow-green, off-white only',
  air: 'cyan, sky blue, white, dark navy only',
};

// 符号图风格：纹章感 + 家样粗厚涂 + 零细节。白底是为了抠图（cutCardArt.py）。
const STYLE = 'minimalist symbolic emblem, one single bold glyph-like shape, flat rough gouache, thick coarse brush strokes, simplified geometric form, strong clean silhouette, absolutely minimal detail, no texture, symbolic not realistic, plain pure white background, no shadow, single symbol centered with margins, wide horizontal composition, nothing else in frame';
const NEGATIVE = 'detailed, intricate, fine texture, realistic, photorealistic, photographic, 3d render, smooth airbrush gradients, ornate, decoration, pattern, scene, landscape, background elements, multiple objects, text, letter, border, frame, high frequency detail, small elements, anime, cartoon, glossy';

// 系列符号表：series → { palette 大系, prompt 一句话符号 }
// 符号只写「一个什么形状」，不写质感词（防细节）；新系列在此补一行。
const SERIES = [
  // —— 体修大系（岩灰） ——
  { id: 'fist', palette: 'body', prompt: 'a clenched fist emblem, front view' },
  { id: 'blade', palette: 'body', prompt: 'a single broad dao saber blade emblem' },
  { id: 'block', palette: 'body', prompt: 'a simple round wooden shield with a raised center boss, front view emblem' },
  { id: 'punch', palette: 'body', prompt: 'a straight punch strike emblem with motion bar' },
  { id: 'focusChant', palette: 'body', prompt: 'a meditating drop of water emblem' },
  // —— 火大系（红橙黄白黑） ——
  { id: 'ember', palette: 'fire', prompt: 'a glowing charcoal ember chunk emblem' },
  { id: 'fireControl', palette: 'fire', prompt: 'a small flame hovering over an open palm emblem' },
  { id: 'burst', palette: 'fire', prompt: 'an exploding fireball burst emblem' },
  { id: 'fireBall', palette: 'fire', prompt: 'a flying fireball with short tail emblem' },
  { id: 'ignite', palette: 'fire', prompt: 'a rising flame tongue emblem' },
  { id: 'fuel', palette: 'fire', prompt: 'a bundle of burning firewood emblem' },
  { id: 'selfImmolate', palette: 'fire', prompt: 'a burning heart emblem' },
  { id: 'depth', palette: 'fire', prompt: 'a deep furnace pit with glow at bottom emblem' },
  { id: 'condense', palette: 'fire', prompt: 'a compressed bright fire orb emblem' },
  { id: 'flameHeal', palette: 'fire', prompt: 'a gentle warm flame with rising sparkles emblem' },
  { id: 'fever', palette: 'fire', prompt: 'a blazing fever flame with wavy heat emblem' },
  { id: 'fireChant', palette: 'fire', prompt: 'a candle flame emblem' },
  { id: 'inflame', palette: 'fire', prompt: 'a spark igniting into flame emblem' },
  // —— 木大系 ——
  { id: 'woodHerb', palette: 'wood', prompt: 'a sprouting herb with two leaves emblem' },
  { id: 'woodMiasma', palette: 'wood', prompt: 'a swamp miasma cloud with droplets emblem' },
  { id: 'woodBark', palette: 'wood', prompt: 'a tree bark shield emblem' },
  { id: 'woodChant', palette: 'wood', prompt: 'a growing seedling in a circle emblem' },
  // —— 风大系 ——
  { id: 'airBlade', palette: 'air', prompt: 'a crescent wind slash emblem' },
  { id: 'airDodge', palette: 'air', prompt: 'a swirling gust spiral emblem' },
  { id: 'airChant', palette: 'air', prompt: 'a floating feather with air rings emblem' },
  // —— 火系通用（series='common' 的火基础卡） ——
  { id: 'common', palette: 'fire', prompt: 'a simple standing flame emblem' },
  // —— 通用灰卡家族（series 未设，经 def.image 逐卡接线；偏白灰黑 + 一点赭） ——
  { id: 'purify', palette: 'body', prompt: 'a bright clear water droplet over a fading dark stain emblem' },
  { id: 'extract', palette: 'body', prompt: 'a droplet rising up from a gray rock emblem' },
  { id: 'drawQi', palette: 'body', prompt: 'a breath of air being inhaled, swirl into mouth emblem' },
  { id: 'manaJar', palette: 'body', prompt: 'a small round glass potion jar with a cork lid emblem' },
  { id: 'stimulant', palette: 'body', prompt: 'a rising lightning bolt of energy emblem' },
  { id: 'psiShield', palette: 'body', prompt: 'a hexagonal energy barrier emblem' },
  { id: 'acrobatics', palette: 'body', prompt: 'a juggling three balls arc emblem' },
  { id: 'prePrepared', palette: 'body', prompt: 'a folded closed umbrella leaning emblem' },
  { id: 'panpanBread', palette: 'body', prompt: 'a plump oval bread loaf with a scored crust, side view emblem' },
  { id: 'noonNap', palette: 'body', prompt: 'a crescent moon with a pillow emblem' },
  { id: 'holdOut', palette: 'body', prompt: 'a wall brick blocking emblem' },
  { id: 'instantCooldown', palette: 'body', prompt: 'an hourglass with sand frozen emblem' },
  { id: 'murmurChant', palette: 'body', prompt: 'an open mouth with sound ripples emblem' },
  { id: 'expandChant', palette: 'body', prompt: 'an open book with pages fanning out emblem' },
  { id: 'helicopter', palette: 'body', prompt: 'a little helicopter emblem' },
  // —— Z 阶状态卡 / 剧情卡（def.image 接线；灰黑白 + 警示红点缀） ——
  { id: 'badOmen', palette: 'body', prompt: 'a dark question mark omen emblem' },
  { id: 'burnWound', palette: 'body', prompt: 'a bandaged burn wound emblem' },
  { id: 'dustCloud', palette: 'body', prompt: 'a puffy billowing gray dust cloud emblem' },
  { id: 'inkBlot', palette: 'body', prompt: 'a black ink splatter blot emblem' },
  { id: 'looseLeaf', palette: 'body', prompt: 'a loose paper sheet blowing emblem' },
  { id: 'sidestep', palette: 'body', prompt: 'a quick sidestep footwork with motion lines emblem' },

  // —— 补簇（2026-09-22 覆盖率审计追加：火 19 / 木 2 / 风 2 / 特殊 2） ——
  { id: 'melt', palette: 'fire', prompt: 'a blob of molten metal dripping down emblem' },
  { id: 'explosiveArt', palette: 'fire', prompt: 'a festive fireworks burst in the sky emblem' },
  { id: 'fireWhirl', palette: 'fire', prompt: 'a swirling fire tornado emblem' },
  { id: 'residualHeat', palette: 'fire', prompt: 'a cooling ember with faint heat waves emblem' },
  { id: 'fireTemper', palette: 'fire', prompt: 'a sword blade glowing in forge fire emblem' },
  { id: 'hotHands', palette: 'fire', prompt: 'a hand with small flames on its fingers emblem' },
  { id: 'silence', palette: 'fire', prompt: 'an extinguished candle with a thin smoke wisp emblem' },
  { id: 'relief', palette: 'fire', prompt: 'a round pressure valve releasing steam emblem' },
  { id: 'kindling', palette: 'fire', prompt: 'a dark blood drop catching a small flame emblem' },
  { id: 'fireRain', palette: 'fire', prompt: 'burning rain drops falling from a dark cloud emblem' },
  { id: 'firstStrike', palette: 'fire', prompt: 'a small fast firebolt with speed lines emblem' },
  { id: 'patience', palette: 'fire', prompt: 'a slow dark red flame over a blood drop emblem' },
  { id: 'fireWall', palette: 'fire', prompt: 'a wall made of flames emblem' },
  { id: 'burnDoubler', palette: 'fire', prompt: 'two flames merging into one bigger flame emblem' },
  { id: 'willOWisp', palette: 'fire', prompt: 'a floating ghostly wisp flame emblem' },
  { id: 'mirrorBurn', palette: 'fire', prompt: 'a flame reflected in a mirror shard emblem' },
  { id: 'spark', palette: 'fire', prompt: 'a burst of tiny sparks emblem' },
  { id: 'shock', palette: 'fire', prompt: 'a fiery impact shockwave ring emblem' },
  { id: 'magmaArmor', palette: 'fire', prompt: 'a chestplate of cracked glowing magma rock emblem' },
  { id: 'woodSting', palette: 'wood', prompt: 'a thorny stinger with a poison drop emblem' },
  { id: 'woodBlood', palette: 'wood', prompt: 'a leaf with a falling dark blood drop emblem' },
  { id: 'airEase', palette: 'air', prompt: 'a soft floating cloud puff emblem' },
  { id: 'airFloat', palette: 'air', prompt: 'a feather floating upward emblem' },
  { id: 'enemyJunk', palette: 'body', prompt: 'a dripping goo slime blob emblem' },
  { id: 'relic', palette: 'body', prompt: 'a flying bullet with speed lines emblem' },
];

function buildWorkflow(promptText, seed) {
  const pal = SERIES.find(s => s.id === promptText.id)?.palette ?? 'body';
  const full = `${promptText.prompt}, color palette strictly limited to ${PALETTES[pal]}, ${STYLE}`;
  return {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['453', 0], prompt: full, negative_prompt: NEGATIVE, resolution: 1024 },
    },
    '456': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
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
        images: ['457', 0], filename_prefix: 'wekyspire_cardart', format: 'png',
        'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB',
      },
    },
  };
}

async function queuePrompt(series, seed) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow(series, seed) }),
  });
  if (!res.ok) throw new Error(`queuePrompt failed: ${res.status} ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitDone(promptId) {
  for (let i = 0; i < 120; i++) {
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

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = ONLY ? SERIES.filter(e => ONLY.includes(e.id)) : SERIES;
  console.log(`目标 ${targets.length} 张系列符号，输出到 ${OUT_DIR}`);
  for (const e of targets) {
    const outPath = path.join(OUT_DIR, `${e.id}.png`);
    if (!FORCE && fs.existsSync(outPath)) { console.log(`跳过 ${e.id}（已存在，--force 覆盖）`); continue; }
    const seed = Math.floor(Math.random() * 1e15);
    console.log(`生成 ${e.id}（${e.palette}，seed ${seed}）…`);
    if (DRY) { console.log(`  prompt: ${e.prompt} + palette[${e.palette}]`); continue; }
    const pid = await queuePrompt(e, seed);
    const hist = await waitDone(pid);
    await downloadImage(hist, outPath);
    console.log(`  ✓ ${outPath}`);
  }
  console.log('全部完成。');
}

main().catch(err => { console.error(err); process.exit(1); });
