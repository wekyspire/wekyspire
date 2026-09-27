// 骑士正面立牌（ComfyUI · Qwen Image 2.1 · **纯 txt2img**）：
// 概念图/背面图是**样貌参考**（用户 2026-09-25 明确：不是 img2img 底图——构图会被锚图继承，
// 首批拿概念图当底 → 产物全是动态特写白雾环境，全废）。样貌经视觉专家从两图提炼成规格书
// （见 PROMPT），构图由 prompt 全权定义：黑底、正面全身站像、整人在框内留边。
// 产物 art_src/knight_front/cand_<i>_<seed>.png → 亮度抠透+内容框 → unit_player_front.webp。
// 用法：node tools/genKnightFront.mjs [--count=N]
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('art_src/knight_front');
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 5;

// —— 样貌规格书（视觉专家从 概念图+背面图 提炼；两视角共同确认项写死）——
const PROMPT = 'A stocky powerfully built knight, compact torso, broad shoulders, thick arms and heavy legs, dense heavy proportions. Full plate of bare unadorned steel in muted gunmetal grey with a slight warm cast, semi-polished with broad soft highlights and deep neutral shadows, plain utilitarian plates with no engraving or filigree. A rounded dome helmet with a smooth rounded visor and one narrow pale horizontal eye slit, no eyes visible behind the slit, no glow. Massive rounded pauldrons of two overlapping plates, articulated plated gauntlets with five fingers, segmented leg armor and heavy armored boots. A vivid vermilion-red scarf wrapped around the neck with both ends draped down over the chest. A brown leather belt at the waist. Standing upright facing the camera in strict front view, both gauntlets resting on the pommel of a huge plain straight double-edged two-handed greatsword planted vertically on the ground in front of him, no shield, no cape. Full body from head to toe, the entire figure well inside the frame with generous margins. Calm grounded stance. Painterly gouache with visible blocky brush strokes, soft color blocking, low completion, subtle dark charcoal edges, no crisp linework, solid pure black background, nothing else in frame, no ground shadow, single character, stylized game character art';
const NEGATIVE = 'detailed, intricate, fine texture, engraving, filigree, ornate, realistic, photorealistic, 3d render, smooth gradients, glossy, shield, cape, glowing eyes, luminous pupils, black helmet, blue-black armor, brown armor, side view, back view, three-quarter view, dynamic action pose, crouching, running, close-up crop, cropped body, head only, sitting, white background, fog, mist, environment, ground shadow, text, watermark, border, multiple characters';

function buildWorkflow(seed) {
  return {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['453', 0], prompt: PROMPT, negative_prompt: NEGATIVE, resolution: 1024 } },
    '458': { class_type: 'KSampler', inputs: { model: ['451', 0], positive: ['452', 0], negative: ['452', 1], seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, latent_image: ['459', 0] } },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': { class_type: 'SaveImageAdvanced', inputs: { images: ['457', 0], filename_prefix: 'knight_front', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' } },
    // 空 latent（EmptySD3LatentImage 同类的 qwen 侧节点名不确定——直接用 EmptyLatent 1024²）
    '459': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  };
}
// 接线修正：KSampler latent_image 指向空 latent
async function waitDone(promptId) {
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error('generation error');
  }
  throw new Error('timeout');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`txt2img × ${COUNT}（无参考图——样貌走规格书）`);
const have = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).length;
for (let i = have; i < COUNT; i++) {
  const seed = Math.floor(Math.random() * 1e15);
  const out = path.join(OUT_DIR, `cand_${i}_${seed}.png`);
  console.log(`生成 [${i + 1}/${COUNT}]（seed ${seed}）…`);
  try {
    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildWorkflow(seed) }),
    });
    if (!res.ok) throw new Error(`queue ${res.status}`);
    const hist = await waitDone((await res.json()).prompt_id);
    const img = hist.outputs?.['461']?.images?.[0];
    const buf = Buffer.from(await (await fetch(
      `${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type}`)).arrayBuffer());
    fs.writeFileSync(out, buf);
    console.log(`  ✓ ${out}`);
  } catch (e) {
    console.error(`  ✗ #${i}: ${e.message}`);
  }
}
console.log('完成。');
