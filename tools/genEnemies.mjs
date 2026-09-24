// 批量生图（ComfyUI API · Qwen Image 2.1）：第一章敌人立绘，风格 = 剪影/粗轮廓/扁平/单色。
// 用法：node tools/genEnemies.mjs [--dry] [--only id1,id2] [--out 目录]
// 产物：art_src/enemies_qwen/<id>.png（未压缩 PNG，压缩进 src/assets 走 tools/compress_art.py）
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('art_src/enemies_qwen');
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;

// 风格前缀：剪影/粗轮廓/扁平/单色/粗糙笔刷——与 slime.webp 同族
const STYLE = 'silhouette character design, thick rough brush stroke outline, flat solid black fill, single color, minimal detail, abstract shape, white background, no shading, no texture, graphic novel style, bold simple form, only eyes visible as white dots';

// 敌人 prompt 表：id → 形态描述（剪影该是什么样）
const ENEMIES = [
  { id: 'slime', prompt: 'a round blob slime creature, amorphous teardrop shape, two white oval eyes' },
  { id: 'hedgehog', prompt: 'a small round hedgehog, spiky back silhouette, four short legs, two white dot eyes' },
  { id: 'wraith', prompt: 'a floating ghost wraith, tattered cloak shape, no legs, two white dot eyes in shadow' },
  { id: 'slimelet', prompt: 'a tiny blob slime, very small round shape, two white dot eyes' },
  { id: 'buzzbug', prompt: 'a round insect bug, two wing shapes on back, small antennae, two white dot eyes' },
  { id: 'mossBall', prompt: 'a spherical moss ball creature, fuzzy texture silhouette, two white dot eyes' },
  { id: 'pufferToad', prompt: 'a round toad frog, inflated belly shape, wide mouth silhouette, two white dot eyes on top' },
  { id: 'blastPod', prompt: 'a round seed pod creature, cracked shell showing glow inside, small stem on top, two white dot eyes' },
  { id: 'stoneCocoon', prompt: 'an oval cocoon shape, wrapped in stone texture silhouette, small opening showing eyes' },
  { id: 'rockSnail', prompt: 'a snail with large spiral shell, heavy stone shell silhouette, two white dot eyes on stalks' },
  { id: 'thornWeed', prompt: 'a plant weed creature, spiky leaf silhouette, root-like base, two white dot eyes in center' },
  { id: 'carrionBeetle', prompt: 'a round beetle insect, hard shell back silhouette, six legs, two white dot eyes' },
  { id: 'diggerMole', prompt: 'a mole creature, large front claws silhouette, pointed snout, two white dot eyes' },
  { id: 'staticPuff', prompt: 'a round fluffy ball creature, electric spark shapes around it, two white dot eyes' },
  // 精英
  { id: 'snowwolf', prompt: 'a wolf silhouette, pointed ears, snarling mouth, four legs, two white dot eyes, larger size' },
  { id: 'swampAmbusher', prompt: 'a crocodile ambush predator, long snout silhouette, half-submerged shape, two white dot eyes' },
  { id: 'rockPangolin', prompt: 'a pangolin armadillo, overlapping scale armor silhouette, curled tail, two white dot eyes' },
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
        negative_prompt: 'detailed, realistic, textured, shaded, gradient, colorful, complex, intricate, photographic, 3d render',
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
