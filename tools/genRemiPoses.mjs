// 瑞米多状态立牌批量生成（ComfyUI · Qwen Image 2.1 · img2img）：
// 参考图 art_src/角色/瑞米正面.png 锁角色一致性，姿势后缀驱动形态变化；
// 产物 art_src/remi_poses/<pose>/cand_<i>_<seed>.png（1024×1024 纯黑底，
// 部署时亮度抠透 + 裁内容框 → src/assets/stage/remi_pose_<pose>.webp）。
// 用法：node tools/genRemiPoses.mjs [--only=pose1,pose2] [--count=N]
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('art_src/remi_poses');
const REF = path.resolve('art_src/角色/瑞米正面.png');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 3;
const DENOISE = 0.74; // 身份/画风全靠参考图；降到 0.74 加强参考约束（0.78 物种对了但画风漂）

// 姿势表：id → 姿势后缀（前缀统一锁「同一只奶白绒毛圆家伙」+ 黑底全身）
// 身份与画风**全部交给参考图**（用户 2026-09-25 定：prompt 不指定风格——文字风格词
// 会与参考图打架，一致性烂掉的根因之一；微观解剖清单同样会引来缝合怪）。文字只管：
// 「就是参考图这只 + 新姿势 + 黑底」。
const PREFIX = 'the exact same small creature from the reference image, identical appearance, identical colors, identical proportions, identical art style as the reference, full body, single character, ';
const SUFFIX = ', solid pure black background, nothing else in frame';

const POSES = [
  { id: 'sit', prompt: 'sitting upright on its haunches like a fox, front paws together, tail curled around its feet, relaxed' },
  { id: 'curious', prompt: 'leaning forward with big curious eyes, head tilted, one front paw lifted mid-step, ears swiveled forward' },
  { id: 'sleepy', prompt: 'drooping drowsy, eyes half closed, ears drooping down, tail resting flat, sleepy sway' },
  { id: 'alert', prompt: 'standing tense on all fours, both ears perked straight up, tail raised, alarmed wide eyes' },
  { id: 'hop', prompt: 'mid-leap stretched horizontally off the ground, legs tucked, tail streaming, bouncy energy' },
  { id: 'lookback', prompt: 'looking back over its shoulder, body facing away, head turned to camera, tail up' },
  { id: 'happy', prompt: 'cheerful bounding bounce, eyes closed happy, mouth open in a grin, tail wagging up' },
];

async function uploadImage(file) {
  const name = `remi_ref_${Date.now()}.png`;
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(file)]), name);
  fd.append('overwrite', 'true');
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).name;
}

function buildWorkflow(promptText, seed, refName) {
  return {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['453', 0],
        prompt: PREFIX + promptText + SUFFIX,
        negative_prompt: 'detailed, intricate, fine fur texture, realistic, photorealistic, 3d render, smooth gradients, another character, multiple characters, human, knight, text, watermark, border, white background, gray background, colored background, ground shadow',
        resolution: 1024,
      },
    },
    '460': { class_type: 'LoadImage', inputs: { image: refName } },
    '462': { class_type: 'ImageScale', inputs: { upscale_method: 'nearest-exact', width: 1024, height: 1024, crop: 'center', image: ['460', 0] } },
    '463': { class_type: 'VAEEncode', inputs: { pixels: ['462', 0], vae: ['454', 0] } },
    '458': {
      class_type: 'KSampler',
      inputs: {
        model: ['451', 0], positive: ['452', 0], negative: ['452', 1],
        seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
        denoise: DENOISE, latent_image: ['463', 0],
      },
    },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': {
      class_type: 'SaveImageAdvanced',
      inputs: { images: ['457', 0], filename_prefix: 'remi_pose', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' },
    },
  };
}

async function waitDone(promptId) {
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const hist = await (await fetch(`${COMFY}/history/${promptId}`)).json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error('generation error');
  }
  throw new Error('timeout');
}

const poses = ONLY ? POSES.filter(p => ONLY.includes(p.id)) : POSES;
const refName = await uploadImage(REF);
console.log(`参考图已上传：${refName}（denoise ${DENOISE}，${poses.length} 姿势 × ${COUNT}）`);
for (const p of poses) {
  const dir = path.join(OUT_DIR, p.id);
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).length : 0;
  for (let i = have; i < COUNT; i++) {
    const seed = Math.floor(Math.random() * 1e15);
    const out = path.join(dir, `cand_${i}_${seed}.png`);
    console.log(`生成 ${p.id} [${i + 1}/${COUNT}]（seed ${seed}）…`);
    try {
      const res = await fetch(`${COMFY}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildWorkflow(p.prompt, seed, refName) }),
      });
      if (!res.ok) throw new Error(`queue ${res.status}`);
      const hist = await waitDone((await res.json()).prompt_id);
      const img = hist.outputs?.['461']?.images?.[0];
      const buf = Buffer.from(await (await fetch(
        `${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type}`)).arrayBuffer());
      fs.writeFileSync(out, buf);
      console.log(`  ✓ ${out}`);
    } catch (e) {
      console.error(`  ✗ ${p.id}#${i}: ${e.message}`);
    }
  }
}
console.log('完成。');
