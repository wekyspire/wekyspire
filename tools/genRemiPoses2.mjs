// 瑞米姿势·身份回拉段（stage 2）：stage1 的 0.78 姿势图构图对但角色漂了
// （双长耳消失/灰棕化/泰迪脸——qwen 先验在 0.8 下压过小体量参考图）。
// 本段以 瑞米正面.png 为参考、低 denoise 0.5 再 img2img：构图来自 stage1，
// 身份（双长耳/奶白/豆眼/极简脸）被参考拉回。
// 产物 art_src/remi_poses2/<pose>/cand_<i>_<seed>.png
// 用法：node tools/genRemiPoses2.mjs [--only=pose1,pose2] [--from=sit:0]（选 stage1 候选）[--count=N]
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const SRC = path.resolve('art_src/remi_poses');
const OUT_DIR = path.resolve('art_src/remi_poses2');
const REF = path.resolve('art_src/角色/瑞米正面.png');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 3;
const DENOISE = 0.5; // 身份回拉：低强度保构图、颜色/解剖向参考收敛

const FROM = {};
for (const a of process.argv) {
  if (a.startsWith('--from=')) for (const kv of a[7:].split(',')) {
    const k, _, v = kv.partition(':'); // eslint-disable-line
  }
}

const POSES = ['sit', 'curious', 'sleepy', 'alert', 'hop', 'lookback', 'happy'];
const IDENTITY = 'the same small round cream-white fluffy creature as the reference image: identical colors and proportions, two long upright rabbit-like ears, plain cream-white body with no markings, two small black dot eyes, tiny pink nose, very simple minimal face, stubby round paws';
const SUFFIX = ', solid pure black background, nothing else in frame, no shadow, stylized game character art, matching the reference art style exactly';

async function uploadImage(file, tag) {
  const name = `${tag}_${Date.now()}_${path.basename(file)}`;
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(file)]), name);
  fd.append('overwrite', 'true');
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).name;
}

function buildWorkflow(posePrompt, seed, refName, baseName) {
  return {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['453', 0], prompt: `${IDENTITY}, ${posePrompt}${SUFFIX}`, negative_prompt: 'different species, teddy bear face, brown fur, gray fur, markings, complex face, muzzle, whiskers, short stubby ears, no ears, cat ears, realistic, photorealistic, 3d render, fine fur detail, another character, human, knight, text, watermark, white background, colored background, ground shadow', resolution: 1024 } },
    // 单参考 img2img 的天然限制：身份图与构图图不能同时作参考。方案定为
    // 「stage1 姿势图做 latent 基底（构图）+ 身份特征全部点名进 prompt（0.5 重绘）」。
    // refName 仍上传但仅作未来 IPAdapter 化的占位，不接入本工作流。
    '470': { class_type: 'LoadImage', inputs: { image: baseName } },
    '472': { class_type: 'ImageScale', inputs: { upscale_method: 'nearest-exact', width: 1024, height: 1024, crop: 'center', image: ['470', 0] } },
    '473': { class_type: 'VAEEncode', inputs: { pixels: ['472', 0], vae: ['454', 0] } },
    // latent 混合：stage1 构图基底 + 0.5 denoise（身份参考为目标）
    '458': { class_type: 'KSampler', inputs: { model: ['451', 0], positive: ['452', 0], negative: ['452', 1], seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: DENOISE, latent_image: ['473', 0] } },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': { class_type: 'SaveImageAdvanced', inputs: { images: ['457', 0], filename_prefix: 'remi_pose2', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' } },
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

const refName = await uploadImage(REF, 'remi_ident_ref');
const poses = ONLY ? POSES.filter(p => ONLY.includes(p)) : POSES;
console.log(`身份回拉：denoise ${DENOISE}，身份参考=${REF}，${poses.length} 姿势 × ${COUNT}`);
for (const pose of poses) {
  const cands = fs.existsSync(path.join(SRC, pose))
    ? fs.readdirSync(path.join(SRC, pose)).filter(f => /^cand_0_/.test(f)).sort() : [];
  if (!cands.length) { console.log(`跳过 ${pose}（stage1 无 cand_0）`); continue; }
  const baseFile = path.join(SRC, pose, cands[0]);
  const baseName = await uploadImage(baseFile, `remi_base_${pose}`);
  const dir = path.join(OUT_DIR, pose);
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
  const POSE_PROMPT = {
    sit: 'sitting down on its round bottom, paws resting on its belly, relaxed',
    curious: 'leaning forward with big curious eyes, one small paw raised, head tilted',
    sleepy: 'drooping drowsy, eyes half closed, ears drooping down, sleepy sway',
    alert: 'standing tall on its toes, both long ears perked straight up, alarmed big eyes',
    hop: 'mid-jump stretched vertically off the ground, limbs tucked, bouncy energy',
    lookback: 'looking back over its shoulder, body facing away slightly, head turned to camera',
    happy: 'cheerful with happy closed eyes, bouncing gleefully, tiny smile',
  }[pose];
  for (let i = have; i < COUNT; i++) {
    const seed = Math.floor(Math.random() * 1e15);
    const out = path.join(dir, `cand_${i}_${seed}.png`);
    console.log(`回拉 ${pose} [${i + 1}/${COUNT}]…`);
    try {
      const res = await fetch(`${COMFY}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildWorkflow(POSE_PROMPT, seed, refName, baseName) }),
      });
      if (!res.ok) throw new Error(`queue ${res.status}`);
      const hist = await waitDone((await res.json()).prompt_id);
      const img = hist.outputs?.['461']?.images?.[0];
      const buf = Buffer.from(await (await fetch(
        `${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type}`)).arrayBuffer());
      fs.writeFileSync(out, buf);
      console.log(`  ✓ ${out}`);
    } catch (e) {
      console.error(`  ✗ ${pose}#${i}: ${e.message}`);
    }
  }
}
console.log('完成。');
