// 遗物缺图补齐（ComfyUI API · Qwen Image 2.1）：画风对齐 art_src/遗物/PROMPT_TEMPLATE.md
// 的既定惯例（柔和厚涂、低完成度、单物居中、白描边贴剪影、55–70% 画布高）。
// 与 genEnemies 的差别：遗物带白描边 → 不能用白底（白描边会被洪水抠图吃掉），
// 固定洋红底（沿袭 seedream 遗物管线 --bg chroma 的做法），出图后走 tools/seedream/key.py
// （边缘色估计 + 洪水填充，洋红底自动识别）。
// 用法：node tools/genRelics.mjs [--dry] [--only=名1,名2] [--force]
// 产物：art_src/遗物/out_comfy/<遗物名>.png（未抠图原图，抠图与入库另走 key.py + compress_art.py）
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = 'art_src/遗物/out_comfy';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;

// 风格锚（翻译自 PROMPT_TEMPLATE 的既定措辞；完成度第一驱动是描述留白，不是风格措辞）
const STYLE = 'soft thick gouache digital painting, low completion, coarse visible brush strokes, simplified shapes, minimal detail, matte flat lighting, slightly top-down three-quarter view, single object centered floating, object height about sixty percent of canvas, generous margins on all sides, not touching frame edges, one clean continuous white outline ring of even thickness hugging the object silhouette, plain pure magenta background, flat uniform background color, no shadow, nothing else in frame, stylized game item icon art';
const NEGATIVE = 'detailed, intricate, fine texture, photorealistic, photographic, 3d render, smooth airbrush gradients, bright saturated neon colors, clean vector, glossy, ornate, complex pattern, many small elements, high frequency detail, white background, black background, gradient background, environment, scenery, ground, ground shadow, drop shadow, reflection, text, numbers, signature, watermark, logo, border, frame, decorative pattern, person, hands, arrows, labels, multiple objects, set display, cropped at edge, touching the frame edge, sharp specular highlights';

// 描述纪律（PROMPT_TEMPLATE 实测）：只写「是什么 + 大致轮廓 + 主色/主材质」，高频名词留白
const RELICS = [
  { id: '塔的石头', prompt: 'a small flat stone flake chipped off from a brick wall, gray-beige, rough' },
  { id: '鸟羽', prompt: 'a single pure white feather, soft, faintly luminous' },
  { id: '拾荒者的口袋', prompt: 'a patched brown leather pouch, mouth cinched with wire' },
  { id: '架势镜', prompt: 'a tall standing full-length floor mirror with a carved frame, yellowish aged mirror surface, vertical orientation, fully inside the frame' },
  { id: '胀满的背包', prompt: 'an overstuffed bulging olive hiking backpack, zipper straining about to burst' },
  { id: '守夜灯', prompt: 'a brass storm lantern with soot-darkened glass, one small steady flame inside' },
  { id: '火中栗', prompt: 'a single small charred blackened grain of rice, black' },
  { id: '共鸣石', prompt: 'a porous gray stone full of small holes' },
  { id: '囤囤鼠之宝藏', prompt: 'a gnawed acorn strung on a thin red cord' },
  { id: '破釜', prompt: 'an old black iron cauldron pot with a chipped rim and one clean hole punched through the bottom' },
  // 大剑 = 骑士设计稿同款（unit_player_sword 系列背上那柄）：厚重的朴素**双刃**直刃大剑，
  // 剑身远长于宽、两条对称直刃收进一个棱角剑尖；严禁单刃/砍刀/弯刃/钩口/纹路
  // （2026-10-11 用户两度验收打回：①过窄过装饰 ②「cleaver-like」生成了单刃大刀）
  { id: '大剑', prompt: 'a very long two-handed greatsword laid diagonally, straight double-edged blade with two symmetric straight cutting edges converging into an angular pointed tip, blade much longer than wide, thick heavy flat blade, plain dark blue-grey steel, no engravings no grooves no fuller no notches, one simple straight bar crossguard, plain dark wrapped grip, utilitarian unadorned, diagonal pose, fully inside the frame, wide margins', neg: 'single-edged, single edge blade, curved blade, cleaver, dao, broadsword, katana, scimitar, hook, sawtooth, fuller, engraving, runes, gemstone, gold' },
  { id: '戟', prompt: 'a very tall trident halberd with a thick black shaft and three thick blunt prongs, laid diagonally, diagonal pose, fully inside the frame, wide margins' },
];

async function queuePrompt(promptText, seed, neg = '') {
  // 显存账本见 genEnemies.mjs：TE 挂 CPU，UNet fp8 常驻，VAE 全速
  const workflow = {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_fp8.safetensors', type: 'qwen_image', device: 'cpu' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['453', 0],
        prompt: `${promptText}, ${STYLE}`,
        negative_prompt: neg ? `${NEGATIVE}, ${neg}` : NEGATIVE,
        resolution: 1024,
      },
    },
    '456': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
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
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': {
      class_type: 'SaveImageAdvanced',
      inputs: {
        images: ['457', 0],
        filename_prefix: 'wekyspire_relic',
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
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${COMFY}/history/${promptId}`);
    const hist = await res.json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error(`generation error: ${JSON.stringify(hist[promptId].status)}`);
  }
  // 首张含模型装载（约 1–2 分钟）；300×2s = 10 分钟兜底
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
  const targets = ONLY ? RELICS.filter(e => ONLY.includes(e.id)) : RELICS;
  console.log(`目标 ${targets.length} 件遗物，输出到 ${OUT_DIR}`);
  for (const e of targets) {
    const outPath = path.join(OUT_DIR, `${e.id}.png`);
    if (!FORCE && fs.existsSync(outPath)) { console.log(`跳过 ${e.id}（已存在，--force 覆盖）`); continue; }
    const seed = Math.floor(Math.random() * 1e15);
    console.log(`生成 ${e.id}（seed ${seed}）…`);
    if (DRY) { console.log(`  prompt: ${e.prompt}, ${STYLE}`); continue; }
    const pid = await queuePrompt(e.prompt, seed, e.neg ?? '');
    const hist = await waitDone(pid);
    await downloadImage(hist, outPath);
    console.log(`  ✓ ${outPath}`);
  }
  console.log('全部完成。');
}

main().catch(err => { console.error(err); process.exit(1); });
