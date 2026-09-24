// 批量生图（ComfyUI API · Qwen Image 2.1）：第一章敌人立绘，风格 = 大平面色块厚涂。
// 用法：node tools/genEnemies.mjs [--dry] [--only id1,id2] [--out 目录] [--force]
// 产物：<out>/<id>.png（未压缩 PNG，压缩进 src/assets 走 tools/compress_art.py）
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve(
  (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || 'art_src/enemies_qwen');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;

// 风格锚点 = 用户手画控制点（art_src/角色/：沼泽伏击者/腐苔球/嗡嗡虫/骑士_头像）。
// 真锚点口径：柔和厚涂但**完成度低**——粗笔触、边缘草莽未收；色彩**灰暗低饱和**
// （橄榄/棕灰/墨青），主体拆成大块多边形色面（低多边形感），平光无戏剧光影，
// 唯一高亮是眼睛/舌头这类小点缀；黑背景，主体在画框中占比偏小。
// 纪律（沿袭遗物 PROMPT_TEMPLATE 实测结论）：完成度的第一驱动是描述里的高频名词，
// 不是风格措辞——逐怪描述只写「是什么 + 大致轮廓 + 主色/主材质 + 一个点缀」，
// 禁写纹理/裂纹/斑点/笔触这类诱发逐一刻画的名词。
const STYLE = 'rough gouache sketch, soft thick paint, low completion, muted desaturated dark colors, large flat polygonal facet color planes, matte flat lighting, coarse visible brush strokes, simplified geometric shapes, minimal detail, dark moody palette, plain pure white background, no shadow, single subject filling the frame, stylized game creature art, unfinished sketchy edges, nothing else in frame';
const NEGATIVE = 'detailed, intricate, fine texture, individual hairs, individual spines, realistic fur, photorealistic, photographic, 3d render, smooth airbrush gradients, bright saturated colors, vivid, neon, clean vector, glossy, ornate, complex pattern, many small elements, high frequency detail, black background, gradient background, colored background, environment, ground shadow, drop shadow, atmospheric fog, scenery, anime, cartoon';

// 敌人 prompt 表：id → 是什么 + 大轮廓 + 主色/主材质 + 一个点缀（别写全，留白）
const ENEMIES = [
  { id: 'slime', prompt: 'a small round dark slime blob, blue-black, two white oval eyes' },
  { id: 'hedgehog', prompt: 'a small round hedgehog, dark brown jagged back, cream belly, black bead eyes' },
  { id: 'wraith', prompt: 'a floating ghost in a dark gray tattered cloak, two pale glowing eyes, a few teal wisps' },
  { id: 'slimelet', prompt: 'a tiny dark slime blob, blue-black, two white dot eyes' },
  { id: 'buzzbug', prompt: 'a small dark fly, two big pale translucent wings, big iridescent purple eyes, fuzzy dark body' },
  { id: 'mossBall', prompt: 'a dark ball of tangled roots and moss, brown-gray, one small glowing green eye' },
  { id: 'pufferToad', prompt: 'a round inflated toad, mottled olive-green, wide mouth, two yellow eyes' },
  { id: 'blastPod', prompt: 'a round brown seed pod with a warm orange glowing core, two white dot eyes' },
  { id: 'stoneCocoon', prompt: 'a gray stone cocoon oval, two pale eyes in a small opening' },
  { id: 'rockSnail', prompt: 'a snail with a heavy gray spiral shell, mossy patches, pale body, two white dot eyes' },
  { id: 'thornWeed', prompt: 'a dark green spiky weed plant, purple thorns, two small red eyes' },
  { id: 'carrionBeetle', prompt: 'a round dark brown beetle, oily sheen, small black eyes' },
  { id: 'diggerMole', prompt: 'a dark brown mole with big gray front claws, pointed snout, small black eyes' },
  { id: 'staticPuff', prompt: 'a pale yellow fluffy ball, blue sparks, small black eyes' },
  // 精英
  { id: 'snowwolf', prompt: 'a large white-gray wolf with blue shadows, pale blue eyes, snarling' },
  { id: 'swampAmbusher', prompt: 'a low-slung lurking crocodile, mottled olive and dark teal, long snout, small red eyes' },
  { id: 'rockPangolin', prompt: 'a curled pangolin with gray stone scale armor, brown edges, small black eyes' },
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
        negative_prompt: NEGATIVE,
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
    if (!FORCE && fs.existsSync(outPath)) { console.log(`跳过 ${e.id}（已存在，--force 覆盖）`); continue; }
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
