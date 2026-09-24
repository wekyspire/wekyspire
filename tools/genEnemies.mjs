// 批量生图（ComfyUI API · Qwen Image 2.1）：第一章敌人立绘，风格 = 剪影/粗轮廓/扁平/单色。
// 用法：node tools/genEnemies.mjs [--dry] [--only id1,id2] [--out 目录]
// 产物：art_src/enemies_qwen/<id>.png（未压缩 PNG，压缩进 src/assets 走 tools/compress_art.py）
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('art_src/enemies_qwen');
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;

// 风格前缀：厚涂油彩/粗笔触/色彩层次/黑色背景/光影体积——与用户手画控制点
// （腐苔球/嗡嗡虫/沼泽伏击者/骑士）同族。不是剪影，不是扁平，是「有体积的色块」。
const STYLE = 'thick oil painting style, visible brush strokes, rich color layers, volumetric lighting, painterly texture, black background, character portrait, gouache illustration, chunky color blocks, expressive brushwork, dramatic chiaroscuro, hand-painted game art style, not flat, not silhouette, full color rendering with depth and form';

// 敌人 prompt 表：id → 形态 + 色彩描述（厚涂该是什么样）
const ENEMIES = [
  { id: 'slime', prompt: 'a round blob slime creature, glossy dark blue-black body with subtle purple highlights, two glowing white oval eyes, amorphous teardrop shape, wet sheen' },
  { id: 'hedgehog', prompt: 'a small round hedgehog, brown spiky back with cream belly, four short legs, two black bead eyes, textured fur spikes' },
  { id: 'wraith', prompt: 'a floating ghost wraith, tattered dark gray cloak with ethereal blue-green wisps, no legs, two glowing pale eyes in shadow, translucent edges' },
  { id: 'slimelet', prompt: 'a tiny blob slime, very small round shape, glossy dark body with blue highlights, two small white dot eyes' },
  { id: 'buzzbug', prompt: 'a round insect bug, gray-blue translucent wings with visible veins, dark body, two large purple iridescent compound eyes, small antennae' },
  { id: 'mossBall', prompt: 'a spherical moss ball creature, tangled brown vines with patches of green moss, one glowing green eye peeking through, earthy texture' },
  { id: 'pufferToad', prompt: 'a round toad frog, inflated belly with mottled green-brown skin, wide mouth, two yellow eyes on top, warty texture' },
  { id: 'blastPod', prompt: 'a round seed pod creature, cracked brown shell showing orange glow inside, small stem on top, two white dot eyes, plant texture' },
  { id: 'stoneCocoon', prompt: 'an oval cocoon shape, wrapped in gray stone texture with cracks, small opening showing two pale eyes, rock surface' },
  { id: 'rockSnail', prompt: 'a snail with large spiral shell, heavy gray-brown stone shell with green moss patches, pale body, two white dot eyes on stalks' },
  { id: 'thornWeed', prompt: 'a plant weed creature, spiky dark green leaves with purple thorns, root-like base, two small red eyes in center, organic texture' },
  { id: 'carrionBeetle', prompt: 'a round beetle insect, hard dark brown shell with oily sheen, six legs, two small black eyes, segmented body' },
  { id: 'diggerMole', prompt: 'a mole creature, large metallic-gray front claws, dark brown fur, pointed snout, two small black eyes, earthy texture' },
  { id: 'staticPuff', prompt: 'a round fluffy ball creature, pale yellow-white fur with electric blue spark shapes crackling around it, two small black eyes' },
  // 精英
  { id: 'snowwolf', prompt: 'a large wolf, thick white-gray fur with blue shadows, pointed ears, snarling mouth showing teeth, four legs, two pale blue eyes, majestic and menacing' },
  { id: 'swampAmbusher', prompt: 'a crocodile ambush predator, mottled green-brown scaly skin with moss patches, long snout, half-submerged in murky water, two red eyes, textured scales' },
  { id: 'rockPangolin', prompt: 'a pangolin armadillo, overlapping gray stone-like scale armor with brown edges, curled tail, two small black eyes, rocky texture' },
];

async function queuePrompt(promptText, seed) {
  // 从 qwen21_t2i.json 子图展开的原子节点流（API 格式）
  const workflow = {
    // 模型加载
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    // 文本编码（Qwen Image 2.1 专用节点）
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['453', 0],
        prompt: `${promptText}, ${STYLE}`,
        negative_prompt: 'flat, silhouette, solid black fill, white background, minimal detail, abstract shape, no shading, no texture, graphic novel style, photographic, 3d render, anime, cartoon',
        resolution: 1024,
      },
    },
    // 空 latent（1024×1024）
    '456': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    // 采样
    '458': {
      class_type: 'KSampler',
      inputs: {
        model: ['451', 0],
        positive: ['452', 0],
        negative: ['452', 1],
        latent_image: ['456', 0],
        seed,
        control_after_generate: 'fixed',
        steps: 25,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    // 解码
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    // 保存
    '461': {
      class_type: 'SaveImageAdvanced',
      inputs: {
        images: ['457', 0],
        filename_prefix: 'wekyspire_enemy',
        format: 'png',
        'format.bit_depth': '8-bit',
        'format.input_color_space': 'sRGB',
      },
    },
  };
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
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
  const targets = ONLY ? ENEMIES.filter(e => ONLY.includes(e.id)) : ENEMIES;
  console.log(`目标 ${targets.length} 只敌人，输出到 ${OUT_DIR}`);
  for (const e of targets) {
    const outPath = path.join(OUT_DIR, `${e.id}.png`);
    if (fs.existsSync(outPath)) { console.log(`跳过 ${e.id}（已存在）`); continue; }
    const seed = Math.floor(Math.random() * 1e15);
    console.log(`生成 ${e.id}（seed ${seed}）…`);
    if (DRY) { console.log(`  prompt: ${e.prompt}, ${STYLE}`); continue; }
    const pid = await queuePrompt(e.prompt, seed);
    const hist = await waitDone(pid);
    await downloadImage(hist, outPath);
    console.log(`  ✓ ${outPath}`);
  }
  console.log('全部完成。');
}

main().catch(err => { console.error(err); process.exit(1); });
