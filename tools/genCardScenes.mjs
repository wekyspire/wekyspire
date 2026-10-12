// 卡面场景图批量生成（ComfyUI API · Qwen Image 2.1）：「骑士演动作」全幅实底卡图。
// 用法：node tools/genCardScenes.mjs [--only=key1,key2] [--count=N] [--out=目录] [--start=k] [--end=k]
//       node tools/genCardScenes.mjs --chain=k0,k1,...   跨键进阶链级联（k0 用既有图作参考，其后每级
//                                                        以前一级新图 img2img——同链构图锁死、逐级升维）
//       node tools/genCardScenes.mjs --varchain [--only=k] [--count=N]   等阶变体级联（读 tmp/series_tiers.json：
//                                                        部署图为最低阶锚，逐阶 img2img denoise 0.8——
//                                                        构图锁死、增强/褪彩交给后缀；--count=1 起步后迭代）
// 产物：<out>/<key>/cand_<i>_<seed>.png（800×400——2026-09-22 用户定：800 宽够用、省时 3 倍；评审三选一入库）
// 注意：参数一律**等号**连接（--only=x,y）——空格分隔会被静默忽略，变成全量批跑！
//   多等阶键为「系列最低阶之外」的每个等阶产出 <key>-<tierIdx> 变体（同一动作，越来越强）。
//
// 风格口径（2026-09-22 用户四轮迭代定稿，锚 = art_src/骑士概念.png + art_src/角色/骑士背面）：
//   粗档厚涂、多边形大色面、美漫式鲜明光影、无勾线、钢灰金属甲（稍压暗但保留金属感）、
//   红围巾唯一亮色、面甲细缝不发光（无瞳孔光）、五指、动作塞满卡面。
//   评审三要素：风格相符 / 与 concept 角色相似（头盔=钢灰而非纯黑！）/ 表达力与美观。
// 氛围优先（2026-09-25 用户定，参考 art_src/氛围参考-围巾骑士.png）：**氛围 > 精细表达**——
//   表达靠剪影与动作态势，形态溶入大色面与光影团块，细节交给观看者脑补。
import fs from 'node:fs';
import path from 'node:path';

const COMFY = 'http://127.0.0.1:8188';
const OUT_DIR = path.resolve(
  (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || 'art_src/cards_scenes');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]?.split(',') || null;
const COUNT = Number((process.argv.find(a => a.startsWith('--count=')) || '').split('=')[1]) || 3;
const START = Number((process.argv.find(a => a.startsWith('--start=')) || '').split('=')[1]) || 0;
const END = Number((process.argv.find(a => a.startsWith('--end=')) || '').split('=')[1]) || Infinity;
const VARCHAIN = process.argv.includes('--varchain');
const CHAIN = (process.argv.find(a => a.startsWith('--chain=')) || '').split('=')[1]?.split(',') || null;
const ANCHOR = (process.argv.find(a => a.startsWith('--anchor=')) || '').split('=')[1] || null; // 显式参考图（给定时链内所有键都生成，无「链首跳过」）
const FIXANCHOR = process.argv.includes('--fixanchor'); // 锚不逐级传递：每键都从显式锚出发（2026-09-22 斩链低级卡重做：锁死骑士身形与剑位，只换特效层）
const DENoiseArg = Number((process.argv.find(a => a.startsWith('--denoise=')) || '').split('=')[1]);
const CHAIN_DENOISE = 0.85; // 级联 img2img 强度：0.6 克隆参考图；0.75 只加碎屑、全链零变化（用户否掉）；
// 0.85 让刀刃/状态/背景/笔触的逐级变身真正发生，构图由参考图+共享句式双锚定
const VAR_DENOISE = 0.8; // 变体级联强度：同一张卡的逐级增强——构图必须锁死（用户：同链路构图要类似），
// 变化交给能量/光效/褪彩——0.72 太保守（褪彩压不过保真，试点几乎零变化），0.8 让后缀显形而构图不漂
let DENOISE = Number.isFinite(DENoiseArg) && DENoiseArg > 0 ? DENoiseArg : CHAIN_DENOISE; // buildWorkflow 实际使用值：--chain=0.85（可 --denoise= 覆盖），--varchain=0.72
// 跨键进阶链（battlePromotesTo 阶梯，斩链）不走独立 txt2img——构图各自漂移、玩家认不出同链；
// 统一由 --chain 级联产出。普通模式跳过这些键（--only 可强制）。
const LADDER_KEYS = new Set(['rockCleave', 'goldCleave', 'mountainCleave', 'seaCleave', 'skyCleave', 'godCleave']);

const KNIGHT = 'a burly knight in muted steel-gray full plate armor with restrained metallic sheen, rounded full-cover helmet of the same steel-gray steel with a thin pale horizontal visor slit, no eyes visible behind the visor, a bright red scarf wrapped around the neck';
const STYLE = 'rough painterly gouache sketch, extremely broad coarse brush strokes, very low completion, chunky polygonal color-block planes, simplified blocky anatomy, strong dramatic lighting with clear light and shadow separation, American comic chiaroscuro, cool light from the upper left, muted colors, rough unfinished sketchy edges, no outlines, minimal detail, atmosphere over detail: the subject reads through silhouette and action posture alone, forms merging into big abstract masses of color and light, details dissolving into shadow and haze, solid pure black background, subject fills the entire frame edge to edge, tight cinematic close-up crop, no text, no border';
const NEGATIVE = 'outline, line art, ink lines, thin lines, cel shading, flat shading, clean vector, anime, cartoon network style, detailed, intricate, fine texture, realistic, photorealistic, photographic, 3d render, smooth airbrush gradients, airbrush rendering, armor panel lines, rivets, glossy, ornate, environment scenery, text, letter, watermark, signature, border, frame, white background, multiple panels, completely empty frame without any subject, emblem, logo, icon, sticker, glowing eyes, luminous pupils, black helmet, dark helmet, extra fingers, six fingers, mutated hand, deformed fingers, shiny chrome, shield, buckler, kite shield, round shield, tower shield, katana, scimitar, curved saber, dao';
// ↑ 2026-09-25 剪影原型落地：删掉 small/tiny subject/distant/wide 禁词（与「小剪影+大现象」
//   构图直接冲突——负词会把新原型的主体整个压掉），换成「完全空框」禁词保底。

// 动作场景表：每键一句「画面主体是什么」。构图原型配额（2026-09-25 用户定，取代「骑士演动作」默认）：
//   骑士当主体曾占 65/204 → 辨识度崩盘。四原型轮转，写 prompt 先选原型再写内容：
//   ① 部位微距（拳/掌/臂甲/靴/盔填满画幅）② 剪影环境（小黑影置于大现象中：血海/护盾泡/火墙/月夜）
//   ③ 动态抽象（速度线/残影/刀光轨迹为主体，无整体人）④ 物件主体（那东西本身：罐/刃/火/刺）
//   骑士全身/半身主体仅保留 6 键「确实帅」的名额（flameHeal/fireWhirl/lastStand/pluckStar/
//   allIn/noonNap）——新增骑士主体须用户点头。等阶分级轴随之升级：不只加元素，
//   可用**饱和度/亮度/密度连续轴**（血色鲜艳度·bloodFist、护盾亮度·psiShield、速度线密度·wildPunch）。
// 武装设定（2026-09-22 用户定）：骑士**无盾**（格挡只靠臂甲）；佩**大剑**（直刃双手巨剑，非刀）。
// 家族色彩锚点（2026-09-22 用户定）：**体修 = 骑士本体 + 大面积黑/灰黑**；**火系 = 橙黄橙红为
// 主体、骑士只占小面积或仅暗示存在（激烈爆裂为视觉锚点）**；**普通卡 = 绿黄蓝等无冷暖倾向的
// 多彩中性色**（既有别于火系，又有别于体修）。骑士不必全脸出镜——只露一只手、或只暗示
// 骑士存在时表现力往往更强。木系绿、风系青为既有家族色，不动。
// **灵能/魏启 = 淡蓝主题**（2026-09-25 用户定）：psiShield 等灵能卡的能量体一律
// pale light blue；魏启水晶/罐本就是蓝系，延续。
// 体修虚无 flavor（2026-09-22 用户定）：体修越高深，内核越「虚无、简单、幻灭、空洞」
// （空形拳/摘星手/断神斩，联动骑士破灭虚无主义者的性格曲线）——S 级与高阶变体倾向
// 低饱和、纯黑白强对比、笔触模糊虚幻；按卡名与意境选择性落实，不一刀切。
const SCENES = [
  // —— 体修大系 ——
  { id: 'fierceFist', prompt: `extreme foreshortening macro: a huge five-fingered steel-gray gauntlet fist filling the entire frame aimed left, knuckles front and center, the arm racing away to a tiny blurred distant body, a thin red scarf line on the distant figure, scale contrast` },
  { id: 'slash', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its plain honest steel blade catching a diagonal edge of light, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, quiet grounded mood` },
  { id: 'duckHead', prompt: 'crossed steel-gray armored vambraces filling the frame raised in guard, solid overlapping steel plates with visible seams, matte metal, no skin, no bare hands, sparks bursting on the plates, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid visible at the frame edge below the crossed arms' },
  { id: 'punch', prompt: `extreme close-up of a steel-gray armored fist held low and coiled: massive faceted knuckle plates like boulders filling the frame, hard cool light from the upper left grazing the plate edges, most of the frame sinking into pure black shadow, a small vivid red scarf fleck at the frame edge, quiet coiled weight, no motion lines, dark background` }, // 2026-09-22 三改：弃软气刷圆拳+卡通放射线，巨石切面语法（对齐 fierceFist 标杆）
  { id: 'focusChant', prompt: `extreme close-up of two steel-gray armored gauntlets pressed together in prayer, a single bright drop of light floating between the palms, the hands filling the entire frame, no helmet in frame, dark background` },
  // —— 体修：拳组合（过牌；骑士本体 + 大面积黑灰） ——
  { id: 'fastPunch', prompt: `dramatic low-angle side view of a steel-gray armored straight punch: the huge gauntlet fist fills the left third of the frame aimed left, massive faceted knuckle plates like boulders catching a hard cool light from the upper left, the armored forearm receding smaller into pure black at the right, one sharp white speed line streaking above the fist, a small vivid red scarf fleck in the dark, extreme scale and weight, dark background` }, // 2026-09-22 二改：弃三节圆筒臂横摆（无体量无光影），巨石切面+前缩+硬光
  { id: 'fullCharge', prompt: 'the same contained charge composition with the knight standing small below a funneling energy stream, the energy modest and plain like stirred dust, a quiet workmanlike casting, clearly low-tier, no brilliance' },
  { id: 'wildPunch', prompt: 'a small stretched black silhouette of a knight leaping through the air mid haymaker strike, the silhouette clearly reading as full plate armor with a rounded helmet outline and armored shoulders, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid whipping behind, violent red and black speed lines storming around him, the silhouette small in frame, berserk momentum' },
  { id: 'wildFlurry', prompt: 'a rain of steel-gray armored gauntlet fists: dozens of blurred plated fists filling the whole frame in rhythmic diagonal rows like falling rain, every fist clearly armored with knuckle plates, no readable body, no skin, no bare hands, storm of blows' },
  { id: 'agileCombo', prompt: `two solid crisp steel-gray gauntlet fists landing a snappy one-two punch in mid-air, both fist shapes clearly readable with knuckles, sharp echo trails behind them, the rest of the frame empty dark, minimal and fast` },
  { id: 'counterDraw', prompt: 'extreme close-up of an open steel-gray armored palm deflecting sideways, plate fingers with visible seams, the redirecting parry with glancing motion lines, a precise counter-catch, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin' },
  { id: 'mimicFist', prompt: `extreme close-up of a steel-gray armored hand shaped into a pouncing beast claw, fingers hooked like a feral paw, imitation-beast form, no helmet in frame, dark background` },
  { id: 'snakeFist', prompt: 'a striking serpent made entirely of flowing pale-white qi energy lunging forward across the frame, its whip-curve body tracing the arc of a straight punch, jaws open at the fist position, ribbon trails dissolving behind it, dark background, pure light-energy serpent, no person, no hands, no scales' },
  { id: 'dragonFist', prompt: `extreme close-up of a steel-gray armored fist rearing upward like a rising dragon's head, the knuckles forming the dragon's brow, ascending coiled motion, no helmet in frame, dark background` },
  { id: 'voidFist', prompt: `extreme close-up of a steel-gray armored open palm held empty and open toward the viewer, the hand and wrist half-dissolved into gray mist, near black and white, hollow void-calm, no helmet in frame, dark background` },
  { id: 'emptyFist', prompt: `extreme close-up of a steel-gray armored open palm in a single still strike, the hand half-dissolved into blank emptiness, stark black and white with hard white rim light, the air cracking around the fingers, no helmet in frame, dark background` },
  { id: 'chargeUp', prompt: `tight close-up of two steel-gray gauntlets pressed together, a compressed knot of crackling energy swelling between the palms, the frame dark around the bright knot` },
  { id: 'endlessCombo', prompt: `a sweeping row of overlapping punch afterimages trailing across the frame, five sequential steel-gray fists blurring one after another in a single flowing barrage, the knight's body a smear of motion behind them, endless combo, dark background` },
  { id: 'instantThousand', prompt: 'a frozen instant: hundreds of desaturated gray armored fist afterimages scattered across the whole frame like a starfield of blows, every phantom clearly a plated gauntlet, near-monochrome, blurred illusory phantom fists everywhere, no skin' },
  { id: 'instantStrike', prompt: `extreme close-up of a steel-gray armored fist landing a flash-fast jab toward the left, sharp motion lines, dark background` },
  { id: 'adrenaline', prompt: `extreme close-up of two steel-gray armored gauntlets: one armored fist slamming into the open armored palm, the psych-up gesture, a sharp white impact burst and motion lines around the clap, red scarf edge at the corner, raw adrenaline, dark background` }, // 2026-09-26 二改：旧部署件是裸拳（盔甲裁定违规），锚死双甲手
  { id: 'crashLanding', prompt: `ground-level view looking up: exactly one small stretched black silhouette dropping out of the dark sky elbow-first, a shockwave ring already cracking the earth beneath it, single figure only, scale contrast` },
  { id: 'elbowMaster', prompt: `extreme heroic close-up of one bent steel-gray armored elbow joint presented to the camera like a legendary trophy weapon, the elbow point filling the frame, polished gleam on the plating, comedic reverence for the boss elbow, no helmet, no face, no body, dark background` },
  { id: 'elbowReturn', prompt: 'extreme close-up of a steel-gray armored elbow thrust skyward in triumph, the joint of solid plate, raised high like a returning champion, dramatic backlight on the armor, overlapping steel plates with visible seams, matte metal, no skin, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid visible at the lower frame edge' },
  { id: 'elbowStrike', prompt: 'extreme close-up of a steel-gray armored elbow mid-swing, the pointed plate joint leading the strike with sharp motion lines, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, no helmet in frame' },
  { id: 'feint', prompt: `two overlapping silhouettes of the same armored knight leaning opposite ways, one solid black and one ghost-gray, a deceptive split-moment frozen` },
  { id: 'fistPress', prompt: 'a rolling horizontal wall of compressed wind advancing across the frame from the right, dust and debris blasting off the ground along its front, embedded in the wall a rank of translucent overlapping afterimage fists of pale white light punching forward in unison, punch-pressure made visible, no solid body, no readable person, no faces' },
  { id: 'hunYuanPlus', prompt: `extreme close-up of two steel-gray palms circling each other in a flowing exchange, one upturned one downturned, a small swirl of air spiraling between them, cyclical motion, dark background` },
  { id: 'leverage', prompt: 'the same swirling disc of pale and dark qi as the taiji family, smaller and calmer at this lower tier, a bright incoming force streak caught and curved gently aside around the swirl, one steel-gray gauntlet at the swirl center turning the force away, soft redirect, no readable face' },
  { id: 'novice', prompt: 'the peerless family composition of a lone knight standing unhurried amid a ring of shattered training posts and broken blades, lower tier: fewer broken posts, fainter strike scars on the ground, the knight calm and grounded, his red scarf the only color' },
  { id: 'wildFist', prompt: `extreme close-up of a steel-gray fist flickering through multiple ghostly phantom hand shapes, ever-changing afterimages of open palm claw and fist overlapping it, the ten-thousand-change fist, dark background` },
  { id: 'voidCard', prompt: `a single blank translucent playing card floating in darkness, its face completely empty, the card's edges dissolving into fading particles, pale dim outline on black, no ghost, no face, no creature, nothingness` },
  // —— 体修：刀组合（卡序；大剑动作族） ——
  // 斩局内进阶链 v3（2026-09-22 用户三轮迭代）：**刀刃当主角、骑士淡化**（半露于画缘，S 级成剪影）；
  // prompt 只写可直接入画的具体景物（不为难 AI 具象化「斩金断石」）；明度/能量严格渐强——
  // 暗钢 → 金火花 → 沙暴 → 碧涛 → 白光 → 泛白，让玩家一眼读出「一重更比一重强」。
  // 链内全部键共享同一取景句式（级联锁构图），每级四轴变身：刀刃形态色泽/背景景物/明度能量/骑士存在感。
  { id: 'rockCleave', prompt: `extreme close-up of a steel-gray armored knight mid downward cleave: the armored arm at the right edge gripping a bright plain steel greatsword extending to the lower-left, the blade stays plain bright steel, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, gray-brown stone chips and rock dust bursting along the blade's swing path, small split rock fragments flying, gritty dusty mood, dark background` }, // 2026-09-22 五改：0.55 低噪 + 围巾强制句——用户判 0.7 版骑士漂移/围巾丢失/形态变化过大
  { id: 'goldCleave', prompt: `extreme close-up of a steel-gray armored knight mid downward cleave: the armored arm at the right edge gripping a bright plain steel greatsword extending to the lower-left, the blade stays plain bright steel and must NOT turn golden, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, a shower of golden-orange sparks and small golden metal shards bursting along the blade's swing path, the gold only in the sparks and shards, warm spark-lit mood, dark background` }, // 削金 = 金在火花屑里，剑身永钢（旧版把刃画金被用户判死）
  { id: 'mountainCleave', prompt: `extreme close-up of a steel-gray armored knight mid downward cleave: the armored arm at the right edge gripping a bright plain steel greatsword extending to the lower-left, the blade stays plain bright steel, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, a massive blast of sand dust and gravel storming outward along the blade's swing path, rock debris flying, violent dusty mood, dark background` },
  { id: 'seaCleave', prompt: `extreme close-up of a steel-gray armored knight mid downward cleave: the armored arm at the right edge gripping a bright plain steel greatsword extending to the lower-left, the blade stays plain bright steel, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, streaming ribbons of pale cool blue seawater with white foam bursting along the blade's swing path, the water clearly blue-toned against the dark, glowing faint cold blue, water parting around the blade edge, cool wet mood, dark background` }, // 六改：加「clearly blue-toned」——v5 白灰水花与摧山尘暴撞色，水系身份=冷蓝
  { id: 'skyCleave', prompt: `extreme close-up of a steel-gray armored knight mid downward cleave: both gauntlets swinging a huge greatsword diagonally across the frame, the blade still plain steel, its swing path tearing the dark sky open in a huge diagonal rift of blinding white light trailing right behind the blade, the light rift as dominant as the blade, red scarf whipping at the frame edge, tight dark close-up, no landscape, dark background` }, // 2026-09-22 二改：「举剑站姿」被用户判构图错——必须是挥斩中途+剑路天裂，链语法=横挥动势
  { id: 'godCleave', prompt: `a colossal arc of void-white fire huge and filling the entire frame, its edge dissolving into drifting sparks of light, a vast radiant figure of pale light collapsing and scattering into ash-like fragments behind the blade, the knight a near-invisible silhouette at the frame edge with only the red scarf vivid, the frame flooding toward white, overwhelming god-slaying mood` },
  { id: 'ironShard', prompt: `a burst of jagged iron shards flying toward the left, sharp crisp metal fragments dominant, the right half of the frame plain dark emptiness, nothing else in frame` },
  { id: 'handCleave', prompt: 'the same wide spinning greatsword flourish composition, the figure now clearly a knight in full steel-gray plate armor with a rounded full-cover helmet and a bright red scarf at the neck, a rising arc of pale petal-shaped light trailing off the blade tip, showy precise swordplay' },
  { id: 'perfectCleave', prompt: 'a greatsword caught at the top of a full flourish, its bright steel blade clearly readable at the center, behind it a complete blooming rose of blade-light: five thick overlapping arc petals of pale white and faint red light forming a flower of steel, petals peeling off the blade tip, dazzling controlled mastery, no person, no hands' },
  { id: 'silverDance', prompt: 'flowing silver blade ribbons tracing an elegant dance pattern across the dark frame, the ribbons the only subject, graceful and deadly, absolutely no person, no figure, no hands' },
  { id: 'graceDance', prompt: 'a steel-gray knight in an elegant flowing blade dance, swinging a plain straight two-handed greatsword with an honest steel blade, its path tracing one smooth continuous ribbon of light in a tall graceful arc, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, rounded full-cover helmet of the same steel-gray steel, no crest, no ridge, no pointed crown, a thin pale horizontal visor slit that stays dark and unlit, no glowing eyes, poised and unhurried' },
  { id: 'cycloneSlash', prompt: 'a steel-gray armored knight spinning in a full-body rotation slash: both gauntlets swinging a straight greatsword extended outward, the blade\'s path drawn as one complete ring of pale blade-light encircling the spinning knight edge to edge, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid whipping around the armored neck, rounded full-cover helmet of the same steel-gray steel, no crest, no ridge, no pointed crown, a thin pale horizontal visor slit that stays dark and unlit, no glowing eyes' }, // 2026-09-26 二改：旧 prompt 只写光环不给主体，AI 每回合往里塞裸男——骑士必须明写
  { id: 'cleave', prompt: 'one huge flat horizontal band of pale blade-light sweeping across the entire frame like a horizon of drawn swords, the band as wide as the frame itself, the dark floor beneath it split along a clean cut line, abstract light streak on black, no character, no weapon, no hands, nothing else exists' },
  { id: 'flyingDagger', prompt: 'a plain throwing knife huge in frame streaking toward the left with a long speed trail, a steel-gray armored gauntlet blurred at the rear edge, no hooded figure, no person, no skin' },
  { id: 'returningDagger', prompt: 'a curved throwing dagger mid-flight huge in frame on a wide boomerang arc, its full circular return path drawn as one thin closed loop of pale light, the bright blade riding the leading edge of the loop, a few sharp sparks trailing, dark background, no person, no hands' },
  { id: 'fineDagger', prompt: 'a single slender throwing dagger standing vertical in extreme close-up, polished bright steel with one subtle fuller line down the blade, a soft cool glint running along its edge, perfectly balanced and still, elegant refined craftsmanship, dark background, no person, no hands' },
  { id: 'perfectDagger', prompt: 'a single plain dagger frozen mid-spin in the air, concentric motion rings around its rotation, a flawless trajectory line, absolutely no person, no hands, no fingers, the dagger alone, dark background' },
  { id: 'storeEdge', prompt: 'extreme close-up of a plain straight greatsword blade being slowly slid back into a simple scabbard, only a sliver of bright edge still visible, concealed sharpness, quiet tension, no katana, no curved blade, no hand grip visible' },
  { id: 'breath', prompt: 'a dark silhouette of a knight seated in a calm meditation stance seen from the side, slow concentric rings of pale white breath-qi expanding outward from his chest in a steady rhythm, three rings visible at different radii, quiet deep breathing, near-monochrome calm, no face visible' },
  { id: 'honeBlade', prompt: 'extreme close-up of a whetstone drawing along a straight greatsword edge, one thin bright line of sparks following the stone, the blade held steady by a steel-gray armored gauntlet, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, tender blade care' },
  { id: 'forgingBlade', prompt: `a hammer striking a glowing hot blade on an anvil, sparks filling the frame, the forge glow the only light, no person readable` },
  { id: 'edgeBreath', prompt: 'a black scabbarded greatsword standing upright on a simple wooden rack in the dark, no blade visible, a thin cold seam of pale light glowing along the sheath mouth, faint tremor lines vibrating in the air around the scabbard, contained killing intent held in check, the sheathed sword dominant, no person, no hands' },
  { id: 'unsheathe', prompt: `extreme close-up of a greatsword mid-draw: the black scabbard mouth huge at the frame edge, half the bright blade already out catching a streak of light, one sharp draw speed line along the steel, dark background` },
  { id: 'whetstone', prompt: `extreme close-up of a whetstone grinding bright sparks off a greatsword edge, steel-gray gauntlets working the stone, no helmet in frame, dark background` },
  { id: 'honeEdge', prompt: `extreme close-up of a steel-gray gauntlet wiping a greatsword's edge with a dark cloth, the wiped line gleaming mirror-bright against the dull steel, a bright gleam streak revealing, no helmet in frame, dark background` },
  { id: 'annihilatingEdge', prompt: `a dark greatsword blade filling the frame diagonally, its edge void-black with a thin pale annihilating rim, the steel swallowing the light around it` },
  { id: 'practiceBlade', prompt: `a wooden training post with a clean diagonal cut through it, the severed top half sliding off mid-fall, sawdust and wood fibers flying, a fading blade-arc afterimage, quiet precise practice cut, no person visible, dark background` },
  { id: 'quickCleave', prompt: `extreme close-up of a greatsword mid-spin whipping in a short snappy arc, strong motion blur on the fast blade, only steel-gray gauntlets on the grip, tight crop, speed lines, no helmet in frame, dark background` },
  { id: 'quickDrawShield', prompt: 'extreme close-up of a plain straight greatsword being whipped horizontally into a flat guard, half-drawn with sharp draw speed lines, the flat of the honest steel blade catching light like a barrier, only steel-gray gauntlets with plate seams, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, no helmet in frame' },
  { id: 'ironRain', prompt: `a rain of jagged iron shards pouring down across the frame, a metallic storm, dark background` },
  { id: 'bladeArt', prompt: 'a dark silhouette of a martial artist mid sword-form, sweeping a plain straight greatsword in a wide flowing arc, the blade trailing a broad ribbon of cold white light with petal-shaped wisps peeling off it, the small disciplined figure against the huge sweeping light arc, dark background, no readable face' },
  { id: 'bladeHeart', prompt: `extreme close-up of a long blade held flat across the chest over the heart, both steel-gray gauntlets cradling it gently, the blade resting against the armor like a cherished heart, quiet devotion, dark background` },
  // —— 体修：拆组合（格挡；防御与姿态） ——
  { id: 'carefulStrike', prompt: `a single steel-gray palm-blade hand in close-up frozen mid-strike, one precise thin targeting line crossing the entire frame, surgical stillness` },
  { id: 'doubleStrike', prompt: 'twin solid steel-gray armored gauntlet fists striking the same point one-two, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, two crisp separate impact bursts side by side, both plated fist shapes clearly readable, tight close crop, nothing else in frame' },
  { id: 'pluckStar', prompt: 'a colossal steel-gray armored gauntlet reaching up from the bottom of the frame against a vast night sky packed with many bright stars, its articulated plate fingers spread wide, one single brilliant star falling into the open palm with a long shining trail, starlight glinting across the armor plates, the star field rich and radiant' },
  { id: 'breakStance', prompt: `a muted steel-gray armored gauntlet fist punching clean through a cracked steel plate filling the frame, fragments bursting outward from the breach, cool neutral gray tones only` },
  { id: 'barrier', prompt: `extreme close-up of two crossed steel-gray vambraces stacked like a fortress wall filling the entire frame, interlocking armor plates like bricks, an immovable bulwark of steel, no helmet in frame, dark background` },
  { id: 'shatterHit', prompt: 'extreme close-up of a steel-gray armored fist punching straight at the camera, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, the knuckle impact bursting with white fracture cracks radiating through the air, the shattering blow frozen at contact, no helmet in frame' },
  { id: 'soulOfWar', prompt: `a steel-gray knight with a pale spectral flame aura rising from his shoulders, ghost-white war-spirit fire licking upward without heat, an otherworldly warrior soul, dark background` },
  { id: 'heavyStomp', prompt: `ground-level macro: a pair of steel-gray armored boots sweeping past the camera in a low arc, dust blasting up in a wide wave, heavy motion blur` },
  { id: 'endure', prompt: 'a knight in full steel-gray plate armor seen from the front in a low wide rooted stance, completely motionless as a heavy incoming blow slams into his raised armored forearm from outside the frame, sparks and debris deflecting off the armor at the point of contact, shoulders sunk absorbing the impact, his bright red scarf at the neck clearly visible and vivid, the braced knight and flying debris dominant in close-up' },
  { id: 'guard', prompt: `extreme close-up of a single steel-gray vambrace filling the frame diagonally, one bright impact spark bursting on the plate` },
  { id: 'defensePrep', prompt: 'extreme close-up of an open steel-gray armored palm raised in a calm catching gesture, plate fingers spread ready to receive a blow, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, quiet defensive preparation, no helmet in frame' },
  { id: 'turtleStance', prompt: `extreme close-up of a steel-gray knight curled into a tight armored ball, knees elbows and helmet interlocked into a rounded shell of plate armor, no face visible, a living turtle shell, dark background` },
  { id: 'divineTurtle', prompt: `a steel-gray knight curled into a tight armored ball, brilliant golden light pouring from every seam between the interlocked plates, a sacred divine turtle shell glowing like a relic, holy radiance flooding the dark, dark background` },
  { id: 'martialStance', prompt: 'the master stance family composition of a knight in a low wide stance on cracked ground with a radiating mandala of cracks around his boots, utterly still, lower tier: the cracks shallower and fewer, a faint pale aura, his red scarf the only color, near-monochrome' },
  { id: 'berserkStance', prompt: 'a steel-gray knight in a berserk head-down charge stance, boots planted wide and skidding, the ground beneath him ripped up and cracking, debris and dust storming upward around his frame, his bright red scarf snapping wild, a faint red haze rising off the shoulders, the smooth dome helmet staying sealed and dark, unleashed fury tearing the frame apart' },
  { id: 'fastRain', prompt: `a steel-gray knight head-and-shoulders leaning hard into motion, rain-like streaks of speed lines pouring diagonally across the whole frame around him, relentless flowing tempo, dark background` },
  { id: 'prepareMove', prompt: 'a dark silhouette of a knight coiled low in a tight pre-strike stance at the center of the frame, weight sunk onto the back leg, thin streams of pale white qi flowing inward toward his chest from every corner of the darkness, the air drawn taut and still, gathered tension one breath before release, the coiled silhouette small against the converging streams' },
  { id: 'rally', prompt: `extreme close-up of a steel-gray gauntlet grabbing its own shoulder pauldron in a limbering warm-up stretch, loosening the joints, small motion tremors, dark background` },
  { id: 'bloodFist', prompt: `extreme close-up of a clenched steel-gray gauntleted arm plunged deep into a sea of blood, the vivid red blood filling two thirds of the frame, dark armor slicing through it, stolen vitality glowing in the liquid` },
  { id: 'powerStance', prompt: 'extreme close-up of two steel-gray armored fists pressed knuckle-to-knuckle in front of the chest, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, force doubling between them, trembling power lines' },
  { id: 'winWithout', prompt: `extreme close-up of a single playing card held up between two armored fingers, the card filling the frame, everything else void dark` },
  { id: 'haveWithout', prompt: `a wide fan of playing cards filling the frame held in one steel-gray gauntlet, the cards dominant, abundance` },
  // —— 火大系（火光映甲） ——
  { id: 'gatherFlame', prompt: `a single huge torch flame roaring upward filling most of the frame, only a steel-gray armored gauntlet visible at the bottom edge holding it aloft, the orange-yellow fire mass dominant, sparks flying` },
  { id: 'emberMote', prompt: `extreme close-up of a glowing charcoal ember chunk cradled in darkness, its bright orange cracks filling the frame with warm light, only the edges of steel-gray gauntlet fingers visible around it` },
  { id: 'fireControl', prompt: `a large serpentine whip of fire arcing across the frame, guided by a single steel-gray gauntlet at the frame edge, the orange fire serpent dominant, embers trailing in its wake` },
  { id: 'fireworks', prompt: `a huge burst of fireworks filling the whole frame, colorful star shells against the black, a tiny distant silhouette far below, scale contrast` },
  { id: 'fireBolt', prompt: 'one single round fire pellet blazing mid-flight toward the left, a compact dense orb of vivid orange fire with a short bright tail, nothing else in frame, exactly one orb, no volley, no second orb, no hand' },
  { id: 'inflame', prompt: `extreme close-up of a steel-gray armored hand snapping its fingers, a small flame just catching on the thumb tip, sparks flying from the snap, dark background` },
  { id: 'fuelTheFire', prompt: `a fierce blaze filling the lower half of the frame, a burning playing card tumbling down into it from above, only the knight's tossing gauntlet at the top edge, flames flaring up` },
  { id: 'playWithFire', prompt: `a steel-gray gauntlet idly twirling a ribbon of flame around one raised finger like a coin trick, playful casual fire manipulation, small fire dancing between the armored fingers, no helmet in frame, dark background` },
  { id: 'allIn', prompt: `${KNIGHT}, arms spread wide as his own cards burst into flame around him, burning card scraps swirling upward, drawing a violent surge of fiery power out of the burning cards, desperate all-in eruption` },
  { id: 'flameBirth', prompt: `a tiny newborn flame cradled in two cupped steel-gray gauntlets, extreme close-up on the small delicate fire, warm glow on the armored fingers, tender scale contrast between huge hands and little flame, dark background` },
  { id: 'flameHeal', prompt: `${KNIGHT}, head tilted up with arms open at his sides as warm golden light pours down over his shoulders and helmet from above, healing glow washing the armor, gentle embers rising` },
  { id: 'highFever', prompt: 'a steel-gray knight hunched forward with head lowered, molten light blasting out from every gap of his armor: chest seams, pauldron joints, gauntlet knuckles and boot plates all leaking blazing orange fire, small flames streaming off his shoulders, heavy heat shimmer warping the whole frame, his red scarf the only cool color, the burning-from-within knight dominant' },
  { id: 'warmUp', prompt: 'many small candle flames floating in a loose ring in the dark, a small steel-gray knight seen from behind standing among them, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid clearly visible from behind, rounded full-cover helmet of the same steel-gray steel, no crest, no ridge, no pointed crown, a thin pale horizontal visor slit that stays dark and unlit, no glowing eyes, the ring of warm flames dominant, tiny bright points everywhere' },
  { id: 'melt', prompt: `a stream of molten metal pouring down through the frame, the bright glowing liquid dominant against the dark, a tilted crucible edge at the top` },
  { id: 'explosiveArt', prompt: `a huge festive fireworks burst filling the entire frame in orange and gold, a small knight silhouette at the bottom edge looking up, the explosion dominant` },
  { id: 'fireWhirl', prompt: `${KNIGHT}, spinning with a tornado of fire around him, the fire whirl wrapping the frame, scarf pulled into the spiral` },
  { id: 'residualHeatPlus', prompt: 'the same resting steel-gray gauntlet after battle, now with a dim orange glow in every plate seam, thin smoke curling up from the joints, small embers drifting off the knuckles, a warm shimmer around the forearm, lingering heat clearly visible' },
  { id: 'fireTemper', prompt: `a forge blaze roaring across the frame, a glowing hot blade held into the fire by tongs, a storm of sparks, only the knight's arm silhouette at the frame edge, the fire and molten glow dominant` },
  { id: 'hotHands', prompt: `close-up of a pair of open steel-gray gauntlets shaking off small dancing flames on the fingers, recoiling heat` },
  { id: 'silence', prompt: `close-up of two steel-gray gauntlets snuffing a single candle flame between them, one last thin smoke wisp rising, the light just dying` },
  { id: 'relief', prompt: 'a huge round riveted iron pressure valve filling the frame, its wheel spun open, a roaring horizontal jet of white steam mixed with orange fire sparks blasting out of its side ports, pressure trembling through the riveted metal, the venting valve and its blast dominant, no person, no hands, no creature' },
  { id: 'kindling', prompt: `extreme close-up of a steel-gray forearm with a cut in the vambrace, blood drops catching small flames mid-air, tiny fires standing on the blood trail` },
  { id: 'fireRain', prompt: `the whole frame streaked with falling fire comets, a tiny silhouette below taking cover under one raised arm, the fire rain dominant` },
  { id: 'firstStrike', prompt: `a flaming dart huge in frame streaking toward the left with a long fire trail, only the knight's extended throwing arm visible at the rear edge, the dart and its trail dominant` },
  { id: 'patience', prompt: `extreme close-up of an upturned steel-gray armored palm, a drop of dark blood on it with a slow dark-red flame rising from the drop, ominous stillness, dark background` },
  { id: 'fireWall', prompt: `a wall of flames filling the frame floor to ceiling, a small dark silhouette standing calm within the blaze, the fire dominant` },
  { id: 'burnBurstPlus', prompt: `two identical mirrored flames drifting apart filling the frame, a single open steel-gray gauntlet between them at the bottom edge, the doubling fire pair dominant` },
  { id: 'willOWisp', prompt: `a pale blue-white ghost flame huge in frame drifting free, cold light washing a hint of steel-gray armor at the frame edge, eerie wisp` },
  { id: 'mirrorBurn', prompt: `a mirror shard held in a steel-gray gauntlet filling the frame, a bright flame blazing inside the reflection, dark all around` },
  { id: 'spark', prompt: 'a scatter of bright orange-white sparks bursting upward against pure black, each a crisp glowing point with a short thin trail, sparse and rhythmic like struck flint, only the flying sparks in frame, no figure, no hands, no objects' },
  { id: 'shock', prompt: 'the same compact detonation with twin shockwave rings and low ground dust, the impact target now a dark jagged boulder bursting into clean angular fragments, no ambiguous creature, fire sparks carried in the wave, no person, no fists' },
  { id: 'magmaArmor', prompt: `extreme close-up of a steel-gray breastplate and pauldron with glowing lava cracks veining the metal, molten orange light in the fissures, helmet cropped out of frame` },
  // —— 火大系补全（橙黄橙红为主体，骑士小面积或仅暗示；爆裂为视觉锚点） ——
  // 火球术系
  { id: 'fireBarrage', prompt: `two roaring fireballs streaking toward the left one behind the other in rapid succession, twin blazing tails, only the knight's throwing gauntlet visible at the rear edge, the paired fireballs dominant` },
  { id: 'greaterFireBall', prompt: 'a large roaring fireball dominating the center of the frame, its surface a roiling vivid orange mass with a bright hot core, a clear margin of dark air kept around it on all sides, a tiny steel-gray knight silhouette at the bottom edge looking up, a large fireball yet far from a sky-filling sun' },
  { id: 'heatChargedBall', prompt: `extreme close-up of a fireball's core turning blinding white-hot, the outer flame still orange, heat distortion rippling off its surface, only a steel-gray gauntlet's fingertips bracing it at the frame edge` },
  // 爆裂术咏唱
  { id: 'qimingBlaze', prompt: `a colossal pillar of heavenly flame descending from above and splitting the frame vertically, blinding white-gold fire, a tiny knight far below at the bottom edge with one gauntlet raised, apocalyptic sky-fire` },
  // 凝焰/燃元/炼心
  { id: 'flameForm', prompt: `a mass of orange flames sculpting itself into a tall humanoid fire figure mid-frame, the fire-body still half swirling flame, no knight in frame, embers orbiting the forming shape` },
  { id: 'emberOrigin', prompt: `extreme close-up of embers melting down and condensing into a single glowing molten-orange crystal core, drips of liquid fire falling into it, a steel-gray gauntlet holding it from below, dark background` },
  { id: 'refineHeart', prompt: `a heart-shaped core of fire suspended mid-frame being compressed by two steel-gray gauntlets, impurities flaking off as dark ash, the flame-heart burning purer and brighter, tight close-up` },
  // 余热/激热/急燃
  { id: 'residualHeatStar', prompt: `a bed of dark dying embers suddenly bursting back into roaring flame, the reignition flash filling the frame, orange fire erupting from the gray ash, no knight in frame` },
  { id: 'heatSurge', prompt: 'a point of flame detonating outward in a sudden radial burst, the flash explosion filling the frame with expanding orange rings, triggered ignition, a steel-gray armored gauntlet with clearly separated plate fingers at the corner edge, no bare skin, no lone finger' },
  { id: 'flashBurn', prompt: `a steel-gray knight igniting head to toe in one sudden flash, the ignition frozen mid-flare, a sheet of fire washing over the whole armor, instant violent combustion` },
  // 焚卡/坟场/蓝引擎散卡
  { id: 'wildfire', prompt: `a wall of grassland fire racing across the entire frame from left to right, low wide flames devouring everything, a storm of sparks ahead of the fireline, no knight in frame` },
  { id: 'ashRake', prompt: `extreme close-up of a steel-gray gauntlet raking through a pile of gray ash, a glowing orange card corner uncovered beneath the ash, faint embers waking, dark background` },
  { id: 'echoingFlames', prompt: `a row of burnt blackened cards along the bottom of the frame each releasing a thin flame that rises and folds back down, layered fire echoes, a steel-gray gauntlet reaching into the rising glow from the top edge` },
  { id: 'lastStand', prompt: `${KNIGHT}, cornered with his back against a dark wall, a fan of burning cards held up in both gauntlets as a last blazing defense, flames between him and the viewer, desperate final stand` },
  { id: 'breakLimit', prompt: `a round pressure gauge shattering with its needle pinned past the red line, flames bursting through the cracked dial, only a steel-gray gauntlet gripping its rim, the breaking point frozen` },
  { id: 'flameDemonPact', prompt: `a huge horned demon silhouette made of fire rising behind a small steel-gray knight, the demon's burning arms spreading wide over him, a pact sealed in flame, the fire-demon dominant` },
  // 烟花三连（升空/单爆是既有 fireworks/explosiveArt；此处=齐射与满天）
  { id: 'fireworkShow', prompt: `a whole barrage of fireworks launching upward in bright arcs from the bottom edge, many simultaneous orange-gold trails filling the frame, a night of continuous celebration, no knight in frame` },
  { id: 'grandNewYear', prompt: `the entire night sky packed with overlapping firework bursts of gold and red, layer upon layer of celebration filling every corner of the frame, a tiny knight silhouette at the bottom edge with both arms raised` },
  // 余烬火种系
  { id: 'sparkSeed', prompt: `extreme close-up of a small seed-shaped ember sprouting a tiny flame like a seedling, glowing cracks on its shell, cradled in a steel-gray gauntlet palm, dark background` },
  { id: 'latentSpark', prompt: `a field of dark cold ash with several dim orange ember points hiding beneath the surface, faint glows waiting to wake, quiet menace, no knight in frame` },
  { id: 'eternalSpark', prompt: `a single small flame burning impossibly bright at the center of darkness, refusing to die, faint ember motes orbiting it in a slow ring, eternal undying fire, no knight in frame` },
  // 热浪/控火系
  { id: 'heatWave', prompt: 'a rolling wall of visible heat distortion blasting toward the left, shimmering air ripples glowing faint orange, the ground below scorched black with scattered embers, a medieval steel-gray armored gauntlet palm pushing at the right edge, simple plate armor, no sci-fi, no powered armor, no tubes, no bare skin' },
  { id: 'burnSnap', prompt: 'a fireball captured at the exact instant of bursting: the left half still a dense compressed sphere, the right half already blown out into a flat fan of flame shards and sparks, the detonation frozen mid-tear, controlled demolition of fire, no person, no hands' },
  { id: 'fireControlDisturb', prompt: `many scattered flames across the frame streaming like iron filings toward a single steel-gray gauntlet at the center, the fires converging and swirling into the palm, gathering motion lines` },
  { id: 'fireControlBurn', prompt: `close-up of a single calm bright flame standing in an open steel-gray palm, the flame the only light source, controlled fire in darkness` },
  { id: 'fireControlRefine', prompt: `a bright orange flame and a black smog mass colliding mid-frame and annihilating each other in white sparks, paired cancellation, a steel-gray gauntlet directing the clash from the bottom edge` },
  { id: 'fireControlScorch', prompt: `extreme close-up of a steel-gray gauntlet fist being dipped and coated in thick clinging flame, fire wrapping the knuckles like fuel, loaded for the next strike, dark background` },
  { id: 'fireControlSupreme', prompt: 'an open steel-gray gauntlet palm-up with a whole court of tiny shaped flames hovering above it, a ring, a serpent, a blade, a bird, every flame bending to one will, supreme mastery, the flames intense vivid orange against deep shadow, a heavy oppressive glow, dominant atmosphere' },
  // 自焚/焰愈/焚烧/镜燃/燃心
  { id: 'redHotBlade', prompt: 'a straight double-edged greatsword blade glowing red-hot from within filling the frame diagonally, heat shimmer rising off the steel, embers dripping from the edge, no curved blade' },
  { id: 'nirvana', prompt: 'a knight kneeling inside a blooming lotus of chunky flame petals, seen from behind at a low angle so the helmet crown reads as one plain smooth dome with no ridge seam, no crest and no pointed crown, muted steel-gray matte plates, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid clearly visible from behind, rebirth from the flames, rough gouache fire petals filling the frame, no glossy highlights, no bright silver' },
  { id: 'burnBurstStar', prompt: `a star-shaped flame erupting in three blinding points, the triple-pronged star fire huge in frame, radiating triple heat waves, only a steel-gray gauntlet at the bottom edge presenting it` },
  { id: 'karmaFire', prompt: `a small dark silhouette as a conduit: fire streaming onto one shoulder and pouring out the other arm toward the left, twin fire streams crossing at the tiny figure, the fire dominant` },
  { id: 'burningHeart', prompt: `a steel-gray knight clutching his chest as fire glows through the seams of his breastplate, the heart burning inside the armor, orange light leaking from every plate gap, tight torso crop` },
  { id: 'absoluteFlame', prompt: `flames frozen mid-flicker like red glass, locked at their peak forever, crystallized fire shards suspended in air, a steel-gray gauntlet touching the frozen flame surface, absolute stillness` },
  { id: 'flameCloak', prompt: `a steel-gray knight seen from behind wearing a long flowing cloak made entirely of fire, the flame-cape billowing wide and filling the frame, embers trailing from its hem, helmet turned slightly left` },
  { id: 'smeltCard', prompt: 'extreme close-up of a plain card melting down in a steel-gray armored gauntlet grip, chunky crude molten drips painted as thick strokes pooling into a simple bright mass below, smelting heat, the card faces completely blank, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, no letters, no symbols' },
  { id: 'douseFlame', prompt: `a burning steel-gray knight doused from above, his flames collapsing into a huge burst of steam, fire dying across the armor, the steam cloud filling the frame` },
  { id: 'expand', prompt: 'a steel-gray knight seen fully from behind with both arms pushed wide apart, the space between his gauntlets swelling with a growing sphere of vivid fire, streams of flame pouring into the swelling sphere from all sides, its surface stretching taut about to burst, the expanding fire sphere dominant, his red scarf vivid' },
  { id: 'fireAffinity', prompt: `a small gentle flame bending down like a bowing figure over an open steel-gray gauntlet, the fire showing favor, a warm intimate glow, quiet blessing, tight close-up` },
  { id: 'fireMastery', prompt: 'concentric rings of fire orbiting a small steel-gray knight seen mostly from behind, each flame ring spinning at a different height, the knight small in frame with matte plates and the knight\'s bright red scarf wrapped at the neck clearly visible and vivid visible from behind, the smooth dome helmet crown plain with no ridge and no crest, mastery of the element, the fire rings filling the frame' },
  { id: 'fireWard', prompt: `a wave of fire splashing against an invisible barrier around a calm steel-gray knight, the flames parting around him like water around a stone, a ward circle traced in light` },
  { id: 'shockCard', prompt: 'an enormous dark shadow of a helmeted knight falling over a small cowering hunched figure pressed flat against the ground, the shadow heavy as a mountain bearing down, the small figure trembling in panic, terror made visible, oppressive dread' },
  // —— 通用灰卡家族（骑士的日常动作） ——
  { id: 'purify', prompt: `a steel-gray armored gauntlet held up in close-up, a soft cascade of pale glowing light pouring over it like a luminous waterfall, black grime and dark smoke dissolving off the metal plates where the light touches, the steel gleaming clean and bright, light made visible, not liquid, no water, brilliant purity, dark background` }, // 2026-09-26 二改：旧版真倒水=洗手梗；纯化改「光之涤荡」
  { id: 'extract', prompt: `a steel-gray armored gauntlet pulling a long taut stream of glowing essence out of a cracked dull gray rock, the stream made of luminous pale vapor, breath made visible, faint green gold and blue shimmer within the light, smoke-like, not liquid, not metal, stretched across the frame, dark background` }, // 2026-09-26 二改：旧版虹彩管=热成像图；萃取改「光雾精华流」
  { id: 'drawQi', prompt: 'thin streams of pale blue breath-light converging from every edge of the frame toward a small dark armored silhouette\'s chest plate at the center, the silhouette clearly a knight in full plate with a rounded helmet outline, no glowing eyes, the visor slit dark, a strong inhaling vortex motion, no book, no objects in hands' },
  { id: 'manaJar', prompt: `extreme close-up of a small round glass potion jar held in a steel-gray gauntlet, bright sapphire-blue glow escaping from the opened mouth, cool blue light on the metal, no helmet in frame` },
  { id: 'stimulant', prompt: 'a vivid muted olive-yellow bolt of energy crackling around a steel-gray armored forearm held across the frame, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin, only the forearm in frame, no face, no body, sharp jolt lines, sudden vigor, not neon' },
  { id: 'psiShield', prompt: `a huge translucent hexagonal energy sphere filling the entire frame like a bubble, glowing pale light blue, a very tiny dark knight silhouette floating small at the center of the sphere, glowing pale-blue hexagon facets across the sphere surface, the sphere is the whole subject, the knight is only a small dark shape inside, nothing held in any hands, no handheld objects, no physical shield, no weapons` },
  { id: 'acrobatics', prompt: `three bright balls — one green, one yellow, one blue — arcing through the air in a juggling loop, a steel-gray gauntlet tossing from the bottom edge, colorful motion trails` },
  { id: 'prePrepared', prompt: `a colorful folded umbrella with green yellow and blue panels planted like a cane, a relaxed small silhouette leaning on it, the umbrella dominant in close-up` },
  { id: 'panpanBread', prompt: `extreme close-up of a small round golden bread loaf resting on a green checkered cloth held in a steel-gray gauntlet, steam rising, cool rim light balancing the warm crust` },
  { id: 'noonNap', prompt: `${KNIGHT}, dozing off sitting bathed in cool blue moonlight, helmet nodding down onto the crossed arms resting on the pommel of his planted greatsword, a crescent moon above, one tiny warm ember glowing beside him` },
  { id: 'holdOut', prompt: 'a rising brick wall filling the lower half of the frame, a small braced silhouette of a knight in full plate armor seen from behind holding the wall steady, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid clearly visible from behind, the smooth dome helmet plain with no ridge and no crest, dust in the air, determined hold' },
  { id: 'instantCooldown', prompt: 'a long straight greatsword blade lying horizontal across the frame, its left half still glowing molten orange-red with heat shimmer, its right half already frost-white with ice crystals creeping along the steel, a sharp frost front sweeping across the blade with steam hissing upward at the boundary, the instant cooldown frozen mid-sweep, no person, no hands' },
  { id: 'murmurChant', prompt: `extreme close-up side profile of a rounded steel-gray helmet with a thin horizontal visor slit, soft glowing rings of sound rippling out from the slit toward the left, dark background` },
  { id: 'expandChant', prompt: `a graceful arc of small glowing chant lights — green, yellow, blue — floating weightless above two upturned steel-gray palms in close-up, no wires, no strings, magical floating motes of light, dark background` },
  { id: 'helicopter', prompt: 'a little toy helicopter with a faded yellow-gray body and desaturated blue-gray blades hovering alone in the dark frame, its rotor blurred mid-spin, faint dust haze swirling beneath it from the rotor wash, muted colors, simple flat shapes, surreal stillness, no person, no hands' },
  // —— 灰卡补全（多彩中性色：蓝绿黄无冷暖倾向；五只魏启罐各自不同构图） ——
  { id: 'manaJarPlus', prompt: `a tall elegant ornate glass vial of swirling sapphire-blue liquid huge and dominant in the frame, held up high by one steel-gray gauntlet entering from the bottom edge, green and yellow light sparkles refracting through the glass, the vial is the whole subject, no helmet, no face, no knight body, dark background` },
  { id: 'manaJarRoyal', prompt: 'an ornate square decanter of deep blue liquid presented flat on two open steel-gray gauntlets, the gauntlets clearly overlapping steel plates with visible seams, the decanter painted in simple flat facets, dull gold label, ceremonial offering pose, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin' },
  { id: 'manaJarLegend', prompt: `an absurdly oversized round glass jug of radiant blue liquid cradled in both steel-gray arms like a baby, its glow flooding the armor with blue, green and yellow light motes floating, tight crop on the huge jug` },
  { id: 'swiftManaJar', prompt: 'a steel-gray knight tilting a small blue-glowing jar to his visor slit and chugging it fast, the visor slit dark with no glowing eyes, blue light only on the jar, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid, motion blur on the tilt, blue light streaking, speed lines, tight profile crop, rounded full-cover helmet of the same steel-gray steel, no crest, no ridge, no pointed crown, a thin pale horizontal visor slit that stays dark and unlit, no glowing eyes' },
  { id: 'swiftManaJarPlus', prompt: 'a wide goblet brimming with luminous blue liquid raised in a toast by a steel-gray armored gauntlet, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid clearly visible at the frame edge, a celebratory splash frozen mid-air, simple flat facets, solid overlapping steel plates with visible plate seams, matte metal, no skin visible, no bare hands, no fabric wraps, no bandages on skin' },
  { id: 'burstStimulant', prompt: 'a muted olive-yellow shockburst filling the frame, radiating rings blasting outward from a small dark armored knight silhouette at the center, the silhouette clearly plate armor with rounded helmet outline, the jolt dominant, not neon, not vivid' },
  { id: 'fullStimulant', prompt: 'close-up of a rough gouache steel-gray breastplate with muted olive-yellow and blue energy lines painted as thick crude strokes across the plates, charge flowing through the armor, chunky flat shapes, no smooth gradients, the knight\'s bright red scarf wrapped at the neck clearly visible and vivid crossing the frame edge at the neck opening' },
  { id: 'piercingShot', prompt: `a single bullet punching clean through a thick steel plate, the through-hole glowing at the edges, debris bursting out the far side, the piercing trajectory drawn as one straight speed line across the frame, no person, no hands, object-only macro` },
  { id: 'pointShot', prompt: `extreme close-up of a single bullet frozen mid-flight with a thin bright trail, a gun muzzle with a small precise flash at the frame edge, dark background, calm deadly accuracy, no person, no hands, object-only macro` },
  { id: 'suppressionFire', prompt: `countless bright bullet trails streaking across the frame in a dense sweeping fan, a cascade of tumbling spent shell casings catching warm light in the foreground, the sheer density of fire conveying a suppressive barrage, dark background, no person, no hands, no weapon visible, only flying bullet trails and casings` },
  // —— Z 状态卡（没有骑士——画那个东西本身，同一风格） ——
  { id: 'badOmen', prompt: `a huge dark question-mark-shaped shadow looming on a black field, faint cold rim light, ominous painterly smog` },
  { id: 'burnWound', prompt: 'a scorched steel-gray breastplate filling the frame alone, a deep glowing burn gash torn across the plates, the cut edges cracked and glowing orange like live embers, thin wisps of small flame rising out of the wound, charred soot around it, no person, no hands' },
  { id: 'dustCloud', prompt: `a billowing blinding dust cloud filling the frame, gray swirling masses, grit in the air` },
  { id: 'inkBlot', prompt: 'a black ink splatter exploding across the frame against the pure dark background, the dark ink rimmed with a thin pale gray edge-light to stay readable, sharp tendril shapes frozen mid-splash, chunky flat masses' },
  { id: 'looseLeaf', prompt: `a single loose paper sheet caught mid-air in a gust, tumbling with motion lines, pale sheet on black` },
  { id: 'sidestep', prompt: `a small dark armored silhouette sliding sideways fast in an evasive lean, strong horizontal speed lines trailing behind it, dust kicking up at the heels, the sideways dodge motion clear and readable, close crop` },
  // —— 特殊 ——
  { id: 'gooCard', prompt: `a dripping goo slime blob monster lunging slightly forward, glossy dark masses with pale drips, crude menace` },
  { id: 'rapidFire', prompt: 'one single large glowing bullet frozen mid-flight toward the left, a thin bright trail behind it, a small muzzle flash hint at the right frame edge, calm deadly single shot, exactly one bullet, no fan, no multiple streaks, no person, no hands' },
  // ==== 2026-10-10 补缺批（38 键：控火衍生/发现三式/火系散/S 卡/刀系/体修/炸弹四色/瑞米诅咒）====
  { id: 'fireControlGather', prompt: 'several small drifting flames being herded mid-air toward one distant dark point at the frame edge, their tails streaming into converging lines like migrating birds, no person' },
  { id: 'fireControlSpread', prompt: 'one central flame bursting apart into a wide side-view fan of scattered orange fire seeds flying toward the left, the fan spread dominant, pure abstract fire particles, absolutely no person, no figure, no face, no hands, no silhouettes' },
  { id: 'fireControlHarvest', prompt: 'a thin stream of orange fire being drawn and twisted into the heart of a small pale blue crystal held in a steel-gray armored gauntlet, fire condensing into light, extreme close-up' },
  { id: 'fireControlShift', prompt: 'one orange flame captured mid-transformation into distinct shapes arranged in a flowing row: a calm curled tongue, then a sharp forward spear-point, then a wide spreading fan, the fire forms flowing into each other like one ribbon of flame folding, tight close-up on the morphing fire, no person, no hands' },
  { id: 'fireControlDetonate', prompt: 'a dense sphere of orange flame compressed tight mid-air, its surface cracking with white-hot fissures straining to burst, thin shockwave rings just beginning to form around it, embers bleeding off its rim, restrained violence one instant before detonation, the strained fire sphere dominant, no person, no hands' },
  { id: 'fireControlFinderAtkC', prompt: 'a condensed lance of brilliant orange fire driving diagonally across the frame like a thrown spear, its tip sharpened to a blazing point bursting with sparks, streaks of flame trailing behind it, aggressive forward violence of controlled fire, no person, no hands' },
  { id: 'fireControlFinderGuardC', prompt: 'a heavy tome with a cracked wax seal opening in cupped steel-gray gauntlets, a calm steady flame rising from the open pages, protective quiet fire, close crop' },
  { id: 'fireControlFinderAcroC', prompt: 'three cards of fire being juggled in a bright arc above an upraised steel-gray gauntlet, the flaming cards spinning in a circle like a circus trick, playful fire play' },
  { id: 'bloodFlame', prompt: 'a dark steel armored knight standing still while hemmed in by a ring of deep blood-red flames licking up around his legs, the deep red fire the only color, tight crop' },
  { id: 'burnOff', prompt: 'a row of plain dark cards held in a steel-gray gauntlet all igniting at once, each card burning down into drifting orange embers, the whole hand turning to ash and sparks, close-up' },
  { id: 'pourOil', prompt: 'a steel-gray armored hand tipping a crude clay oil pot, a glossy stream of oil pouring down and catching fire where it lands, a burning river of oil flowing across the lower frame, the pot and burning stream dominant' },
  { id: 'stackFirewood', prompt: 'a neat stack of rough cut firewood logs filling the lower frame, one small spark of flame just catching on the top log, humble woodpile waiting to burn, tight still life' },
  { id: 'redCloud', prompt: 'a vast low-hanging crimson cloud bank pressing down over the whole frame, dark red vapor mass heavy and ominous, a tiny dark silhouette standing beneath it looking up, the red cloud dominant' },
  { id: 'turbo', prompt: 'a crude rough engine turbine spewing orange flame from its housing, thick mechanical slabs simplified into big shapes, the machine roaring with fire, no person' },
  { id: 'selfImmolateRite', prompt: 'a small dark knight silhouette sitting cross-legged and perfectly still inside a perfect ring of tall steady flames, a solemn ritual, the flame circle dominant and symmetrical, seen from slightly above' },
  { id: 'giantFireball', prompt: 'two cupped steel-gray gauntlets holding one massive fireball swelling between them, the ball core blinding white-hot, its surface roiling vivid orange with tongues of flame dripping off, radiating heat rays and heavy shimmer, searing brightness, extreme close-up' },
  { id: 'heavenFireball', prompt: 'one colossal burning star of white-gold fire hanging low in a dark dawn sky, pale first-light glow at the very bottom edge, a tiny knight silhouette far below raising one arm toward it, the fire star dominant' },
  { id: 'fireWhirlS', prompt: 'a huge ring-shaped hurricane of fire seen from inside the eye, the firestorm band circling the whole frame, a small dark knight silhouette standing at the calm center, overwhelming scale, the fire ring dominant' },
  { id: 'sparkStormS', prompt: 'a dense still field of thousands of tiny glowing orange spark points filling the whole frame like suspended ember dust, every point small crisp and round, points not streaks, no rain lines, no comets, a small lone knight silhouette standing calm at the bottom edge, overwhelming quantity of pure sparks' },
  { id: 'greatSweep', prompt: 'a steel-gray knight in full plate armor mid-sweep swinging a huge trident in a full circle, the trident clearly readable with three prongs, a ring of pale sea-blue light and water spray trailing the sweeping trident head, the ground cracking along the closing ring, his bright red scarf vivid, the sweeping knight dominant' },
  { id: 'reminiscence', prompt: 'an old plain greatsword driven upright into the ground, its worn blade catching one thin line of soft pale light, quiet dust motes in the beam, the old blade dominant, no person' },
  { id: 'homecoming', prompt: 'a small dark knight silhouette with a greatsword on his back walking away down a long empty road toward a faint warm light on the horizon, the long road and vast dark dominant, the figure tiny' },
  { id: 'vacuumBlade', prompt: 'one long plain straight blade slicing across the frame on its own, the air behind it torn open into a long seam of distorted emptiness, the vacuum wake sharper and bolder than the blade itself, abstract motion study, only the blade and the torn seam exist, absolutely no hands, no arms, no body parts, no person' },
  { id: 'vacuumBladeS', prompt: 'exactly five straight parallel glowing lines of pale steel light cutting diagonally across the pure black frame at perfectly even spacing, thin clean strokes of light only, the wide black gaps between the glowing lines are the true subject, an abstract pattern of light and emptiness, the frame contains nothing except these five lines' },
  { id: 'impulse', prompt: 'a burst of plain dark cards streaming toward the viewer with hard speed lines, the card cluster flying fast and loose, aggressive draw momentum, cards dominant' },
  { id: 'transcend', prompt: 'a small dark armored silhouette leaping straight up through a ceiling of pale blue mist, the layer of light shattering around his shoulders as he breaks through, pale blue theme, the breaking barrier dominant' },
  { id: 'block', prompt: 'a knight in full steel-gray plate armor seen from the front in a low wide rooted stance, completely motionless as a heavy incoming blow slams into his crossed armored forearms from outside the frame, sparks and debris deflecting off the armor outward at the point of contact, shoulders sunk absorbing the impact, the crossed vambraces and breastplate dominant in close-up, a bright red scarf at the neck clearly visible and vivid' },
  { id: 'forget', prompt: 'one plain card dissolving into gray smoke from the edges inward, its shape half gone, the remains drifting away as pale mist, quiet erasure, the dissolving card dominant' },
  { id: 'stealTime', prompt: 'a massive ancient bronze clock face hanging in a starless void filling most of the frame, its hands bent and warping, its dark metal surface cracked, a spiral stream of glowing golden time-energy being torn out of the center and siphoned away toward the upper right edge, theft made visible, heavy oppressive presence, no person, no hands' },
  { id: 'redBomb', prompt: 'a round black bomb with a red band, its fuse lit and spitting red sparks, the bomb huge in frame, red the only accent' },
  { id: 'blueBomb', prompt: 'a round black bomb with a blue band and a slow cold blue flame on its fuse, steady patient burn, the bomb huge in frame, blue the only accent' },
  { id: 'blackBomb', prompt: 'a perfectly spherical cast-iron medieval cannonball bomb huge in frame, smooth round black iron with a short fat fuse stub on top, no fins, no tail, no wings, sitting heavy and unlit, silent menace, the round bomb the only subject' },
  { id: 'whiteBomb', prompt: 'a round pale white bomb with a short burnt fuse already snuffed, the pale shell glowing faintly against the black, quiet after-blast' },
  { id: 'distort', prompt: 'the frame itself warping, straight lines bending into a twisting spiral at the center, the distortion pulling everything toward one warped point, sickening warp, no person' },
  { id: 'evilHex', prompt: 'a crude bone-and-talisman charm doll hanging from a cord, jagged little teeth and one glaring red eye bead on it, the ugly charm huge in frame, no person' },
  { id: 'hush', prompt: 'a plain dark card sealed shut under a pressed wax seal, a tight iron chain wrapped once around it, absolute silence and stillness, the sealed card dominant' },
  { id: 'malice', prompt: 'a crude black claw hand snatching one plain card out of the air, gripping too hard, the claw huge and the card small, hostile intent' },
  { id: 'painCurse', prompt: 'one plain card grown over with long sharp black thorns stabbing out of its face, the thorns black and the card pale, pain made physical, the thorned card dominant' },
  // ==== 2026-10-11 拆名批（49 键：异名卡独立美术——变体同构图不算不同图）====
  { id: 'rapidCombo', prompt: 'four steel-gray armored fists in a tight diagonal echelon crossing the frame like linked pistons, each fist mid-strike with short blur trails behind, mechanical rapid rhythm, no readable body' },
  { id: 'stormCombo', prompt: 'a whirling cyclone of steel-gray armored fists orbiting the whole frame, fists storming in a circular gale with streak trails between them, overwhelming combo storm, no readable body' },
  { id: 'bronzeCity', prompt: 'a wall of steel-gray vambraces fused into one solid bulwark filling the frame, every interlocking seam glowing molten bronze, an unbreakable city wall of armor plates, no person, no face' },
  { id: 'berserkMastery', prompt: 'a steel-gray knight standing perfectly still at the center, a berserk storm of dust and debris frozen swirling around him, one gauntlet clenched low at his side holding the rage in, the red haze tamed into a thin calm halo, mastered fury, his red scarf vivid' },
  { id: 'pierceHeart', prompt: 'a steel-gray armored fist having punched clean through a cracked dark breastplate, the gauntlet emerging from the far side gripping a small crushed glowing core, the piercing-through moment frozen, tight crop' },
  { id: 'comboStrike', prompt: 'two steel-gray armored fists striking simultaneously from opposite sides of the frame, converging on one center point, twin impact bursts meeting in the middle, synchronized double blow, no readable body' },
  { id: 'quadrupleHit', prompt: 'the same dynamic circling storm-of-fists composition as the family, exactly four steel-gray armored fists riding the gale at different angles, four impact flashes, a rich dynamic quartet, no readable body' },
  { id: 'powerCleave', prompt: 'a thick double-layered band of pale blade-light sweeping horizontally across the frame, a second echo band trailing behind the first, the dark ground split into two parallel clean cut lines, the light bands clean and solid, no weapon visible, no person' },
  { id: 'riftCleave', prompt: 'the same double-band horizontal cleave composition as the family, the twin bands of blade-light now tearing open a jagged rift of blinding white light along their path, the darkness peeling apart at the cut, sky-splitting atmosphere, no readable body' },
  { id: 'guardStance', prompt: 'the curled armored knight-ball composition of the turtle family, but one steel-gray vambrace extended outward from the shell in a guarding block, a faint pale energy film stretched over the extended arm, mid-tier defensive posture' },
  { id: 'mysticTurtle', prompt: 'the curled armored knight-ball composition of the turtle family, the interlocked plates now glowing with a translucent hexagonal turtle-shell pattern of pale green light, a sacred mystic shell' },
  { id: 'squeezeQi', prompt: 'a steel-gray armored gauntlet clenching a cracked gray orb of qi, wringing it dry, thin streams of pale light squeezed out between the plate fingers like juice, draining every last drop, dark background' },
  { id: 'perfectBlock', prompt: 'a wall of crossed steel vambraces absorbing a colossal incoming blow, the impact light washing over the armor and vanishing without a scratch, a perfect circle of calm air behind the storm of deflected sparks, flawless defense, the knight unmoved' },
  { id: 'fierceElbow', prompt: 'a steel-gray armored elbow smashing sideways through a thick wooden training post, splinters exploding outward from the impact point, violent follow-through, tight crop, no face' },
  { id: 'strongElbow', prompt: 'a steel-gray armored elbow strike cracking deep into a stone slab wall, a heavy fracture web spreading from the point of contact, stone chips flying, devastating force, tight crop' },
  { id: 'pureElbow', prompt: 'one clean blinding white arc of light alone in pure black, the essence of a single elbow strike, one bright star point at the apex of the arc, absolute minimalism, nothing else exists' },
  { id: 'deepExtract', prompt: 'the extract family composition of a gauntlet drawing luminous pale essence out of a cracked gray boulder, mid tier: the essence rope thicker and brighter, the boulder hollowed open' },
  { id: 'limitExtract', prompt: 'the extract family composition of a gauntlet drawing luminous pale essence out of a cracked gray boulder, top tier: a torrent of essence flooding out, the boulder husk crumbling to dust' },
  { id: 'collapseFistS', prompt: 'the fierceFist family composition of an extreme close-up steel-gray armored fist wound far back, the exact same framing now at annihilation scale: the fist vast and dark, the whole ground beneath it splitting into a radial canyon, boulders heaved skyward, the mountain-collapsing final blow' },
  { id: 'fireBall', prompt: 'the exact same single-orb flight composition as the family bolt, the orb slightly larger and denser, a touch hotter with a stronger tail, still one single orb, unmistakably a step above the small bolt' },
  { id: 'fireStream', prompt: 'the fire rain family composition of falling fire comets streaking down across the frame, now a torrential downpour so dense the streaks nearly merge into sheets, yet every comet still individually readable, heavy rain of fire, not a waterfall, a tiny silhouette below taking cover' },
  { id: 'smallBurst', prompt: 'a small raw detonation of orange fire blooming alone in the dark, a hard bright core blasting out a compact spray of cracked flame shards, pure explosive force, no sky, no firework shells, no celebration, the smallest of the burst family' },
  { id: 'karadiaBurst', prompt: 'the burst family raw detonation composition at grandest scale, one colossal explosion of orange fire, layer upon layer of hard bright cores blasting cracked flame shards in every direction, overwhelming concussive force, no sky, no firework shells, no celebration' },
  { id: 'firstArrow', prompt: 'a single blazing fire arrow huge in frame streaking toward the left with a long thin bright tail, a hint of bow limb at the right edge, preemptive swiftness, no person, no hands' },
  { id: 'firstFireBall', prompt: 'one massive fireball launched at point-blank filling the left half of the frame, its launch flash blooming at the right edge, overwhelming preemptive strike, no person, no hands' },
  { id: 'fullSpirit', prompt: 'a dark knight silhouette kneeling still in near-total black, every trace of light in the frame converging into one blinding white point at his clenched fist, spirit condensed to a single spark, stark minimal void' },
  { id: 'veilCleave', prompt: 'a full curtain of white blade-light petals veiling the entire frame edge to edge, only a dark sword hilt shape readable at the center, blinding floral light wall, no person, no readable body' },
  { id: 'heatBallPlus', prompt: 'the same cupped gauntlets presenting a fireball, the ball now vivid orange with a small white-hot core at its heart, mid-tier heat, clearly less white than the hottest form' },
  { id: 'heatBallMaster', prompt: 'a pure incandescent white fireball so bright the frame whites out around it, only a faint orange halo remaining at the rim, thin steam-like heat waves radiating, blinding mastery of heat' },
  { id: 'whirlLeg', prompt: 'a full tornado of dust and debris filling the frame with two steel-gray armored boots whipping around inside the spiral, the spinning kick storm, motion-blurred power, no readable body above the knees' },
  { id: 'whiteFever', prompt: 'the exact same burning-from-within knight composition as the family, every leak of fire now pure blinding white, zero orange anywhere in the frame, the frame washing toward white, his red scarf a faint dark line' },
  { id: 'hunYuanS', prompt: 'two steel-gray gauntlets circling each other at the center of a vast black-and-white swirling vortex filling the whole frame, one palm pale one dark, the monochrome spiral dominant, primordial balance' },
  { id: 'taijiS', prompt: 'the same huge swirling disc of pale and dark qi with incoming force streaks being caught and redirected, the small figure now clearly a knight in full steel-gray plate armor with a rounded helmet and a bright red scarf, soft overcoming hard' },
  { id: 'heavenStance', prompt: 'a steel-gray knight in a low wide master stance on cracked ground, the cracks forming a perfect radiating mandala around his boots, utterly still, near-monochrome, heaven and man as one, his red scarf the only color' },
  { id: 'meltCollapse', prompt: 'a molten pour so heavy the entire lower frame is a lake of liquid glowing metal, the crucible itself sagging and melting into its own pour, everything surrendering to the melt, no person' },
  { id: 'leopardFist', prompt: 'a steel-gray armored hand-form shaped like a striking leopard paw, fingers hooked light and fast, the forearm trailing swift spotted streak shadows, quick predatory grace, hands only, no animal face' },
  { id: 'tigerFist', prompt: 'a massive steel-gray armored fist like a tiger paw smashing down from above, bold dark stripe bands of energy across the forearm, heavy crushing weight, hands only, no animal face' },
  { id: 'peerlessS', prompt: 'a lone steel-gray knight silhouette standing unhurried amid a ring of shattered training posts and broken blades, faint scars of countless strikes crossing the ground around him, his red scarf calm against the near-monochrome ruin, peerless after the storm' },
  { id: 'greaterPsiShield', prompt: 'a wide flat pale light-blue hexagonal barrier pane filling the frame like a wall of glass, a heavy dark blow shattering against its surface into deflected sparks, the calm pane itself unbroken, pale-blue facets, no person, no hands' },
  { id: 'deepPurify', prompt: 'a steel-gray armored gauntlet half-bathed in a falling cascade of white light, one half of the plates already mirror-clean and bright while dark grime still dissolves off the other half, mid-purification, dark background' },
  { id: 'peakPurify', prompt: 'a steel-gray gauntlet held in a single beam of pure white light, the steel turned mirror-bright and crystalline, a clean halo ringing the hand, absolute purity, nothing dark remains' },
  { id: 'goldHotBlade', prompt: 'the exact same red-hot greatsword composition as the family, the inner glow now entirely deep molten gold, heavy golden drips falling from the edge, clearly gold not red' },
  { id: 'whiteHotBlade', prompt: 'the exact same red-hot greatsword composition as the family, the inner glow now entirely blinding white-hot, the edge a single white line of light, clearly white not red' },
  { id: 'shatterHead', prompt: 'a steel-gray armored fist impact frozen at the instant a dark stone helm bursts into a web of cracks and flying fragments, devastating shatter, tight crop, no face' },
  { id: 'doomBlast', prompt: 'the shock family composition of an armored fist-impact detonation with radiating shockwave rings, the same framing at annihilation scale: colossal rings shattering outward filling the whole frame, everything blackened at the edges' },
  { id: 'concealEdge', prompt: 'a plain black scabbard lying flat in near-total darkness, one bright cold line of light tracing its full seam, the scabbard silhouette clearly readable against the dark, contained lethality legible at a glance' },
  { id: 'rainFist', prompt: 'a steep diagonal rain of steel-gray armored fists falling like heavy rain streaks across the frame, long blur trails behind each fist, rhythmic downpour of blows, no readable body, no bare hands' },
  { id: 'thousandHands', prompt: 'the myriad family composition of dissolving armored fist ghosts filling the frame, this tier with fewer and more distinct fists, a readable hundred rather than an uncountable mist, near-monochrome' },
  { id: 'myriadHands', prompt: 'the whole frame filled edge to edge with a gray mist of countless dissolving armored fist ghosts, hands fading into fog in every direction, overwhelming myriad, near-monochrome, no readable body' },
];

// —— 等阶增强后缀（--variants）：按绝对等阶索引分级（1=C … 4=S），跨系列同阶同强度口径 ——
const ESCALATION = {
  1: ', the same action, slightly stronger: a touch more energy and glow, a wider motion',
  2: ', the same action, clearly stronger: more intense energy, brighter glow, wider stronger motion, heightened drama',
  3: ', the same action, much stronger: blazing bright energy, large sweeping motion, sparks and debris flying',
  4: ', the same action at overwhelming ultimate power: massive erupting energy, huge blazing arcs, storm of sparks and debris filling the frame',
};

// 构图级升维档（2026-09-25 四轮实测定）：升维要求是「构图本身变」（成排残影拳/满框蒸汽/
// 近乎消散）时，img2img 的 0.8 保真被基图锚死、多轮全败——命中的档位免参考 txt2img 直出。
// prompt 铁律：**绝对数量词做主语**（six fists / hundreds of sparks），不写「两只拳+更多」
// 这类锚定基图数量的措辞（四轮全败的根因之一）。
const T2I_TIERS = {
  'agileCombo-2': 'a diagonal row of six separate solid steel-gray armored gauntlet fists marching across the dark frame, each gauntlet crisp and readable with knuckles, short motion blur trails behind, quick rhythmic combo energy',
  'agileCombo-3': 'a long row of nine separate glowing steel-gray armored gauntlet fists sweeping across the entire frame from corner to corner, sharp speed lines between them, storm of rapid strikes',
  'relief-3': 'a colossal wall of white steam erupting sideways and filling the entire frame edge to edge, dense billowing vapor textures, a tiny round pressure valve barely visible at the bottom corner, no creature, no face, no figure, pure steam only',
  'spark-2': 'a dense upward fountain of dozens of bright orange sparks bursting from a single point at the bottom center, each spark a crisp glowing dot with a thin arc trail, the fountain filling the middle of the frame, no figure, no hands, no objects',
  'spark-3': 'an overwhelming flood of hundreds of blazing orange sparks filling the entire frame edge to edge in layered waves, every spark a bright point with a short streak, blinding density, no figure, no hands, no objects',
  // 真拳 S（2026-09-22）：「拳化纯白炽影」是本质级变身，i2i 0.8 保真四轮全灭 → 免参考直出。
  'fastPunch-4': 'dramatic side-view straight punch: a huge gauntlet fist filling the left third has become pure light — the fist a blinding pure-white silhouette with hard white rim light, massive faceted knuckle boulders dissolving into the glare, the steel-gray armored forearm receding into near-black at the right with harsh contrast, a thin red scarf edge at the frame corner as the sole spot of color, pure void-calm, a few essential blurred strokes',
};
// 体修虚无后缀（2026-09-22 用户定）：体修越高深越「虚无、简单、幻灭」——这些链的高阶变体
// 不再「更亮更爆」，而是色彩流失、笔触虚幻、趋近黑白（红围巾作唯一残色）。优先级最高。
const ESCALATION_VOID = {
  fastPunch: { // 快拳(B)→炮拳(A)→真拳(S)：灰甲底无彩可褪，褪彩轴读不出进阶（2026-09-22 用户：
    // 三阶看不出升级感）——改走「炮击实感 → 至简白炽」轴：A 点名冲击波环/火花（构图不动），
    // S 把拳本身烧成纯白炽影、甲与背景沉黑（虚无仍在，但一眼终极）。
    3: ', the same straight punch now landing with cannon impact: a bright shockwave ring bursting right at the knuckles, sharp sparks and streaks blasting off the fist, wider stronger speed lines, heightened drama',
    4: ', the same straight punch ascended to pure void: the fist itself become a blinding pure-white silhouette of light, armor and background sunk to near-black with harsh contrast, the form reduced to a few essential strokes, pure void-calm, the red scarf the sole spot of color',
  },
  fullCharge: {
    2: ', the same contained charge, the vortex wider and faster, the ground cracks spreading further, faint white glow at his seams',
    3: ', the same stance, a blinding vortex filling the whole frame above the tiny still knight, all light pouring into him',
  },
  wildFlurry: { // 乱拳(C)→雨拳(B)→千手(A)→万手(S)：万手归一、一片空茫
    2: ', the same rain of fists, clearly twice as many fists in denser tighter rows, colder gray tone, faster blur',
    3: ', the same rain, three times the fists filling every corner of the frame, the fists dissolving into gray mist streaks, color draining away',
    4: ', the same rain dissolved into a pale gray storm of thousands of fists, stark monochrome, only a faint red streak left of color',
  },
  martialStance: { // 武术姿态(C)→大师姿态(B)→天一姿态(A)：天人合一、返璞
    2: ', the same stance, ground cracks spreading under the boots, a faint pale aura of mastery rising around the greaves, the colors muting',
    3: ', the same stance in stark black and white, heaven and man as one, the form simplified to essential blurred strokes, the red scarf the only color',
  },
};
// 按键定制后缀：通用 ESCALATION「more intense energy」在安静的体修微距/生活场景上读不动
// （0.8 保真压过模糊措辞——试点实测近半键进阶不可读），凡此皆进本表。
// 铁律：后缀必须**点名新增可视元素**（裂纹/尘土/光膜/残影/血珠……），不许只写「更强更亮」。
const ESCALATION_CUSTOM = {
  // —— 体修微距（2026-09-22 变体评审首轮失败键返工：构图轴已锁，进阶靠具体新元素） ——
  agileCombo: { // 敏捷连击(C)→疾速连击(B)→暴风连击(A)：残影逐级增多
    2: ', the same scene but now MANY fists: five or six separate glowing fists repeating in a diagonal row across the frame',
    3: ', the same scene but now a whole row of nine separate glowing fists marching across the frame, sharp speed lines',
  },
  counterDraw: { // 拆招(C)→B→A：拨劲逐级加重（审计 B 反而比 C 弱——点名新元素）
    2: ', the same deflecting palm, the parry now with two sharp glancing motion lines and a bright catch spark at the fingertips, harder faster redirect',
    3: ', the same palm, three bright glancing lines and a violent burst of caught sparks deflecting off the fingertips, a small shockwave ring at the catch point, the strongest counter',
  },
  barrier: { // 壁垒(C)→堡垒(B)→铜城(A)：铜城 = 铜辉能量壳
    2: ', the same fortress wall of vambraces, a pale-blue energy shimmer now glazing the plates with faint glowing seams between the interlocking plates',
    3: ', the same armored wall enclosed in a bright bronze-glowing energy shell, glowing seams between the plates',
  },
  berserkStance: {
    3: ', the same charging knight, the ground erupting completely beneath him, a full debris storm filling the frame, the red haze blazing brighter',
  },
  bloodFist: { // 血拳(B)→血拳(A)：血更盛
    3: ', the same blood sea, the blood a screaming vivid crimson flooding almost the whole frame, glowing with stolen life, the arm plunged to the shoulder, bright vitality light streaming up the arm',
  },
  defensePrep: { // 防御准备(C)→守护姿态(B)→玄龟姿态(A)：玄龟 = 六边龟甲光膜；头盔必须在（首轮出过裸脸）
    2: ', the same overhead open-palm catch, a faint pale energy film now shimmering above the palm with small dust motes settling on it, helmet on, no visible face',
    3: ', the same pose, the energy film hardened into a translucent turtle-shell pattern of glowing hexes above the palm, helmet on, visor in shadow, no visible face',
  },
  endure: {
    2: ', the same braced knight, the impact debris far denser, a second heavier spark burst bursting on the plate, the stance still unmoved',
  },
  fistPress: {
    2: ', the same wind wall, denser and taller, clearly more afterimage fists embedded in the wall, heavier dust',
    3: ', the same wall, a towering storm of pale fist afterimages filling the whole frame, the pressure front cracking the ground as it advances',
  },
  guard: { // 盾(C)→坚固盾(B)→强化盾(A)：臂甲逐级硬化发光
    2: ', the same vambrace, a bigger brighter impact spark bursting on the plate, a faint steel-blue sheen hardening',
    3: ', the same vambrace, a blazing impact burst and a reinforced glowing rim on the steel',
  },
  hunYuanPlus: { // 变招(B)→混元(A)→混元(S)：混元归虚
    3: ', the same circling palms, a bright swirl of pale and dark mist spiraling between the hands',
    4: ', the same circling palms, the spiral now a vast bright white-and-black vortex filling the frame behind the hands, stark monochrome contrast, the forms simplified to blurred essential strokes',
  },
  mimicFist: { // 仿形拳(C)→豹形拳(B)→虎形拳(A)：手形生爪（只画手，不许出兽脸）
    2: ', the same beast-claw hand, the claws now clearly sharper and longer, faint leopard-spot energy patterns glowing on the knuckle plates, hands only, no animal, no creature face',
    3: ', the same cluster, the claws longer and heavier like a tiger claw, more phantom hands, fiercer, hands only, no animal, no creature face',
  },
  novice: {
    2: ', the same slab, the perfect hole now rimmed with a thin gleam of precision, faint straight score lines marking the strike',
    3: ', the same slab with three identical perfect holes in a flawless diagonal row, absolute control',
  },
  powerStance: { // 架势(B)→架势(A)：拳压出冲击环
    3: ', the same pressed knuckles, bright white energy arcs snapping between the two fists, a shockwave ring and dust burst radiating outward, the armor straining and glowing at the seams',
  },
  prepareMove: {
    2: ', the same coiled silhouette, the converging qi streams thicker and brighter, small dust lifting around his boots',
    3: ', the same stance, the streams a roaring vortex of pale qi circling the figure, the ground trembling',
  },
  rally: { // 活动筋骨(C)→B→A：掸尘松甲
    2: ', the same shoulder stretch, small motion lines and dust shaking off the armor',
    3: ', the same stretch, the armor glowing warm at the seams, dust bursting off the plates, full limbered readiness',
  },
  shatterHit: { // 碎击(C)→碎骨(B)→碎头(A)：裂纹星逐级爆碎
    2: ', the same crack-starred fist, the cracks spreading wider, fragments beginning to flake off the impact point',
    3: ', the same fist, the impact surface exploding into flying shards, the crack-star bursting across the whole frame',
  },
  wildPunch: { // 狂拳(C)→B→A：自伤溅血、挥势更狂
    2: ', the same leaping silhouette, the red and black speed lines far denser and more violent',
    3: ', the same silhouette, the speed lines a screaming red-black storm tearing across the whole frame',
  },
  // —— 刀系/肘系/杂项（同批返工） ——
  annihilatingEdge: { // 斩灭(A)→斩灭(S)：刃口噬光（首轮「drinking the light」语义太玄，构图漂了——改死锚 pose）
    4: ', the exact same dark blade now vast enough to span the whole frame corner to corner, its void-black edge rimmed in bright annihilating pale light, the background crushed to pure black',
  },
  breath: {
    2: ', the same seated silhouette, the breath rings brighter and wider, a faint calm glow at the chest center',
    3: ', the same figure, one long perfect ring of pale light expanding slow and far, near-still total calm',
  },
  cleave: { // 横劈(C)→强力劈(B)→裂空劈(A)：裂空 = 劈开空气
    2: ', the same flat arc, a wider thicker brighter blade-trail, the air visibly splitting with a rip of light behind the edge',
    3: ', the same arc, a huge splitting arc tearing the whole frame open along its path, debris flung',
  },
  cycloneSlash: { // 回旋斩(C/B/A)：环爆、双环
    2: ', the same spinning armored knight inside the same ring of blade-light, the steel circle brighter, sparks streaming off the rim',
    3: ', the same spinning knight, feet planted wide in a low balanced stance, torso upright and controlled, a blazing double circle of blade-light sweeping around the knight at arms length outside the body, nothing passing through the knight, the greatsword gripped firmly in one gauntlet, clear depth between the light ring and the armor, sparks storming outward',
  },
  edgeBreath: {
    2: ', the same sheathed sword, the seam of cold light brighter, the tremor lines denser around the scabbard',
    3: ', the same sword, the sheath mouth cracking open with a blade of cold white light leaking out, the air shrieking with contained threat',
  },
  elbowMaster: { // 牢大(B)→牢大(A)：喜剧系——肘尖高光星
    3: ', the same heroic elbow display, the elbow point gleaming with a heroic four-point shine star, confident polish',
  },
  elbowReturn: { // 牢大归来(B)→A：更高更傲
    3: ', the same elbow thrust skyward, a triumphant four-point shine star blazing bright on the elbow point, warm rim light on the armor, the pose higher and prouder',
  },
  elbowStrike: { // 肘击(C)→猛烈(B)→强大(A)→纯粹(S)：S「纯粹」归简（喜剧系的简不是虚无，是干净）
    2: ', the same elbow swing, heavier motion blur, a small shock ring bursting at the impact point',
    3: ', the same swing, a big bright shock ring bursting at the elbow point, dust blasting off, heavy motion blur',
    4: ', the same elbow purified to essence: one clean blinding white arc of the swing frozen crisp against stark black, a single bright star at the elbow point, minimal and perfect',
  },
  fastRain: { // 快如雨(C)→疾如风(B)→疾如风(A)：雨成风暴（A 剪影必须仍可读）
    2: ', the same leaning figure, the rain streaks clearly denser and sharper, the scarf whipping, wind spray off the pauldrons',
    3: ', the same head-and-shoulders figure still clearly readable, a denser storm of wind-driven streaks lashing the whole frame around it, sharper faster rain, motion blur only on the streaks not the figure',
  },
  feint: { // 假动作(C→B→A)：影分身逐级凝实
    2: ', the same two silhouettes, the ghost double now clearly more solid, motion-split streaks stretching between the two bodies, harder to tell apart',
    3: ', the same pair, the ghost double fully materialized with its own red scarf line, two indistinguishable silhouettes',
  },
  flyingDagger: { // 飞刀(C/B)→绝灭飞刀(A)：刀尾光轨
    2: ', the same throwing knife, a long bright speed trail now stretching across the whole frame, the knife blurred with speed',
    3: ', the same knife, a screaming triple-bright trail with a spark wake, the tip glowing white-hot, annihilating momentum',
  },
  handCleave: {
    2: ', the same flourish, more light petals peeling off the blade tip, the petal arc wider and brighter',
    3: ', the same spin, a full storm of white light petals whirling around the blade, the whole frame flowing with petals',
  },
  haveWithout: { // 以有胜无(B)→A：牌更盛
    3: ', the same card fan, the cards glowing with a confident bright rim, more cards fanned, abundance',
  },
  honeBlade: { // 养刀术(C→B→A)：刃口觉醒
    2: ', the same blade care, fine bright sparks shimmering along the freshly wiped edge, a warmer glow on the steel',
    3: ', the same pose, the blade fully awakened: a keen bright edge, light running along the steel',
  },
  melt: { // 熔流：更沸更溅
    3: ', the same pour, a far larger molten pool below, the stream twice as thick, violent splashes and bright sparks everywhere',
  },
  ironRain: { // 铁雨(B)→铁雨(A)：碎铁成洪
    3: ', the same iron rain, a torrential storm of shards filling the whole frame, each shard catching bright hot-orange glints',
  },
  quickCleave: { // 快速花刀(C→B→A)：刀弧残影成倍
    2: ', the same quick flourish, clearly two blurred arc echoes now trailing the blade, faster motion streaks',
    3: ', the same flourish, a fan of three bright arc echoes plus a sharp spark burst, lightning-quick',
  },
  silverDance: { // 刀舞(B)→风暴刀舞(A)：银弧成暴
    3: ', the same ribbons, the silver trails multiplying into a storm of dancing arcs, blades everywhere',
  },
  storeEdge: { // 收刃(C)→潜锋(B)→藏锋(A)：越藏越深、杀气越敛（审计：越阶越暗倒挂——藏得深但光要漏出来）
    2: ', the same sheathing motion, the blade sliding deeper, a cold bright gleam now leaking from the sheath mouth, hidden menace',
    3: ', the same sheath almost fully closed, one sliver of blinding white steel at the mouth, the air around the sheath trembling with contained threat',
  },
  whetstone: { // 砺刀(C)→磨锋(B)→展锐(A)：展锐 = 锋芒毕露
    2: ', the same whetting, a clear long fan of sparks now flying off the stone, the edge catching light',
    3: ', the same stone, the honed edge flashing razor-bright, a keen line of light on the steel, sparks flying',
  },
  winWithout: { // 以无胜有(B)→A：唯一牌更亮
    3: ', the same single held card, its blank face now rimmed in bright confident light, a radiant outline against the emptiness, decisive minimalism',
  },
  psiShield: { // 灵能屏障：两层屏障显形（两轮「更大更亮」都读不出——屏障已大，加新层）
    2: ', the same pale light blue hexagon sphere, now with a second outer hexagon shell blazing bright around it, double barrier, light-blue facets filling the frame, the tiny silhouette inside completely empty-handed with arms at its sides, no shield, no staff, no objects anywhere',
  },
  relief: { // 泄压：蒸汽逐猛（roaring 会人格化成兽脸——禁词）
    1: ', the same valve, a wider steam blast',
    2: ', the same valve fully wrenched open, a huge white steam blast flooding half the frame, no creature, no face',
    3: ', the same pose, a colossal white steam explosion filling the entire frame edge to edge, nothing else visible, no creature, no face',
  },
  silence: { // 灭烛：烟缕逐多、暗逐深（审计 B 火苗全旺像点烛——B 必须是熄灭中）
    1: ', the same snuffing, the smoke wisp curling higher, the dark deeper',
    2: ', the same gauntlets pinching a candle wick with the flame just dying between the fingers, a fat smoke wisp curling up, two snuffed candle stumps beside',
    3: ', the same gauntlets, three just-snuffed candle stumps in a row, smoke ribbons braiding upward, near-total dark',
  },
  warmUp: { // 烛环：烛环逐盛
    1: ', the same candle ring, more small flames joining, more bright points',
    2: ', the same ring, a denser circle of warm flames, brighter glow on his back',
    3: ', the same knight, a grand blazing circle of candle flames all around, his silhouette washed in warm light',
  },
  // —— 构图原型重写键的后缀补齐（2026-09-25，防泛用后缀在新原型上再次不可读） ——
  fierceFist: { // 猛拳→轰拳→崩拳：冲击环逐级增爆
    2: ', the same giant fist, a harder brighter impact ring on the knuckles, the distant figure charging closer',
    3: ', the same giant fist, a massive shockwave ring around the knuckles, debris flying, overwhelming force',
  },
  chargeUp: { // 蓄力：掌间能量团逐级膨胀
    2: ', the same pressed gauntlets, the energy knot swelling larger, brighter crackle',
    3: ', the same gauntlets, the knot straining into a blinding compressed sphere, arcs leaping off it',
  },
  heavyStomp: { // 扫堂腿→旋风腿：尘浪逐级成暴
    2: ', the same sweeping boots, a wider dust wave with kicked-up pebbles clearly visible, deeper motion blur',
    3: ', the same boots, a roaring dust wave crashing across the frame, debris blasted up',
    4: ', the same boots now spinning into a full cyclone: a ring of dust and debris circling the whole frame, both boots kicking outward, a whirlwind storm',
  },
  duckHead: { // 抱头→格挡→完美格挡：臂甲墙上火花逐级成暴、终阶吸能生辉
    2: ', the same wall of crossed vambraces, a hard bright spark burst on the plates with a faint shock ring',
    3: ', the same wall, a furious storm of sparks and impact flashes across both plates',
    4: ', the same wall, the armor blazing with absorbed impact light, unbreakable, sparks everywhere',
  },
  breakStance: { // 破势→解体→贯心：破板逐级碎透
    2: ', the same fist, punching deeper through the cracked plate, more fragments bursting',
    3: ', the same fist smashing the plate clean apart, the whole frame cracking apart with it',
  },
  carefulStrike: { // 精准一击→折杨手→揽云手：瞄准线逐级会聚
    2: ', the same palm-blade, two targeting lines crossing at the strike point',
    3: ', the same palm, three precise targeting lines converging, the strike point glinting',
  },
  shock: {
    2: ', the same detonation, double the rings, more fire sparks carried in the wave',
    3: ', the same blast, a colossal ring storm flooding the whole frame, everything torn outward',
  },
  forgingBlade: { // 锻刀术：锻花逐级成瀑（刀坯本体必须显形）
    2: ', the same forge strike, the glowing hot blade on the anvil clearly brighter orange, a wide fan of sparks bursting',
    3: ', the same strike, the hot blade blazing white-hot on the anvil, a huge spray of forge sparks flooding the whole frame',
  },
  fireworks: { // 烟花：礼花逐级满开
    2: ', the same burst, twice as many colorful shells blooming across the sky',
    3: ', the same scene, a sky-filling festival of fireworks in every corner, color flooding the frame edge to edge',
  },
  residualHeatPlus: { // 余热+：余烬复燃
    3: ', the same gauntlet, the drifting embers now rekindled into a ring of small flames around the forearm, orange glow clearly rising',
  },
  hotHands: { // 烫手：指火逐级成焰
    2: ', the same gauntlets, more flames dancing on the fingers, brighter',
    3: ', the same gauntlets, both hands fully ablaze, fire being shaken off in roaring licks',
  },
  fireRain: { // 火雨→火瀑：流星逐级成暴
    2: ', the same scene, twice as many fire comets streaking down',
    3: ', the same scene, a dense blazing meteor storm, the whole sky raining fire',
  },
  fireWall: { // 火墙：火墙逐级成炼狱
    2: ', the same fire wall, taller and fiercer, more intense orange',
    3: ', the same wall, a roaring inferno filling the whole frame, the silhouette calm inside the blaze',
  },
  spark: {
    2: ', the same spark burst, twice as many bright points flying higher, the trails longer and brighter',
    3: ', the same burst, an overwhelming storm of sparks flooding the whole frame, every corner blazing',
  },
  redHotBlade: { // 红热刃：刃温逐级至白热（审计 A 反而暗——白热必须更亮）
    2: ', the same blade, hotter: brighter red glow, heavier heat shimmer',
    3: ', the same blade near-molten: a blinding white-hot edge line burning over deep red steel, embers streaming off, heat shimmer raging',
  },

  // —— 安静/生活场景（「更丰盈/更深沉」分级） ——
  fireControlBurn: { // 控火术：燃(C)→散(B)→爆(A)：散=火星飞散、爆=喷爆发作
    2: ', the same palm flame scattering into a spray of bright embers streaming off the hand',
    3: ', the same palm flame erupting into a violent bright blast, embers storming',
  },
  flameHeal: { // 焰愈(C)→炽愈(B)→浴火(A)：A = 火焰如水流淌全身
    2: ', the same kneeling pose, the warm light column widening, small flames kindling along his shoulders and arms',
    3: ', the same kneeling figure bathed in fire: flames washing over his whole body like water, a roaring warm blaze, unburned and serene',
  },
  kindling: { // 可燃血液(C→B→A)：血焰沿臂蔓延
    2: ', the same wrist, three small bright flames now standing on the blood trail, the blood drops glowing',
    3: ', the same arm, the kindled blood flame roaring up along the vambrace, bright fire wrapping the forearm',
  },
  manaJar: {
    1: ', the same jar, the blue glow escaping a little brighter, a wisp of light rising',
    2: ', the same jar, bright sapphire-blue glow pouring from the mouth, light wisps swirling',
    3: ', the same jar, radiant blue light bursting from the mouth, brilliant wisps swirling around',
    4: ', the same jar, a dazzling geyser of sapphire light erupting from the mouth, the frame flooded with blue glow',
  },
  panpanBread: {
    1: ', the same bread on its cloth, a little larger and fresher, more steam rising',
    2: ', the same bread on its cloth, bigger with a deeper golden crust, generous steam',
    3: ', the same bread on its cloth, a huge fragrant feast-sized loaf, lavish steam, festive warmth',
  },
  noonNap: {
    1: ', the same dozing scene, the cool moonlight a little deeper, the tiny ember glowing softly',
    2: ', the same dozing scene, deeper blue night, a brighter crescent moon, the small warm ember at his side',
    3: ', the same dozing pose, a grand glowing crescent moon huge in the frame above him, the knight softly haloed in moonlight, the ember warmer',
  },
  murmurChant: {
    1: ', the same whisper, the sound ripples a little clearer and brighter',
    2: ', the same whisper, two more vivid glowing sound rings rippling farther out, a brighter halo at the visor slit',
  },
  patience: {
    2: ', the same upturned palm, the dark-red flame taller and clearly brighter, a second blood drop mid-fall catching fire',
    3: ', the same upturned palm, the dark-red flame raging high, blood dripping, an ominous blaze',
  },
  willOWisp: {
    3: ', the same ghost flame grown huge and blazing, filling most of the frame, cold blue-white light washing the armor edge, wisps of cold mist trailing',
  },
  extract: {
    2: ', the same pull, the luminous vapor stream thicker and brighter, more pale light billowing out of the cracking rock',
    3: ', the same pull, a torrent of pale glowing essence erupting from the rock, the light flooding the frame',
  },
  adrenaline: { // 肾上腺素(B)→(A)：爆发更烈
    3: ', the same double-gauntlet clap, the white impact burst bigger, sharper spikes of light radiating outward',
  },
  drawQi: {
    2: ', the same inhale, the pale blue streams thicker and brighter, clearly more streams rushing in from farther away',
    3: ', the same inhale, a vortex storm of pale blue light converging from every direction, the silhouette chest glowing as it fills',
  },
  purify: {
    2: ', the same gauntlet, a wider cascade of pale light pouring over it, more grime and smoke dissolving off the plates',
    3: ', the same gauntlet, a brilliant torrent of white light flooding over it, every plate gleaming, total purity',
  },
  stimulant: {
    2: ', the same jolt, the yellow-green energy crackling louder across the whole arm',
    3: ', the same jolt, a roaring yellow-green charge wrapping the arm, energy arcs leaping outward',
  },
  expandChant: {
    4: ', the same palms, now two full rows of bright chant lights floating in wide arcs above the hands — green, yellow, blue and more — a constellation of colorful glows filling the upper frame',
  },
  prePrepared: {
    1: ', the same leaning armored figure with the same colorful umbrella, a subtle glint of readiness',
    2: ', the same leaning armored figure with the same colorful umbrella, a confident aura, the umbrella gleaming',
    3: ', the same armored figure with the same colorful umbrella now glowing with a bright confident energy rim, the canopy larger and gleaming, planted firm like a sword',
  },
  holdOut: {
    1: ', the same braced figure, the wall clearly higher',
    2: ', the same figure, the wall twice as tall with rubble and dust cascading down',
    3: ', the same figure braced behind a towering brick bulwark filling the frame, debris flying',
  },
  // —— 2026-09-22 全链审计返工：原本无定制条目（泛用后缀不可读）或倒挂的火系键 ——
  ashRake: { // 扒灰(C)→B→A：B 档断档
    2: ', the same raking, the glowing card corner now half-uncovered and clearly brighter, embers waking across the ash',
  },
  burnSnap: {
    3: ', the same instant of burst, the flame shard fan twice as wide, sparks storming to every corner',
  },
  echoingFlames: { // 回响烈焰(B)→A：火浪成排
    3: ', the same card row, every card now releasing a tall bright flame, the rising fire folding into layered waves filling half the frame',
  },
  explosiveArt: { // 爆炸艺术(C)→B→A：礼花逐级倍增
    2: ', the same burst, twice as many colorful shells blooming across the sky',
    3: ', the same scene, a sky-filling festival of fireworks in every corner, color flooding the frame edge to edge',
  },
  flameBirth: { // 焰生(C)→B→A：火苗成焰
    3: ', the same cupped hands, the newborn flame now a tall bright blaze with a forming core, warm light flooding the gauntlets',
  },
  flashBurn: { // 急燃(C)→B→A：燃幅逐级满身
    2: ', the same ignition, the fire sheet now clearly covering the whole armor, brighter flare',
    3: ', the same knight fully engulfed in a roaring instant blaze, the flash blinding at the helmet slit, sparks blasting off',
  },
  fuelTheFire: { // 添柴(C)→B→A：A 大暗倒挂
    3: ', the same toss, the blaze now a roaring bonfire filling the lower two-thirds of the frame, flames leaping high with bright sparks',
  },
  heatChargedBall: { // 蓄热(C)→高温(B)→白炽(A)：白核逐级吞球（审计全链倒挂）
    2: ', the same braced fireball, the white-hot core now clearly half the ball, blinding at the center, heavier heat ripple',
    3: ', the same fireball, the incandescent white core grown to swallow almost the whole sphere, blinding white with a thin orange rind, heat distortion raging',
  },
  playWithFire: { // 玩火(C)→B→A：火带逐级成焰
    2: ', the same twirl, the fire ribbon now a long bright flame coil wrapping the finger, more playful licks',
    3: ', the same hand, the flame now a blazing coil wrapping the whole gauntlet, bright sparks popping off the fingertips',
  },
  sparkSeed: { // 火种(C)→速生火种(B)：B 与 C 近乎复制
    2: ', the same seed, the sprouting flame now clearly taller with two side shoots, cracks glowing brighter, rapid growth visible',
  },
};

// 变体场景表：多等阶键（tmp/series_tiers.json）为最低阶之外的每个等阶出一行 <key>-<tierIdx>

// fp8 运行时量化（与 genUnitArt 同方：bf16 文件 + weight_dtype fp8_e4m3fn，显存减半、出图更快）；
// TE fp8 需文件就位（字节门槛防半成品下载件炸 loader），缺了回 bf16。
const TE_FP8_READY = (() => { try { return fs.statSync('E:/aiimage/ComfyUI/models/text_encoders/qwen3vl_8b_fp8.safetensors').size >= 9.3e9; } catch { return false; } })();
const CLIP_NAME = TE_FP8_READY ? 'qwen3vl_8b_fp8.safetensors' : 'qwen3vl_8b_bf16.safetensors';

function buildWorkflow(scene, seed, refName = null) {
  const wf = {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: CLIP_NAME, type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['453', 0], prompt: `${scene.prompt}, ${STYLE}`, negative_prompt: NEGATIVE, resolution: 512 },
    },
    '458': {
      class_type: 'KSampler',
      inputs: {
        model: ['451', 0], positive: ['452', 0], negative: ['452', 1],
        seed, control_after_generate: 'fixed', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
        denoise: refName ? DENOISE : 1,
      },
    },
    '457': { class_type: 'VAEDecode', inputs: { samples: ['458', 0], vae: ['454', 0] } },
    '461': {
      class_type: 'SaveImageAdvanced',
      inputs: {
        images: ['457', 0], filename_prefix: 'wekyspire_cardscene', format: 'png',
        'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB',
      },
    },
  };
  if (refName) {
    wf['501'] = { class_type: 'LoadImage', inputs: { image: refName } };
    wf['502'] = { class_type: 'ImageScale', inputs: { image: ['501', 0], upscale_method: 'lanczos', width: 800, height: 400, crop: 'center' } };
    wf['503'] = { class_type: 'VAEEncode', inputs: { pixels: ['502', 0], vae: ['454', 0] } };
    wf['458'].inputs.latent_image = ['503', 0];
  } else {
    wf['456'] = { class_type: 'EmptyLatentImage', inputs: { width: 800, height: 400, batch_size: 1 } };
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

async function queuePrompt(scene, seed, refName = null) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow(scene, seed, refName) }),
  });
  if (!res.ok) throw new Error(`queuePrompt failed: ${res.status} ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitDone(promptId) {
  for (let i = 0; i < 150; i++) {
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

// 链级联：k0 不重出（用其既有图当参考锚），其后每级以前一级首张新图 img2img——
// 同一构图逐代传递，只按各自行 prompt 升维目标物（用户 2026-09-22 定：同链必须一眼认出同链）
async function runChain(keys) {
  console.log(`链级联：${keys.join(' → ')}（img2img denoise ${CHAIN_DENOISE}）`);
  let refPath = ANCHOR ? path.resolve(ANCHOR) : null;
  if (refPath) console.log(`显式锚图 = ${refPath}（链内 ${keys.length} 键全部生成）`);
  for (const key of keys) {
    const scene = SCENES.find(s => s.id === key);
    if (!scene) { console.error(`  ✗ 链中无此键 ${key}，链中止`); return; }
    if (!refPath) {
      const deployed = path.resolve(`src/assets/cards/${key}.webp`);
      const dir = path.join(OUT_DIR, key);
      const cands = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort() : [];
      refPath = fs.existsSync(deployed) ? deployed : (cands.length ? path.join(dir, cands[0]) : null);
      if (!refPath) { console.error(`  ✗ 链首 ${key} 无既有图可参考，链中止`); return; }
      console.log(`链首 ${key}：参考图 = ${refPath}（不重出）`);
      continue;
    }
    const dir = path.join(OUT_DIR, key);
    fs.mkdirSync(dir, { recursive: true });
    const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
    let firstNew = null;
    for (let i = 0; i < COUNT; i++) {
      const seed = Math.floor(Math.random() * 1e15);
      const outPath = path.join(dir, `cand_${have + i}_${seed}.png`);
      console.log(`级联 ${key} [${i + 1}/${COUNT}]（ref=${path.basename(refPath)}，seed ${seed}）…`);
      try {
        const refName = await uploadImage(refPath);
        const pid = await queuePrompt(scene, seed, refName);
        const hist = await waitDone(pid);
        await downloadImage(hist, outPath);
        console.log(`  ✓ ${outPath}`);
        if (!firstNew) firstNew = outPath;
      } catch (e) {
        console.error(`  ✗ ${key}#${i}: ${e.message}`);
      }
    }
    if (firstNew && !FIXANCHOR) refPath = firstNew; // 下一级锚定本级的首张新图，逐代传递（--fixanchor 时锚死显式锚图）
  }
  console.log('链级联完成。');
}

// —— 变体级联（--varchain）：同一键内按等阶 idx 逐级 img2img——部署图为最低阶锚，
// 每阶参考上一阶首张新图；构图锁死（denoise 0.72），增强交给后缀。--only 可限键。 ——
async function runVarChains(onlyKeys) {
  const tiersPath = path.resolve('tmp/series_tiers.json');
  if (!fs.existsSync(tiersPath)) throw new Error('缺 tmp/series_tiers.json——先跑 node tmp/dump-series-tiers.mjs');
  const tiers = JSON.parse(fs.readFileSync(tiersPath, 'utf8'));
  const keys = Object.keys(tiers).filter(k => tiers[k].length > 1 && (!onlyKeys || onlyKeys.includes(k)));
  console.log(`变体级联：${keys.length} 键（img2img denoise ${DENOISE}，每变体 ${COUNT} 抽）`);
  for (const key of keys) {
    const scene = SCENES.find(s => s.id === key);
    if (!scene) { console.error(`  ✗ SCENES 无此键 ${key}，跳过`); continue; }
    const t = [...tiers[key]].sort((a, b) => a - b);
    let refPath = path.resolve(`src/assets/cards/${key}.webp`);
    if (!fs.existsSync(refPath)) { console.error(`  ✗ ${key} 无部署图，跳过`); continue; }
    for (const idx of t.slice(1)) {
      const vid = `${key}-${idx}`;
const t2i = T2I_TIERS[vid] ?? null; // 构图级升维档：免参考直出（见 T2I_TIERS 表注）
      const esc = t2i ? '' : (ESCALATION_VOID[key]?.[idx] ?? ESCALATION_CUSTOM[key]?.[idx] ?? ESCALATION[idx]);
      const vscene = { id: vid, prompt: t2i ?? (scene.prompt + esc) };
      const dir = path.join(OUT_DIR, vid);
      fs.mkdirSync(dir, { recursive: true });
      const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
      let firstNew = null;
      for (let i = have; i < COUNT; i++) {
        const seed = Math.floor(Math.random() * 1e15);
        const outPath = path.join(dir, `cand_${i}_${seed}.png`);
        console.log(`级联 ${vid} [${i + 1}/${COUNT}]（ref=${path.basename(refPath)}，seed ${seed}）…`);
        try {
          const refName = t2i ? null : await uploadImage(refPath);
          const pid = await queuePrompt(vscene, seed, refName);
          const hist = await waitDone(pid);
          await downloadImage(hist, outPath);
          console.log(`  ✓ ${outPath}`);
          if (!firstNew) firstNew = outPath;
        } catch (e) {
          console.error(`  ✗ ${vid}#${i}: ${e.message}`);
        }
      }
      if (firstNew) refPath = firstNew; // 逐级传递：下一阶锚定本阶首张新图
      else if (have >= COUNT) {
        // 本档已满（前轮/他跑产物，本次未生成）：锚仍推进到最新既有候选，保持逐阶累积
        const cands = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
        refPath = path.join(dir, cands[cands.length - 1]);
      }
    }
  }
  console.log('变体级联完成。');
}

if (CHAIN) {
  await runChain(CHAIN);
} else if (VARCHAIN) {
  DENOISE = Number.isFinite(DENoiseArg) && DENoiseArg > 0 ? DENoiseArg : VAR_DENOISE;
  await runVarChains(ONLY);
} else {
const POOL = SCENES;
let targets = ONLY ? POOL.filter(s => ONLY.includes(s.id)) : POOL.slice(START, END === Infinity ? undefined : END);
targets = targets.filter(s => {
  // 已有 COUNT 张候选的键跳过（除非 --only 显式点名）
  if (ONLY) return true;
  if (LADDER_KEYS.has(s.id)) { console.log(`跳过 ${s.id}（跨键进阶链——走 --chain 级联）`); return false; }
  const dir = path.join(OUT_DIR, s.id);
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).length : 0;
  if (have >= COUNT) { console.log(`跳过 ${s.id}（已有 ${have} 张候选）`); return false; }
  return true;
});
console.log(`目标 ${targets.length} 键 × ${COUNT} 抽，输出到 ${OUT_DIR}`);
for (const s of targets) {
  const dir = path.join(OUT_DIR, s.id);
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
  for (let i = have; i < COUNT; i++) {
    const seed = Math.floor(Math.random() * 1e15);
    const outPath = path.join(dir, `cand_${i}_${seed}.png`);
    console.log(`生成 ${s.id} [${i + 1}/${COUNT}]（seed ${seed}）…`);
    try {
      const pid = await queuePrompt(s, seed);
      const hist = await waitDone(pid);
      await downloadImage(hist, outPath);
      console.log(`  ✓ ${outPath}`);
    } catch (e) {
      console.error(`  ✗ ${s.id}#${i}: ${e.message}`);
    }
  }
}
console.log('全部完成。');
}
