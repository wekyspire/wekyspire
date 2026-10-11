// 卡组 chip 图标生成（ComfyUI · Qwen Image 2.1，同 genEnemies 的原子节点流）：
// 白底出图 → tmp/gen_out/deck_icon_<seed>.png，扣 alpha 走 tools/cutDeckIcon.py。
// 用法：node tools/genDeckIcon.mjs [张数]
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = 'tmp/gen_out';
const COUNT = Number(process.argv[2] ?? 4);

// 卡组入口图标：叠卡 motif（与程序化回落 glyph 同语义），
// 配色锚定 UI 按钮 language（深海军蓝卡面 + 淡冰蓝描边），白底方便扣 alpha。
const SUBJECT = 'a neat stack of three playing cards fanned slightly apart, all cards face down, clean simple card backs';
const STYLE = 'flat game UI icon, simple bold silhouette, chunky rounded shapes, matte flat colors, muted dark navy blue card backs with thin pale ice-blue edge rims, one faint pale blue accent line on each card back, sticker-like clean edges, single centered subject filling most of the frame, plain pure white background, no shadow';
const NEGATIVE = 'photorealistic, 3d render, glossy, metallic, chrome, neon glow, saturated colors, gradient background, colored background, black background, drop shadow, ground shadow, text, letters, numbers, watermark, logo, intricate detail, fine texture, many small elements, thin fragile lines, blurry, noise, frame, border around the image, bevel, perspective, hand holding cards, casino chips, dice, playing card faces, pips, suits';

async function queuePrompt(seed) {
  const workflow = {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_fp8.safetensors', type: 'qwen_image', device: 'cpu' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['453', 0], prompt: `${SUBJECT}, ${STYLE}`, negative_prompt: NEGATIVE, resolution: 1024 },
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
        images: ['457', 0], filename_prefix: 'wekyspire_deckicon', format: 'png',
        'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB',
      },
    },
  };
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) throw new Error(`queuePrompt failed: ${res.status} ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitDone(promptId) {
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error(`generation error: ${JSON.stringify(hist[promptId].status)}`);
  }
  throw new Error('timeout');
}

async function downloadImage(hist, outPath) {
  const img = hist.outputs?.['461']?.images?.[0];
  if (!img) throw new Error('no output image');
  const res = await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (let i = 0; i < COUNT; i++) {
  const seed = Math.floor(Math.random() * 1e15);
  console.log(`生成 deck icon（seed ${seed}）…`);
  const pid = await queuePrompt(seed);
  const hist = await waitDone(pid);
  const out = path.join(OUT_DIR, `deck_icon_${seed}.png`);
  await downloadImage(hist, out);
  console.log(`  ✓ ${out}`);
}
console.log('全部完成。');
