// 怪物立绘批量生成（ComfyUI API · Qwen Image 2.1）：用户手绘风格参考 → 全新怪物。
// 用法：node tools/genUnitArt.mjs [--only=hedgehog,slimelet] [--count=3] [--size=800] [--refs=3] [--seed=N]
//   参数一律**等号**连接（同 genCardScenes.mjs 约定）。
// 产物：art_src/enemies_unit_q21/<id>/cand_<i>_<seed>.png（原生 RGBA 透明直出，无白底切边
//   ——白边问题从源头消灭；入库前按 alpha 包围盒裁边 + compress_art）。
//
// 风格口径（锚 = tools/seedream/ref/ 手绘三张：沼泽伏击者/腐苔球/嗡嗡虫）：
//   笨拙儿童涂鸦、歪斜粗勾线、水彩晕染平涂、低饱和。参考图只锚画风，不复制主体。
// 朝向口径（2026-09-22 用户定）：正面站姿、身体与脸微微朝画面左侧（约 20 度），全队统一。
// 分辨率：800×800（2026-09-22 用户定）。参考图同步缩到 800（ref 模式输出尺寸跟随参考图）。
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve('art_src/enemies_unit_q21');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 3;
const SIZE = Number((process.argv.find(a => a.startsWith('--size=')) || '').split('=')[1]) || 800;
const REFS_N = Number((process.argv.find(a => a.startsWith('--refs=')) || '').split('=')[1]);
const SEED = (process.argv.find(a => a.startsWith('--seed=')) || '').split('=')[1] || null;
const REF_OVERRIDE = (process.argv.find(a => a.startsWith('--ref=')) || '').split('=')[1] || null;
const I2I = (process.argv.find(a => a.startsWith('--i2i=')) || '').split('=')[1] || null; // img2img 底图（手绘参考白底版）
const DENOISE = Number((process.argv.find(a => a.startsWith('--denoise=')) || '').split('=')[1]) || 0.8;
// 参考图必须白底版（ref_white/，python 预合成）：RGBA 抠图直传会被 LoadImage 丢 alpha、
// 透明区 RGB=黑，模型跟着画黑底（2026-09-22 试生成实测）。白底进 → 白底出 → key.py 切边。
const REF_FILES = (REF_OVERRIDE ? [REF_OVERRIDE] : [
  'tools/seedream/ref_white/swampAmbusher.png',
  'tools/seedream/ref_white/mossBall.png',
  'tools/seedream/ref_white/buzzbug.png',
]).slice(0, Number.isFinite(REFS_N) ? REFS_N : (REF_OVERRIDE ? 1 : 3));

// 涂鸦风（2026-09-22 四组审查定稿：seedream 批全是精致商业插画 = 全废，画风必须钉死；
// 首轮 q21 参考图模式实测：多参考被当内容锚（缝合巨兽）且 seed 失效——参考图只允许
// 单张风格拼贴（--ref=），默认纯 t2i 靠文字钉画风）
const STYLE = 'clumsy childish crayon scribble doodle style, like a drawing by a young child, uneven rough wobbly hand-drawn outlines, flat watercolor wash fill, blotchy uneven muted low-saturation colors, adorably crude, simple flat shapes, no detail polish, no volumetric shading';
const BG = 'single small monster only, no extra creatures, centered with comfortable margins, plain pure white background, no ground, no shadow';
const NEGATIVE = 'photorealistic, photograph, 3d render, airbrush, smooth gradients, glossy, shiny, specular highlights, cel shading, anime, manga, kawaii mascot, big sparkling anime eyes, realistic fur, intricate details, fine texture, polished commercial illustration, clean perfect linework, vector, sticker border, black background, dark background, scenery, ground, drop shadow, text, watermark, signature, frame, border, multiple monsters, symmetric frontal pose, facing right, side view, back view, do not copy the reference subjects';
// 朝向措辞（首轮实测：写成 side view 了）——「双眼可见」是正面视角的最强信号，
// 「not a side profile」反锚；放在 prompt 前段（Qwen 对早 token 加权更高）
const ORIENT = 'full-body front-facing stance seen from a three-quarter frontal angle, both eyes visible, head and body turned slightly toward the viewer\'s left, not perfectly symmetric, not a side profile';

// 内容表：一句「这只怪是什么」+ 姿态微调（趴伏/浮游类不写 standing）+ i2i 底图
// （base = 形体最接近的手绘白底参考——2026-09-22 刺猬试验定稿：denoise 0.8 从底图
//   继承涂鸦笔触，内容由 prompt 变；3/3 画风 pass，1/3 全维度 pass = 量产命中率）
const BASE_DIR = 'tools/seedream/ref_white';
const UNITS = [
  { id: 'hedgehog', base: 'mossBall.png', content: 'a small hedgehog monster with all of its back spines fully erect, the spine tips faintly glowing, gray-brown face and belly with white spines on its back only' },
  { id: 'slimelet', base: 'slime.png', content: 'a tiny baby slime, a small round dark translucent goo ball with two simple white oval eyes, a few stretchy mucus drips hanging off its body', orient: 'fronted, slightly angled toward the viewer\'s left, not perfectly symmetric' },
  { id: 'thornWeed', base: 'mossBall.png', content: 'a small monster of animate bramble weeds, thorny stems with poison-purple glowing tips and hanging venom drops, small roots planted in a clump of dirt, dark green and poison purple', orient: 'fronted, slightly angled toward the viewer\'s left, not perfectly symmetric' },
  { id: 'carrionBeetle', base: 'buzzbug.png', content: 'a carrion beetle monster with a gaping maw, glossy dark shell with mold spots, dark brown-black with a dull oily green sheen' },
  { id: 'staticPuff', base: 'mossBall.png', content: 'a fluffy ball of fur monster, its fur standing on end with thin blue electric arcs tangled in it, pale blue-white light glowing under the fur, gray-white and electric blue' },
  { id: 'diggerMole', base: 'swampAmbusher.png', content: 'a stout mole monster with a pair of oversized metallic silver digging claws, dirt smudges on its nose and claw tips, gray-brown fur with silver claws' },
  { id: 'pufferToad', base: 'mossBall.png', content: 'a big-bellied toad monster with a slack bloated belly covered in warts, warty green back with a pale yellow belly' },
  { id: 'blastPod', base: 'mossBall.png', content: 'a bloated spore-pod monster shaped like a pea pod, its sac showing fermenting liquid inside, a single fuse-like flower stigma sticking up from its top, sickly yellow-green with a red tip', orient: 'fronted, slightly tilted toward the viewer\'s left, not perfectly symmetric' },
  { id: 'stoneCocoon', base: 'mossBall.png', content: 'a pupa-shaped stone cocoon monster, its cracked stone shell glowing with warm orange-red light through the cracks, limestone gray with orange glow', orient: 'standing upright, slightly tilted toward the viewer\'s left, not perfectly symmetric' },
  { id: 'rockSnail', base: 'mossBall.png', content: 'a snail monster with a huge rocky spiral shell covered in moss patches, half retracted into its shell with its head poking out, rock gray with moss green' },
  { id: 'wraith', base: 'swampAmbusher.png', content: 'a semi-transparent floating wraith, a legless misty body with a ragged drifting hem, one hand raised in a curse gesture, ghostly blue-purple, low saturation', orient: 'floating upright, body and face turned slightly toward the viewer\'s left by about 20 degrees, not perfectly symmetric' },
  { id: 'snowwolf', base: 'swampAmbusher.png', content: 'a big snowfield wolf monster, frost-blue eyes, snowflakes caught in its fur, crouched ready to pounce, cold white gray-blue' },
  { id: 'rockPangolin', base: 'swampAmbusher.png', content: 'a pangolin monster with heavy granite-like layered armor plates on its back, small eyes and big claws, pale soft belly showing between the plates, head lowered in a charging stance, granite gray-brown with a warm pale belly' },
];

function buildWorkflow(unit, seed, refNames, i2iName = null) {
  const wf = {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['453', 0],
        prompt: `${unit.content}, ${unit.orient ?? ORIENT}, ${STYLE}, ${BG}`,
        negative_prompt: NEGATIVE,
        resolution: SIZE, // 参考图统一缩到 SIZE（32 的倍数）——ref 模式输出尺寸跟随参考图
      },
    },
    '458': {
      class_type: 'KSampler',
      inputs: {
        model: ['451', 0], positive: ['452', 0], negative: ['452', 1],
        seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
        denoise: i2iName ? DENOISE : 1,
      },
    },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': { class_type: 'SaveImage', inputs: { images: ['457', 0], filename_prefix: 'wekyspire_unit' } },
  };
  if (i2iName) {
    // img2img：手绘参考白底版当底图——涂鸦笔触/构图从底图继承，内容由 prompt 变
    // （genCardScenes 链级联同款：denoise 0.8 = 构图锁、形体变）
    wf['510'] = { class_type: 'LoadImage', inputs: { image: i2iName } };
    wf['511'] = { class_type: 'ImageScale', inputs: { image: ['510', 0], upscale_method: 'lanczos', width: SIZE, height: SIZE, crop: 'center' } };
    wf['512'] = { class_type: 'VAEEncode', inputs: { pixels: ['511', 0], vae: ['454', 0] } };
    wf['458'].inputs.latent_image = ['512', 0];
  } else if (refNames.length) {
    // ref 模式：latent 由文本编码器第 3 输出携带（参考图 VAE 化拼进序列）
    for (let i = 0; i < refNames.length; i++) {
      wf[`5${String(i + 1).padStart(2, '0')}`] = { class_type: 'LoadImage', inputs: { image: refNames[i] } };
      wf['452'].inputs[`images.image_${i + 1}`] = [`5${String(i + 1).padStart(2, '0')}`, 0];
    }
    wf['458'].inputs.latent_image = ['452', 2];
  } else {
    wf['456'] = { class_type: 'EmptyLatentImage', inputs: { width: SIZE, height: SIZE, batch_size: 1 } };
    wf['458'].inputs.latent_image = ['456', 0];
  }
  return wf;
}

async function uploadImage(filePath) {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  form.append('overwrite', 'true');
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).name;
}

async function queuePrompt(unit, seed, refNames, i2iName = null) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow(unit, seed, refNames, i2iName) }),
  });
  if (!res.ok) throw new Error(`queuePrompt failed: ${res.status} ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitDone(promptId) {
  // 模型动态换入（TE 16.7G ↔ UNET 13.5G 在 24G 卡上互挤）可能拖到几分钟/张，
  // 轮询窗放宽到 30 分钟；采样本身只有 20-40s
  for (let i = 0; i < 900; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${COMFY}/history/${promptId}`);
    const hist = await res.json();
    if (hist[promptId]?.status?.completed) return hist[promptId];
    if (hist[promptId]?.status?.status_str === 'error') throw new Error(`generation error: ${JSON.stringify(hist[promptId].status).slice(0, 500)}`);
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

// 参考图上传（尺寸统一交给 TextEncode 的 resolution 缩放）
async function prepareRef(filePath) {
  return uploadImage(filePath);
}

const targets = ONLY ? UNITS.filter(u => ONLY.includes(u.id)) : UNITS;
console.log(`目标 ${targets.length} 只 × ${COUNT} 抽 · ${SIZE}×${SIZE} · 参考图 ${REF_FILES.length} 张 → ${OUT_DIR}`);

let refNames = [];
for (const r of REF_FILES) {
  const name = await prepareRef(r);
  refNames.push(name);
  console.log(`参考图就位：${path.basename(r)} → ${name}`);
}

for (const unit of targets) {
  const dir = path.join(OUT_DIR, unit.id);
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.readdirSync(dir).filter(f => f.startsWith('cand_') && f.endsWith('.png')).length;
  for (let i = have; i < COUNT; i++) {
    const seed = SEED != null ? Number(SEED) + i : Math.floor(Math.random() * 1e15);
    const outPath = path.join(dir, `cand_${i}_${seed}.png`);
    const i2iPath = I2I || (unit.base ? `${BASE_DIR}/${unit.base}` : null);
    console.log(`生成 ${unit.id} [${i + 1}/${COUNT}]（seed ${seed}${i2iPath ? `，i2i=${path.basename(i2iPath)} denoise ${DENOISE}` : ''}）…`);
    try {
      const i2iName = i2iPath ? await uploadImage(i2iPath) : null;
      const pid = await queuePrompt(unit, seed, refNames, i2iName);
      const hist = await waitDone(pid);
      await downloadImage(hist, outPath);
      console.log(`  ✓ ${outPath}`);
    } catch (e) {
      console.error(`  ✗ ${unit.id}#${i}: ${e.message}`);
    }
  }
}
console.log('全部完成。');
