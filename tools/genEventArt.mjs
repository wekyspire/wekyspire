// 事件插图生产（ComfyUI API · Qwen Image 2.1）：风格锚 = art_src/事件插图风格概念/山泉.png
// ——暗黑概念速涂：块状厚涂笔触、极低调、冷灰蓝去饱和底、中央唯一发光主体、
// 纯黑虚空背景、边缘碎散入暗。四事件 CG（16:9 幕间图，对话压图上，见 eventArt.js）。
// 候选留档 art_src/事件插图/out/<artkey>_<候选>.png；入库 = 拷入
// src/assets/images/events/<artkey>.png 后跑 python tools/compress_art.py（PNG→WebP 原位）。
// 用法：node tools/genEventArt.mjs [--dry] [--only=spring,moneyBag] [--force] [--cands=2]
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = 'art_src/事件插图/out';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const CANDS = Number((process.argv.find(a => a.startsWith('--cands=')) || '').split('=')[1] ?? 2);

// 风格锚（山泉.png 实图分析翻译）：完成度刻意压低（速涂感），主体是画面唯一光源
const STYLE = 'dark fantasy concept art speedpaint, digital impasto painting, chunky rectangular blocky brush strokes with dry brush flecks, rough painterly texture, deliberately low finish, simplified forms, extreme low key lighting, pitch black void background swallowing the edges, single faintly glowing subject at center as the only light source, subject edges dissolving and scattering into darkness, desaturated cold grey-blue palette with one dim colored glow, muted colors, gloomy abandoned dungeon atmosphere, wide cinematic composition';
const NEGATIVE = 'bright, high key, sunny, cheerful, colorful, highly saturated, photorealistic, photograph, 3d render, octane render, clean vector art, smooth airbrush gradients, refined detail, intricate detail, fine texture, sharp outlines, ink outline, white border, decorative frame, text, caption, watermark, signature, logo, human face close-up, person, crowd, multiple focal subjects, cluttered busy background, daylight scene, sky';

// 描述纪律（沿 genRelics 惯例）：只写「是什么 + 大致轮廓 + 主色/主材质」，高频名词留白。
// 主体措辞取事件文案原句的视觉锚（旁白第一句就是画面）
const EVENTS = [
  { id: 'spring', name: '山泉', prompt: 'a small clear spring welling out from the base of an old stone wall in darkness, thin film of water on the ground with tiny floating motes of cold pale cyan light, the glow softly illuminating nearby mossy stones' },
  { id: 'moneyBag', name: '钱袋', prompt: 'a bulging leather coin purse wedged in a crack between broken stone floor tiles of a dark corridor, warm faint golden glow seeping from its open mouth, a few old coins spilled on the ground beside it' },
  { id: 'bloodAltar', name: '黑色祭坛', prompt: 'a massive monolithic black stone altar standing at the top of worn stone steps in darkness, shallow carved grooves on its surface holding dim dark crimson liquid that glows faintly' },
  { id: 'sparringAutomaton', name: '打击机械', prompt: 'a tall humanoid training automaton machine standing alone against a dungeon wall, one arm missing at the shoulder, a rusted coin slot on its chest plate, dim warm furnace glow leaking from its joints, frozen mid-stance as if practicing' },
];

async function queuePrompt(promptText, seed, neg = '') {
  // 显存账本见 genEnemies.mjs：TE 挂 CPU，UNet fp8 常驻，VAE 全速。
  // 16:9 事件 CG：1344×768（≈1MP，对话压图 + cover 裁切容得下 1.75:1 与 1.778 的差）
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
    '456': { class_type: 'EmptyLatentImage', inputs: { width: 1344, height: 768, batch_size: 1 } },
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
        filename_prefix: 'wekyspire_event',
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
  const targets = ONLY ? EVENTS.filter(e => ONLY.includes(e.id)) : EVENTS;
  const suffix = 'abcdef';
  for (const e of targets) {
    for (let c = 0; c < CANDS; c++) {
      const outPath = path.join(OUT_DIR, `${e.id}_${suffix[c]}.png`);
      if (!FORCE && fs.existsSync(outPath)) { console.log(`跳过 ${outPath}（已存在，--force 覆盖）`); continue; }
      const seed = Math.floor(Math.random() * 1e15);
      console.log(`生成 ${e.name}（${e.id}）候选 ${suffix[c]}（seed ${seed}）…`);
      if (DRY) { console.log(`  prompt: ${e.prompt}, ${STYLE}`); continue; }
      const pid = await queuePrompt(e.prompt, seed, e.neg ?? '');
      const hist = await waitDone(pid);
      await downloadImage(hist, outPath);
      console.log(`  ✓ ${outPath}`);
    }
  }
  console.log('全部完成。候选在 out/，选定后拷入 src/assets/images/events/<id>.png 并跑 compress_art.py');
}

main().catch(err => { console.error(err); process.exit(1); });
