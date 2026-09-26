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
const CHAIN_DENOISE = 0.85; // 级联 img2img 强度：0.6 克隆参考图；0.75 只加碎屑、全链零变化（用户否掉）；
// 0.85 让刀刃/状态/背景/笔触的逐级变身真正发生，构图由参考图+共享句式双锚定
const VAR_DENOISE = 0.8; // 变体级联强度：同一张卡的逐级增强——构图必须锁死（用户：同链路构图要类似），
// 变化交给能量/光效/褪彩——0.72 太保守（褪彩压不过保真，试点几乎零变化），0.8 让后缀显形而构图不漂
let DENOISE = CHAIN_DENOISE; // buildWorkflow 实际使用值：--chain=0.85，--varchain=0.72
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
//   骑士全身/半身主体仅保留 8 键「确实帅」的名额（airFloat/flameHeal/fireWhirl/lastStand/pluckStar/
//   allIn/atEase/noonNap）——新增骑士主体须用户点头。等阶分级轴随之升级：不只加元素，
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
  { id: 'duckHead', prompt: `crossed steel-gray vambraces filling the frame raised in guard, sparks bursting on the plates, a helmet barely visible behind the wall of armor` },
  { id: 'punch', prompt: `extreme close-up of a steel-gray gauntlet fist frozen at the moment of impact filling the frame, radiating impact lines, nothing else in frame` },
  { id: 'focusChant', prompt: `extreme close-up of two steel-gray armored gauntlets pressed together in prayer, a single bright drop of light floating between the palms, the hands filling the entire frame, no helmet in frame, dark background` },
  // —— 体修·拳组合（过牌；骑士本体 + 大面积黑灰） ——
  { id: 'fastPunch', prompt: `side-view close-up of a steel-gray armored straight punch: only the steel-gray gauntlet fist, the armor-plated forearm and one sharp speed line crossing the whole frame, a thin red scarf edge at the frame corner, everything else cropped to darkness` },
  { id: 'fullCharge', prompt: `extreme close-up of a steel-gray fist wound far back behind the shoulder, coiled to its limit, every plate trembling with stored force, side view, maximal wind-up, dark background` },
  { id: 'wildPunch', prompt: `a small stretched black silhouette of a knight leaping through the air mid haymaker strike, violent red and black speed lines storming around him, the silhouette small in frame, berserk momentum, dark background` },
  { id: 'wildFlurry', prompt: `a rain of fist afterimages: dozens of blurred fists filling the whole frame in rhythmic diagonal rows like falling rain, no readable body, storm of blows` },
  { id: 'agileCombo', prompt: `two solid crisp steel-gray gauntlet fists landing a snappy one-two punch in mid-air, both fist shapes clearly readable with knuckles, sharp echo trails behind them, the rest of the frame empty dark, minimal and fast` },
  { id: 'counterDraw', prompt: `extreme close-up of an open steel-gray palm deflecting sideways, the redirecting parry with glancing motion lines, a precise counter-catch, dark background` },
  { id: 'mimicFist', prompt: `extreme close-up of a steel-gray armored hand shaped into a pouncing beast claw, fingers hooked like a feral paw, imitation-beast form, no helmet in frame, dark background` },
  { id: 'snakeFist', prompt: `extreme close-up of a steel-gray armored hand pressed into a striking snake-head point, two fingers extended as fangs, sinuous whip-fast motion lines, no helmet in frame, dark background` },
  { id: 'dragonFist', prompt: `extreme close-up of a steel-gray armored fist rearing upward like a rising dragon's head, the knuckles forming the dragon's brow, ascending coiled motion, no helmet in frame, dark background` },
  { id: 'voidFist', prompt: `extreme close-up of a steel-gray armored open palm held empty and open toward the viewer, the hand and wrist half-dissolved into gray mist, near black and white, hollow void-calm, no helmet in frame, dark background` },
  { id: 'emptyFist', prompt: `extreme close-up of a steel-gray armored open palm in a single still strike, the hand half-dissolved into blank emptiness, stark black and white with hard white rim light, the air cracking around the fingers, no helmet in frame, dark background` },
  { id: 'chargeUp', prompt: `tight close-up of two steel-gray gauntlets pressed together, a compressed knot of crackling energy swelling between the palms, the frame dark around the bright knot` },
  { id: 'endlessCombo', prompt: `a sweeping row of overlapping punch afterimages trailing across the frame, five sequential steel-gray fists blurring one after another in a single flowing barrage, the knight's body a smear of motion behind them, endless combo, dark background` },
  { id: 'instantThousand', prompt: `a frozen instant: hundreds of desaturated gray fist afterimages scattered across the whole frame like a starfield of blows, near-monochrome, blurred illusory phantom fists everywhere` },
  { id: 'instantStrike', prompt: `extreme close-up of a steel-gray armored fist landing a flash-fast jab toward the left, sharp motion lines, dark background` },
  { id: 'adrenaline', prompt: `extreme close-up of a steel-gray fist slamming into an open armored palm, the psych-up gesture, a sharp impact burst and motion lines, raw adrenaline, dark background` },
  { id: 'crashLanding', prompt: `ground-level view looking up: exactly one small stretched black silhouette dropping out of the dark sky elbow-first, a shockwave ring already cracking the earth beneath it, single figure only, scale contrast` },
  { id: 'elbowMaster', prompt: `extreme heroic close-up of one bent steel-gray armored elbow joint presented to the camera like a legendary trophy weapon, the elbow point filling the frame, polished gleam on the plating, comedic reverence for the boss elbow, no helmet, no face, no body, dark background` },
  { id: 'elbowReturn', prompt: `extreme close-up of a steel-gray elbow thrust skyward in triumph, raised high like a returning champion, dramatic backlight on the point, dark background` },
  { id: 'elbowStrike', prompt: `extreme close-up of a steel-gray elbow mid-swing, the pointed elbow joint leading the strike with sharp motion lines, no helmet in frame, dark background` },
  { id: 'feint', prompt: `two overlapping silhouettes of the same armored knight leaning opposite ways, one solid black and one ghost-gray, a deceptive split-moment frozen` },
  { id: 'fistPress', prompt: `extreme close-up of a steel-gray fist pressing downward with crushing weight, the air compressed beneath the knuckles, grinding pressure, dark background` },
  { id: 'hunYuanPlus', prompt: `extreme close-up of two steel-gray palms circling each other in a flowing exchange, one upturned one downturned, a small swirl of air spiraling between them, cyclical motion, dark background` },
  { id: 'leverage', prompt: `extreme close-up of a steel-gray plate gauntlet catching a bright incoming force streak and turning it aside, the redirected force curving away past the medieval knight armor, gauntlet clearly armored, no robes no fabric, dark background` },
  { id: 'novice', prompt: `extreme close-up of a steel-gray fist pressed gently into an open armored palm in a formal martial salute, the beginner's greeting, respectful stillness, dark background` },
  { id: 'wildFist', prompt: `extreme close-up of a steel-gray fist flickering through multiple ghostly phantom hand shapes, ever-changing afterimages of open palm claw and fist overlapping it, the ten-thousand-change fist, dark background` },
  { id: 'voidCard', prompt: `a single blank translucent playing card floating in darkness, its face completely empty, the card's edges dissolving into fading particles, pale dim outline on black, no ghost, no face, no creature, nothingness` },
  // —— 体修·刀组合（卡序；大剑动作族） ——
  // 斩局内进阶链 v3（2026-09-22 用户三轮迭代）：**刀刃当主角、骑士淡化**（半露于画缘，S 级成剪影）；
  // prompt 只写可直接入画的具体景物（不为难 AI 具象化「斩金断石」）；明度/能量严格渐强——
  // 暗钢 → 金火花 → 沙暴 → 碧涛 → 白光 → 泛白，让玩家一眼读出「一重更比一重强」。
  // 链内全部键共享同一取景句式（级联锁构图），每级四轴变身：刀刃形态色泽/背景景物/明度能量/骑士存在感。
  { id: 'rockCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its steel blade chipped and dusty gray, a big boulder split into two halves behind the blade with rock chunks and brown-gray dust settling, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, dim dusty mood` },
  { id: 'goldCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its edge glowing golden-hot, a sheared metal column stump beside the blade with a shower of golden sparks and metal shards flying, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, warm spark-lit mood` },
  { id: 'mountainCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its blade broadened and humming, visible shockwave rings rippling the air around the blade, a mountain peak behind with massive clouds of dust and sand blasting off its slopes, gravel and sand storming outward in every direction, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, violent storm-force mood` },
  { id: 'seaCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its blade wrapped in streaming water ribbons, two towering walls of seawater parting to the left and right of the blade with white foam and spray between them, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dramatic cool blue mood` },
  { id: 'skyCleave', prompt: `extreme close-up of a steel-gray armored knight: both gauntlets raising a huge greatsword high overhead for a downward cleave, the blade trailing a towering vertical rift of blinding white light splitting the dark sky behind it, red scarf whipping at the frame edge, tight dark close-up, no landscape, dark background` },
  { id: 'godCleave', prompt: `a colossal arc of void-white fire huge and filling the entire frame, its edge dissolving into drifting sparks of light, a vast radiant figure of pale light collapsing and scattering into ash-like fragments behind the blade, the knight a near-invisible silhouette at the frame edge with only the red scarf vivid, the frame flooding toward white, overwhelming god-slaying mood` },
  { id: 'ironShard', prompt: `a burst of jagged iron shards flying toward the left, sharp crisp metal fragments dominant, the right half of the frame plain dark emptiness, nothing else in frame` },
  { id: 'handCleave', prompt: `a decorative circle of steel blade-light filling the frame edge to edge, the spinning greatsword reduced to a bright streak riding the circle, no readable body, showy flourish` },
  { id: 'perfectCleave', prompt: `a flat rosette of interlaced blade-arc trails blooming like a steel flower facing the camera, ornate defensive flourish pattern, no person visible, dark background` },
  { id: 'silverDance', prompt: `flowing silver blade ribbons tracing an elegant dance pattern across the dark frame, the ribbons the only subject, graceful and deadly` },
  { id: 'graceDance', prompt: `a steel-gray knight in an elegant flowing blade dance, his sword tracing one smooth continuous ribbon of light in a tall graceful arc, poised and unhurried, dark background` },
  { id: 'cycloneSlash', prompt: `one complete ring of blade-light filling the frame edge to edge, a perfect circle of steel arc, sparks riding the rim` },
  { id: 'cleave', prompt: `one huge flat horizontal blade-arc sweeping across the entire frame, the arc as wide as the frame itself, everything in its path split` },
  { id: 'flyingDagger', prompt: `a throwing knife huge in frame streaking toward the left with a long speed trail, a steel-gray gauntlet blurred at the rear edge` },
  { id: 'returningDagger', prompt: `extreme close-up of a curved throwing dagger spinning back into an open steel-gray gauntlet, the returning catch, a circular motion trail closing the loop, dark background` },
  { id: 'fineDagger', prompt: `extreme close-up of an ornate slim throwing dagger pinched between steel-gray gauntlet fingers, fine craftsmanship gleaming, dark background` },
  { id: 'perfectDagger', prompt: `extreme close-up of a single dagger frozen mid-spin in the air, concentric motion rings around its rotation, a flawless trajectory line, no person, no hands, the dagger alone, dark background` },
  { id: 'storeEdge', prompt: `extreme close-up of a long blade being slowly slid back into its sheath, only a sliver of bright edge still visible, concealed sharpness, quiet tension, dark background` },
  { id: 'breath', prompt: `extreme close-up of a steel-gray helmet visor with slow visible breath misting in the cold air, calm rhythmic breathing, two faint breath clouds, dark background` },
  { id: 'honeBlade', prompt: `extreme close-up of a whetstone drawing along a greatsword edge, one thin bright line of sparks following the stone, tender blade care` },
  { id: 'forgingBlade', prompt: `a hammer striking a glowing hot blade on an anvil, sparks filling the frame, the forge glow the only light, no person readable` },
  { id: 'edgeBreath', prompt: `extreme close-up of a steel-gray helmet visor with a small throwing blade held horizontally at the slit like held in teeth, the held-edge trick, dark background` },
  { id: 'unsheathe', prompt: `extreme close-up of a greatsword mid-draw: the black scabbard mouth huge at the frame edge, half the bright blade already out catching a streak of light, one sharp draw speed line along the steel, dark background` },
  { id: 'whetstone', prompt: `extreme close-up of a whetstone grinding bright sparks off a greatsword edge, steel-gray gauntlets working the stone, no helmet in frame, dark background` },
  { id: 'honeEdge', prompt: `extreme close-up of a steel-gray gauntlet wiping a greatsword's edge with a dark cloth, the wiped line gleaming mirror-bright against the dull steel, a bright gleam streak revealing, no helmet in frame, dark background` },
  { id: 'annihilatingEdge', prompt: `a dark greatsword blade filling the frame diagonally, its edge void-black with a thin pale annihilating rim, the steel swallowing the light around it` },
  { id: 'practiceBlade', prompt: `a wooden training post with a clean diagonal cut through it, the severed top half sliding off mid-fall, sawdust and wood fibers flying, a fading blade-arc afterimage, quiet precise practice cut, no person visible, dark background` },
  { id: 'quickCleave', prompt: `extreme close-up of a greatsword mid-spin whipping in a short snappy arc, strong motion blur on the fast blade, only steel-gray gauntlets on the grip, tight crop, speed lines, no helmet in frame, dark background` },
  { id: 'quickDrawShield', prompt: `extreme close-up of a greatsword being whipped horizontally into a flat guard, half-drawn with sharp draw speed lines, the flat of the blade catching light like a barrier, only steel-gray gauntlets, no helmet in frame, dark background` },
  { id: 'ironRain', prompt: `a rain of jagged iron shards pouring down across the frame, a metallic storm, dark background` },
  { id: 'bladeArt', prompt: `extreme close-up of a long blade tracing a single sharp technique arc, the edge leaving a clean bright motion line, precise swordcraft, no person visible, dark background` },
  { id: 'bladeHeart', prompt: `extreme close-up of a long blade held flat across the chest over the heart, both steel-gray gauntlets cradling it gently, the blade resting against the armor like a cherished heart, quiet devotion, dark background` },
  // —— 体修·拆组合（格挡；防御与姿态） ——
  { id: 'carefulStrike', prompt: `a single steel-gray palm-blade hand in close-up frozen mid-strike, one precise thin targeting line crossing the entire frame, surgical stillness` },
  { id: 'doubleStrike', prompt: `twin solid steel-gray gauntlet fists striking the same point one-two, two crisp separate impact bursts side by side, both fist shapes clearly readable, tight close crop, nothing else in frame` },
  { id: 'pluckStar', prompt: `near-monochrome: ${KNIGHT}, reaching high into an empty black sky, the gauntlet closing around a single pale dim point of light, the body in desaturated grays dissolving at the edges, vast hollowness all around, one faint star, no warm color` },
  { id: 'breakStance', prompt: `a muted steel-gray armored gauntlet fist punching clean through a cracked steel plate filling the frame, fragments bursting outward from the breach, cool neutral gray tones only` },
  { id: 'barrier', prompt: `extreme close-up of two crossed steel-gray vambraces stacked like a fortress wall filling the entire frame, interlocking armor plates like bricks, an immovable bulwark of steel, no helmet in frame, dark background` },
  { id: 'shatterHit', prompt: `extreme close-up of a steel-gray armored fist punching straight at the camera, the knuckle impact bursting with white fracture cracks radiating through the air, the shattering blow frozen at contact, no helmet in frame, dark background` },
  { id: 'soulOfWar', prompt: `a steel-gray knight with a pale spectral flame aura rising from his shoulders, ghost-white war-spirit fire licking upward without heat, an otherworldly warrior soul, dark background` },
  { id: 'heavyStomp', prompt: `ground-level macro: a pair of steel-gray armored boots sweeping past the camera in a low arc, dust blasting up in a wide wave, heavy motion blur` },
  { id: 'endure', prompt: `a tiny dark hunched silhouette under a rain of dust and debris, taking it, unbroken, the falling debris dominant in frame` },
  { id: 'guard', prompt: `extreme close-up of a single steel-gray vambrace filling the frame diagonally, one bright impact spark bursting on the plate` },
  { id: 'defensePrep', prompt: `extreme close-up of an open steel-gray palm raised in a calm catching gesture, fingers spread ready to receive a blow, quiet defensive preparation, dark background` },
  { id: 'turtleStance', prompt: `extreme close-up of a steel-gray knight curled into a tight armored ball, knees elbows and helmet interlocked into a rounded shell of plate armor, no face visible, a living turtle shell, dark background` },
  { id: 'divineTurtle', prompt: `a steel-gray knight curled into a tight armored ball, brilliant golden light pouring from every seam between the interlocked plates, a sacred divine turtle shell glowing like a relic, holy radiance flooding the dark, dark background` },
  { id: 'martialStance', prompt: `extreme low close-up of two steel-gray armored boots planted wide in a deep horse stance, ground-level view, dust settling around the greaves, an immovable foundation, dark background` },
  { id: 'berserkStance', prompt: `extreme close-up of a steel-gray helmet thrown back in a berserker's roar, the visor slit flaring bright, fury tremor lines shaking the frame, dark background` },
  { id: 'fastRain', prompt: `a steel-gray knight head-and-shoulders leaning hard into motion, rain-like streaks of speed lines pouring diagonally across the whole frame around him, relentless flowing tempo, dark background` },
  { id: 'prepareMove', prompt: `extreme close-up of a steel-gray fist chambered tight at the waist, coiled with held-back force, side view, quiet trembling tension before the strike, dark background` },
  { id: 'rally', prompt: `extreme close-up of a steel-gray gauntlet grabbing its own shoulder pauldron in a limbering warm-up stretch, loosening the joints, small motion tremors, dark background` },
  { id: 'bloodFist', prompt: `extreme close-up of a clenched steel-gray gauntleted arm plunged deep into a sea of blood, the vivid red blood filling two thirds of the frame, dark armor slicing through it, stolen vitality glowing in the liquid` },
  { id: 'powerStance', prompt: `extreme close-up of two steel-gray fists pressed knuckle-to-knuckle in front of the chest, force doubling between them, trembling power lines, dark background` },
  { id: 'winWithout', prompt: `extreme close-up of a single playing card held up between two armored fingers, the card filling the frame, everything else void dark` },
  { id: 'haveWithout', prompt: `a wide fan of playing cards filling the frame held in one steel-gray gauntlet, the cards dominant, abundance` },
  // —— 火大系（火光映甲） ——
  { id: 'gatherFlame', prompt: `a single huge torch flame roaring upward filling most of the frame, only a steel-gray armored gauntlet visible at the bottom edge holding it aloft, the orange-yellow fire mass dominant, sparks flying` },
  { id: 'emberMote', prompt: `extreme close-up of a glowing charcoal ember chunk cradled in darkness, its bright orange cracks filling the frame with warm light, only the edges of steel-gray gauntlet fingers visible around it` },
  { id: 'fireControl', prompt: `a large serpentine whip of fire arcing across the frame, guided by a single steel-gray gauntlet at the frame edge, the orange fire serpent dominant, embers trailing in its wake` },
  { id: 'fireworks', prompt: `a huge burst of fireworks filling the whole frame, colorful star shells against the black, a tiny distant silhouette far below, scale contrast` },
  { id: 'fireBolt', prompt: `a huge roaring fireball mid-flight filling the frame with a long blazing tail toward the left, only the knight's throwing gauntlet visible at the rear corner edge, the orange fireball dominant` },
  { id: 'inflame', prompt: `extreme close-up of a steel-gray armored hand snapping its fingers, a small flame just catching on the thumb tip, sparks flying from the snap, dark background` },
  { id: 'fuelTheFire', prompt: `a fierce blaze filling the lower half of the frame, a burning playing card tumbling down into it from above, only the knight's tossing gauntlet at the top edge, flames flaring up` },
  { id: 'playWithFire', prompt: `a steel-gray gauntlet idly twirling a ribbon of flame around one raised finger like a coin trick, playful casual fire manipulation, small fire dancing between the armored fingers, no helmet in frame, dark background` },
  { id: 'allIn', prompt: `${KNIGHT}, arms spread wide as his own cards burst into flame around him, burning card scraps swirling upward, drawing a violent surge of fiery power out of the burning cards, desperate all-in eruption` },
  { id: 'flameBirth', prompt: `a tiny newborn flame cradled in two cupped steel-gray gauntlets, extreme close-up on the small delicate fire, warm glow on the armored fingers, tender scale contrast between huge hands and little flame, dark background` },
  { id: 'flameHeal', prompt: `${KNIGHT}, head tilted up with arms open at his sides as warm golden light pours down over his shoulders and helmet from above, healing glow washing the armor, gentle embers rising` },
  { id: 'highFever', prompt: `a steel-gray knight hunched forward enduring an internal burn, bright molten light leaking through the gaps between his armor plates and from his helmet slit, glowing white-hot cracks of light across his chest and pauldrons, his body a lit furnace inside the steel shell, heat shimmer warping the air, no flames outside the armor` },
  { id: 'warmUp', prompt: `many small candle flames floating in a loose ring in the dark, a small steel-gray knight seen from behind standing among them, the ring of warm flames dominant, tiny bright points everywhere` },
  { id: 'melt', prompt: `a stream of molten metal pouring down through the frame, the bright glowing liquid dominant against the dark, a tilted crucible edge at the top` },
  { id: 'explosiveArt', prompt: `a huge festive fireworks burst filling the entire frame in orange and gold, a small knight silhouette at the bottom edge looking up, the explosion dominant` },
  { id: 'fireWhirl', prompt: `${KNIGHT}, spinning with a tornado of fire around him, the fire whirl wrapping the frame, scarf pulled into the spiral` },
  { id: 'residualHeatPlus', prompt: `a lone steel-gray gauntlet in close-up cooling after the fight, thin heat waves and dim orange embers drifting up off the plates, quiet aftermath` },
  { id: 'fireTemper', prompt: `a forge blaze roaring across the frame, a glowing hot blade held into the fire by tongs, a storm of sparks, only the knight's arm silhouette at the frame edge, the fire and molten glow dominant` },
  { id: 'hotHands', prompt: `close-up of a pair of open steel-gray gauntlets shaking off small dancing flames on the fingers, recoiling heat` },
  { id: 'silence', prompt: `close-up of two steel-gray gauntlets snuffing a single candle flame between them, one last thin smoke wisp rising, the light just dying` },
  { id: 'relief', prompt: `a huge round pressure valve in close-up blasting steam sideways, the steam filling half the frame, gauntlets wrenching the wheel` },
  { id: 'kindling', prompt: `extreme close-up of a steel-gray forearm with a cut in the vambrace, blood drops catching small flames mid-air, tiny fires standing on the blood trail` },
  { id: 'fireRain', prompt: `the whole frame streaked with falling fire comets, a tiny silhouette below taking cover under one raised arm, the fire rain dominant` },
  { id: 'firstStrike', prompt: `a flaming dart huge in frame streaking toward the left with a long fire trail, only the knight's extended throwing arm visible at the rear edge, the dart and its trail dominant` },
  { id: 'patience', prompt: `extreme close-up of an upturned steel-gray armored palm, a drop of dark blood on it with a slow dark-red flame rising from the drop, ominous stillness, dark background` },
  { id: 'fireWall', prompt: `a wall of flames filling the frame floor to ceiling, a small dark silhouette standing calm within the blaze, the fire dominant` },
  { id: 'burnBurstPlus', prompt: `two identical mirrored flames drifting apart filling the frame, a single open steel-gray gauntlet between them at the bottom edge, the doubling fire pair dominant` },
  { id: 'willOWisp', prompt: `a pale blue-white ghost flame huge in frame drifting free, cold light washing a hint of steel-gray armor at the frame edge, eerie wisp` },
  { id: 'mirrorBurn', prompt: `a mirror shard held in a steel-gray gauntlet filling the frame, a bright flame blazing inside the reflection, dark all around` },
  { id: 'spark', prompt: `a burst of tiny bright sparks filling the frame against the black, sharp vivid points everywhere` },
  { id: 'shock', prompt: `an armored fist frozen mid-impact in close-up with a shockwave ring exploding outward from the knuckles, debris pushed aside, filling the frame` },
  { id: 'magmaArmor', prompt: `extreme close-up of a steel-gray breastplate and pauldron with glowing lava cracks veining the metal, molten orange light in the fissures, helmet cropped out of frame` },
  // —— 火大系补全（橙黄橙红为主体，骑士小面积或仅暗示；爆裂为视觉锚点） ——
  // 火球术系
  { id: 'fireBarrage', prompt: `two roaring fireballs streaking toward the left one behind the other in rapid succession, twin blazing tails, only the knight's throwing gauntlet visible at the rear edge, the paired fireballs dominant` },
  { id: 'greaterFireBall', prompt: `a colossal fireball looming so large it fills the entire frame edge to edge, its surface a roiling orange mass, a tiny steel-gray knight silhouette at the bottom edge dwarfed beneath it` },
  { id: 'heatChargedBall', prompt: `extreme close-up of a fireball's core turning blinding white-hot, the outer flame still orange, heat distortion rippling off its surface, only a steel-gray gauntlet's fingertips bracing it at the frame edge` },
  // 爆裂术咏唱
  { id: 'qimingBlaze', prompt: `a colossal pillar of heavenly flame descending from above and splitting the frame vertically, blinding white-gold fire, a tiny knight far below at the bottom edge with one gauntlet raised, apocalyptic sky-fire` },
  // 凝焰/燃元/炼心
  { id: 'flameForm', prompt: `a mass of orange flames sculpting itself into a tall humanoid fire figure mid-frame, the fire-body still half swirling flame, no knight in frame, embers orbiting the forming shape` },
  { id: 'emberOrigin', prompt: `extreme close-up of embers melting down and condensing into a single glowing molten-orange crystal core, drips of liquid fire falling into it, a steel-gray gauntlet holding it from below, dark background` },
  { id: 'refineHeart', prompt: `a heart-shaped core of fire suspended mid-frame being compressed by two steel-gray gauntlets, impurities flaking off as dark ash, the flame-heart burning purer and brighter, tight close-up` },
  // 余热/激热/急燃
  { id: 'residualHeatStar', prompt: `a bed of dark dying embers suddenly bursting back into roaring flame, the reignition flash filling the frame, orange fire erupting from the gray ash, no knight in frame` },
  { id: 'heatSurge', prompt: `a point of flame detonating outward in a sudden radial burst, the flash explosion filling the frame with expanding orange rings, triggered ignition, only the knight's pointing finger at the corner edge` },
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
  { id: 'heatWave', prompt: `a rolling wall of visible heat distortion blasting toward the left, shimmering air ripples glowing faint orange, the ground below scorched black with scattered embers, a steel-gray armored pushing palm at the right edge, no bare skin` },
  { id: 'burnSnap', prompt: `extreme close-up of two steel-gray gauntlet fingers pinching a flame and crushing it into a violent detonation, the fire collapsing inward then bursting through the fingers, dark background` },
  { id: 'fireControlDisturb', prompt: `many scattered flames across the frame streaming like iron filings toward a single steel-gray gauntlet at the center, the fires converging and swirling into the palm, gathering motion lines` },
  { id: 'fireControlBurn', prompt: `close-up of a single calm bright flame standing in an open steel-gray palm, the flame the only light source, controlled fire in darkness` },
  { id: 'fireControlRefine', prompt: `a bright orange flame and a black smog mass colliding mid-frame and annihilating each other in white sparks, paired cancellation, a steel-gray gauntlet directing the clash from the bottom edge` },
  { id: 'fireControlScorch', prompt: `extreme close-up of a steel-gray gauntlet fist being dipped and coated in thick clinging flame, fire wrapping the knuckles like fuel, loaded for the next strike, dark background` },
  { id: 'fireControlSupreme', prompt: `an open steel-gray gauntlet palm-up with a whole court of tiny shaped flames hovering above it — a ring, a serpent, a blade, a bird — every flame bending to one will, supreme mastery, dark background` },
  // 自焚/焰愈/焚天/镜燃/燃心
  { id: 'redHotBlade', prompt: `a greatsword blade glowing red-hot from within filling the frame diagonally, heat shimmer rising off the steel, embers dripping from the edge` },
  { id: 'immolateGrand', prompt: `everything in the frame consumed by white-hot incinerating fire, a knight silhouette at the center walking forward out of the inferno unburned, total annihilation blaze, the white fire dominant` },
  { id: 'nirvana', prompt: `a steel-gray knight kneeling inside a blooming lotus of fire, new bright armor gleaming through the burning old shell, rebirth from the flames, rising fire petals filling the frame` },
  { id: 'burnBurstStar', prompt: `a star-shaped flame erupting in three blinding points, the triple-pronged star fire huge in frame, radiating triple heat waves, only a steel-gray gauntlet at the bottom edge presenting it` },
  { id: 'karmaFire', prompt: `a small dark silhouette as a conduit: fire streaming onto one shoulder and pouring out the other arm toward the left, twin fire streams crossing at the tiny figure, the fire dominant` },
  { id: 'burningHeart', prompt: `a steel-gray knight clutching his chest as fire glows through the seams of his breastplate, the heart burning inside the armor, orange light leaking from every plate gap, tight torso crop` },
  { id: 'absoluteFlame', prompt: `flames frozen mid-flicker like red glass, locked at their peak forever, crystallized fire shards suspended in air, a steel-gray gauntlet touching the frozen flame surface, absolute stillness` },
  { id: 'flameCloak', prompt: `a steel-gray knight seen from behind wearing a long flowing cloak made entirely of fire, the flame-cape billowing wide and filling the frame, embers trailing from its hem, helmet turned slightly left` },
  { id: 'smeltCard', prompt: `extreme close-up of a playing card melting down in a steel-gray gauntlet's grip, its edges dripping molten glowing metal that pools into a bright ingot below, smelting heat, the card faces completely blank, no letters, no symbols, dark background` },
  { id: 'douseFlame', prompt: `a burning steel-gray knight doused from above, his flames collapsing into a huge burst of steam, fire dying across the armor, the steam cloud filling the frame` },
  { id: 'expand', prompt: `a steel-gray knight with arms pushed wide apart as the space between his gauntlets visibly expands and stretches, a growing fire swelling in the gap, capacity blooming outward, symmetric composition` },
  { id: 'fireAffinity', prompt: `a small gentle flame bending down like a bowing figure over an open steel-gray gauntlet, the fire showing favor, a warm intimate glow, quiet blessing, tight close-up` },
  { id: 'fireMastery', prompt: `concentric rings of fire orbiting a steel-gray knight like layered shields, each flame ring spinning at a different height, mastery of the element, the fire rings filling the frame` },
  { id: 'fireWard', prompt: `a wave of fire splashing against an invisible barrier around a calm steel-gray knight, the flames parting around him like water around a stone, a ward circle traced in light` },
  { id: 'shockCard', prompt: `extreme close-up of a steel-gray knight flinching, shoulders hunched and arms half-raised in a startle, a cold shock ripple stamped across the armor, intimidated, dark background` },
  // —— 木大系 ——
  { id: 'herbPaste', prompt: `close-up of a sprouting herb with bright leaves held in a gentle steel-gray gauntlet grip, soft green glow, careful and tender` },
  { id: 'miasma', prompt: `a huge sickly green miasma cloud filling the frame, poison droplets beading inside it, one steel-gray armored arm disappearing into the vapor from the edge` },
  { id: 'woodBark', prompt: `extreme close-up of a steel-gray armored forearm held across the frame, thick tree-bark plates sprouting over the vambrace, bark texture in big planes, no helmet in frame` },
  { id: 'breathOfLife', prompt: `top-down view: two steel-gray armored gauntlets cupping soil with a tiny sprouting seedling inside a ring of soft light, the rim of a rounded helmet just at the top edge of the frame, ground-level composition` },
  { id: 'woodSting', prompt: `a thorny stinger huge in frame flying toward the left, a glistening poison drop on its tip, more stingers blurred behind` },
  { id: 'woodBlood', prompt: `close-up of a steel-gray armored hand pressing onto a thorned black vine, thorns pricking the palm seam, drops of glowing dark-red sap welling up, the vine coiling around the wrist` },
  // —— 风大系 ——
  { id: 'windBlade', prompt: `a huge cyan crescent wind blade filling the frame, sharp translucent layers of compressed air, cutting wind` },
  { id: 'lightness', prompt: `a figure dissolving into a gust: the silhouette stretched into horizontal motion streaks, cyan air rings trailing, barely a body anymore` },
  { id: 'bathWind', prompt: `a single feather floating huge in frame wrapped in rings of cyan air, a hint of a releasing gauntlet at the bottom edge, serene` },
  { id: 'atEase', prompt: `${KNIGHT}, floating cross-legged on a soft cloud puff, relaxed weightless pose, scarf drifting slowly` },
  { id: 'airFloat', prompt: `${KNIGHT}, levitating high off the ground at a tilted diagonal, boots dangling, red scarf drifting straight upward, a ring of pale cyan air beneath him, weightless floating pose` },
  // —— 通用灰卡家族（骑士的日常动作） ——
  { id: 'purify', prompt: `a clear stream of water pouring over a steel-gray armored gauntlet in close-up, the hand clearly plated metal armor with chunky plate segments and steel sheen, dark grime dissolving off the metal plates in the flowing water, droplets sparkling, no skin, no flesh, no bare hand, brilliant purity` },
  { id: 'extract', prompt: `a steel-gray armored hand pulling a long iridescent ribbon of light out of a small gray rock, the ribbon shimmering green, yellow and blue like an oil sheen, stretched taut across the frame` },
  { id: 'drawQi', prompt: `thin streams of pale blue breath-light converging from every edge of the frame toward the small dark armored silhouette's chest at the center, a strong inhaling vortex motion, no book, no objects in hands, dark background` },
  { id: 'manaJar', prompt: `extreme close-up of a small round glass potion jar held in a steel-gray gauntlet, bright sapphire-blue glow escaping from the opened mouth, cool blue light on the metal, no helmet in frame` },
  { id: 'stimulant', prompt: `a vivid yellow-green bolt of energy crackling around a steel-gray armored forearm held across the frame, sharp bright jolt lines, sudden vigor, no helmet in frame` },
  { id: 'psiShield', prompt: `a huge translucent hexagonal energy sphere filling the entire frame like a bubble, glowing pale light blue, a very tiny dark knight silhouette floating small at the center of the sphere, glowing pale-blue hexagon facets across the sphere surface, the sphere is the whole subject, the knight is only a small dark shape inside, nothing held in any hands, no handheld objects, no physical shield, no weapons` },
  { id: 'acrobatics', prompt: `three bright balls — one green, one yellow, one blue — arcing through the air in a juggling loop, a steel-gray gauntlet tossing from the bottom edge, colorful motion trails` },
  { id: 'prePrepared', prompt: `a colorful folded umbrella with green yellow and blue panels planted like a cane, a relaxed small silhouette leaning on it, the umbrella dominant in close-up` },
  { id: 'panpanBread', prompt: `extreme close-up of a small round golden bread loaf resting on a green checkered cloth held in a steel-gray gauntlet, steam rising, cool rim light balancing the warm crust` },
  { id: 'noonNap', prompt: `${KNIGHT}, dozing off sitting bathed in cool blue moonlight, helmet nodding down onto the crossed arms resting on the pommel of his planted greatsword, a crescent moon above, one tiny warm ember glowing beside him` },
  { id: 'holdOut', prompt: `a rising brick wall filling the lower half of the frame, a small braced silhouette holding behind it, dust in the air, determined hold` },
  { id: 'instantCooldown', prompt: `extreme close-up of an hourglass with vivid blue sand frozen mid-fall, held in a steel-gray gauntlet, cool blue glow, sharp stillness, no helmet in frame` },
  { id: 'murmurChant', prompt: `extreme close-up side profile of a rounded steel-gray helmet with a thin horizontal visor slit, soft glowing rings of sound rippling out from the slit toward the left, dark background` },
  { id: 'expandChant', prompt: `a graceful arc of small glowing chant lights — green, yellow, blue — floating weightless above two upturned steel-gray palms in close-up, no wires, no strings, magical floating motes of light, dark background` },
  { id: 'helicopter', prompt: `a little toy helicopter with yellow and blue blades taking off from an open steel-gray gauntlet, whimsical small rotor wash, the colorful toy in close-up` },
  // —— 灰卡补全（多彩中性色：蓝绿黄无冷暖倾向；五只魏启罐各自不同构图） ——
  { id: 'manaJarPlus', prompt: `a tall elegant ornate glass vial of swirling sapphire-blue liquid huge and dominant in the frame, held up high by one steel-gray gauntlet entering from the bottom edge, green and yellow light sparkles refracting through the glass, the vial is the whole subject, no helmet, no face, no knight body, dark background` },
  { id: 'manaJarRoyal', prompt: `an ornate square crystal decanter of deep blue liquid presented flat on two open steel-gray gauntlets, a gilded label and green-gold glints, ceremonial offering pose, dark background` },
  { id: 'manaJarLegend', prompt: `an absurdly oversized round glass jug of radiant blue liquid cradled in both steel-gray arms like a baby, its glow flooding the armor with blue, green and yellow light motes floating, tight crop on the huge jug` },
  { id: 'swiftManaJar', prompt: `a steel-gray knight tilting a small blue-glowing jar to his visor slit and chugging it fast, motion blur on the tilt, blue light streaking, speed lines, tight profile crop` },
  { id: 'swiftManaJarPlus', prompt: `a luxurious wide goblet brimming with luminous blue liquid raised in a toast by a steel-gray gauntlet, yellow and green gem glints on the cup, a celebratory splash frozen mid-air, dark background` },
  { id: 'burstStimulant', prompt: `a vivid yellow-green shockburst filling the frame, radiating rings blasting outward from a small dark silhouette at the center, the jolt dominant` },
  { id: 'fullStimulant', prompt: `close-up of a steel-gray breastplate with vivid yellow-green and blue energy lines tracing across the plates like waking circuitry, charge flowing through the armor, no helmet in frame` },
  { id: 'piercingShot', prompt: `a single bullet punching clean through a thick steel plate, the through-hole glowing at the edges, debris bursting out the far side, the piercing trajectory drawn as one straight speed line across the frame, no person, no hands, object-only macro` },
  { id: 'pointShot', prompt: `extreme close-up of a single bullet frozen mid-flight with a thin bright trail, a gun muzzle with a small precise flash at the frame edge, dark background, calm deadly accuracy, no person, no hands, object-only macro` },
  { id: 'suppressionFire', prompt: `countless bright bullet trails streaking across the frame in a dense sweeping fan, a cascade of tumbling spent shell casings catching warm light in the foreground, the sheer density of fire conveying a suppressive barrage, dark background, no person, no hands, no weapon visible, only flying bullet trails and casings` },
  // —— Z 状态卡（没有骑士——画那个东西本身，同一风格） ——
  { id: 'badOmen', prompt: `a huge dark question-mark-shaped shadow looming on a black field, faint cold rim light, ominous painterly smog` },
  { id: 'burnWound', prompt: `a close-up of a bandaged burned forearm, scorched skin edges under the wraps, muted warm pain light` },
  { id: 'dustCloud', prompt: `a billowing blinding dust cloud filling the frame, gray swirling masses, grit in the air` },
  { id: 'inkBlot', prompt: `a glossy black ink splatter exploding across the frame against a pale gray-white ground, sharp tendril shapes frozen mid-splash with crisp edges, strong contrast between the dark ink and the light ground, readable splash silhouette` },
  { id: 'looseLeaf', prompt: `a single loose paper sheet caught mid-air in a gust, tumbling with motion lines, pale sheet on black` },
  { id: 'sidestep', prompt: `a small dark armored silhouette sliding sideways fast in an evasive lean, strong horizontal speed lines trailing behind it, dust kicking up at the heels, the sideways dodge motion clear and readable, close crop` },
  // —— 特殊 ——
  { id: 'gooCard', prompt: `a dripping goo slime blob monster lunging slightly forward, glossy dark masses with pale drips, crude menace` },
  { id: 'rapidFire', prompt: `a gun muzzle firing toward the left in extreme close-up, the bullet leaving with sharp speed lines, warm muzzle flash` },
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
  'spark-2': 'a figure wearing a wide-brim hat and goggles, hundreds of bright sparks bursting and flying everywhere around the raised hands, the whole frame full of glowing points',
  'spark-3': 'an overwhelming storm of hundreds of blazing white-orange sparks flooding the entire frame edge to edge, blinding shower of glowing points, a small figure with a wide-brim hat and goggles barely visible at the bottom edge, no readable book, no props',
  'lightness-3': 'a swirling cyan wind storm of horizontal streaks and air rings sweeping across the dark frame, only one small bright red scarf streak remaining in the wind, no body left',
  'windBlade-3': 'a hurricane of many separate cyan crescent wind blades tearing across the entire frame, overlapping translucent air blades everywhere at different angles, a storm of steel-sharp wind, no person',
};
// 体修虚无后缀（2026-09-22 用户定）：体修越高深越「虚无、简单、幻灭」——这些链的高阶变体
// 不再「更亮更爆」，而是色彩流失、笔触虚幻、趋近黑白（红围巾作唯一残色）。优先级最高。
const ESCALATION_VOID = {
  fastPunch: { // 快拳(B)→炮拳(A)→真拳(S)：真拳归于至简
    3: ', the same straight punch, noticeably desaturated: armor and background drained to muted grays, the edges softened, only the red scarf keeps full color',
    4: ', the same straight punch rendered in pure black and white with harsh contrast, the form reduced to a few blurred essential strokes, pure void-calm, the red scarf the sole spot of color',
  },
  fullCharge: { // 蓄满一击(C/B)→全神一击(A)：全神 = 敛神入空
    2: ', the same wound fist, the colors draining toward gray, a faint white core of stored force now glowing at the knuckles, the charge turning inward and silent',
    3: ', the same charging stance in near monochrome, desaturated grays, soft dissolving edges, all spirit condensed into one blinding white point at the fist',
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
  berserkStance: { // 狂战姿态(B)→狂战掌控(A)：怒吼显形
    3: ', the same roaring helmet, the visor slit now blazing bright white, a pale wild aura flaring off the shoulders, the roar visible as a shockwave ring around the head',
  },
  bloodFist: { // 血拳(B)→血拳(A)：血更盛
    3: ', the same blood sea, the blood a screaming vivid crimson flooding almost the whole frame, glowing with stolen life, the arm plunged to the shoulder, bright vitality light streaming up the arm',
  },
  defensePrep: { // 防御准备(C)→守护姿态(B)→玄龟姿态(A)：玄龟 = 六边龟甲光膜；头盔必须在（首轮出过裸脸）
    2: ', the same overhead open-palm catch, a faint pale energy film now shimmering above the palm with small dust motes settling on it, helmet on, no visible face',
    3: ', the same pose, the energy film hardened into a translucent turtle-shell pattern of glowing hexes above the palm, helmet on, visor in shadow, no visible face',
  },
  endure: { // 忍耐(C)→强撑(B)：甲损尘落
    2: ', the same tiny silhouette, the debris rain far denser and heavier, more dust in the air, still unbroken',
  },
  fistPress: { // 拳压(C)→拳压(B)→拳压(A)：地面裂纹逐级炸开
    2: ', the same downward grinding fist, a wide spiderweb of cracks spreading far under the knuckles, heavy dust rising',
    3: ', the same fist, the ground bursting apart entirely under it, huge cracks ripping outward, debris blasting high',
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
  novice: { // 入门(C)→精通(B)→无双(A)：拳掌间光逐级迸发
    2: ', the same fist-in-palm salute, the grip firmer, a faint resolve glow seeping from the seam between fist and palm',
    3: ', the same salute, radiant light bursting from the seam between fist and palm, peerless conviction',
  },
  powerStance: { // 架势(B)→架势(A)：拳压出冲击环
    3: ', the same pressed knuckles, bright white energy arcs snapping between the two fists, a shockwave ring and dust burst radiating outward, the armor straining and glowing at the seams',
  },
  prepareMove: { // 准备出招(C)→B→A：蓄力显形（首轮「tremor lines/wisps」太虚读不出——换尘土与气旋）
    2: ', the same pulled-back fist, small debris and dust lifting off the ground around it, the gathering force visible',
    3: ', the same fist, dust and pale energy streams spiraling around the forearm, the air shimmering with stored force',
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
  breath: { // 呼吸(C)→武者呼吸(B)→完美呼吸(A)：气息更绵长
    2: ', the same visor close-up, the breath mist now a thick curling plume, faint frost crystals sparkling at the visor edge',
    3: ', the same visor, a perfect slow breath: one long elegant ribbon of pale mist drifting out, total calm',
  },
  cleave: { // 横劈(C)→强力劈(B)→裂空劈(A)：裂空 = 劈开空气
    2: ', the same flat arc, a wider thicker brighter blade-trail, the air visibly splitting with a rip of light behind the edge',
    3: ', the same arc, a huge splitting arc tearing the whole frame open along its path, debris flung',
  },
  cycloneSlash: { // 回旋斩(C)→回旋爆斩(B)→完美回斩(A)：环爆、双环
    2: ', the same ring of blade-light, the steel circle brighter, sparks streaming off the rim',
    3: ', the same ring, a blazing double circle of blade-light, sparks storming outward',
  },
  edgeBreath: { // 含刃术(C→B→A)：刃更寒
    2: ', the same blade held at the visor, the steel brighter, a faint cold gleam along the edge',
    3: ', the same pose, the blade gleaming razor-bright, cold light running along the edge, breath mist curling off the steel',
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
  flyingDagger: { // 飞刀(C)→强力飞刀(B)→绝灭飞刀(A)：刀尾光轨
    2: ', the same throwing knife, a long bright speed trail now stretching across the whole frame, the knife blurred with speed',
    3: ', the same knife, a screaming triple-bright trail with a spark wake, the tip glowing white-hot, annihilating momentum',
  },
  handCleave: { // 花刀(C→B)→蔽目花刀(A)：蔽目 = 耀目刀幕
    2: ', the same circle of blade-light, the spinning streak brighter and wider, more sparks riding the rim, no readable body, no face',
    3: ', the same circle, a dazzling blinding fan of white arc light veiling the whole frame, no readable body, no face',
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
  // —— 预防性定制（主批后半段的安静/青绿键——通用「blazing」会把木绿/风青拉成橙，且微距无钩可读） ——
  miasma: { // 瘴气：毒雾逐浓
    1: ', the same cloud, thicker, more droplets beading',
    2: ', the same arm, a far denser opaque green cloud engulfing it, heavy poison dripping',
    3: ', the same arm, a huge roiling opaque miasma filling the entire frame',
  },
  woodBark: { // 树皮甲：甲皮逐厚（审计：低阶钢铁化、木元素缺席——点名藤蔓/苔藓）
    1: ', the same forearm, green living vines now clearly winding around the vambrace between the steel plates, sprouting leaf buds',
    2: ', the same forearm, the steel half-overgrown with thick bark plates and green moss, ancient wood armor emerging',
    3: ', the same forearm, a full ancient-tree bark shell: massive ridged plates, green vitality glowing in the seams',
  },
  woodSting: { // 飞刺：刺雨逐密
    1: ', the same thorny stinger, two more smaller stingers now flanking it in a loose volley, brighter poison drops',
    2: ', the same thorny stingers, a wide fan of five identical stingers spread across the frame, glistening drops on every tip',
    3: ', the same thorny stingers, a dense storm of stingers with green trails filling the frame',
  },
  breathOfLife: { // 育苗：苗逐壮
    1: ', the same cupped soil, the seedling taller with one more bright leaf, the light ring a touch brighter',
    2: ', the same cupped soil, the seedling grown into a small lush sapling, vivid green glow, the light ring radiant',
  },
  airFloat: { // 浮空：浮更高
    1: ', the same levitation, floating higher, the pale air ring beneath brighter, more debris motes orbiting',
    2: ', the same levitation at a steeper tilt, a bright double air ring beneath, the scarf streaming straight up, weightless',
  },
  atEase: { // 云坐：云逐软
    1: ', the same cloud float, the cloud clearly bigger and fluffier, deeper relaxation',
    2: ', the same pose, a grand fluffy cloud filling half the frame, two drifting motes of dream-light',
    3: ', the same pose on a glowing cloud throne filling the frame, soft radiance all around, total serenity',
  },
  bathWind: { // 放羽：羽环逐多
    1: ', the same feather release, two feathers floating, more air rings drifting',
    2: ', the same release, a small swirl of feathers wrapped in bright cyan air rings',
  },
  lightness: { // 化风：人逐散
    1: ', the same dodge, more blurred, an extra cyan air ring',
    2: ', the same dodge, the body now half transparent and breaking apart into horizontal streaks and cyan rings',
    3: ', the same gust, the body almost fully vanished: just a swirling cyan wind storm and one small red scarf streak blowing in it',
  },
  windBlade: { // 风刃：刃逐大（C 连击=多刃必须点名数量）
    1: ', the same cyan crescents, now three separate blades slashing in quick diagonal succession',
    2: ', the same crescent, huge and bright with gust rings trailing',
    3: ', the same crescents, a massive tearing blade-storm, the air ripped open',
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
  shock: { // 冲击：冲击环逐级翻倍
    2: ', the same fist, a double shockwave ring, more debris pushed outward',
    3: ', the same fist, a colossal shockwave ring shattering outward across the whole frame',
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
  spark: { // 火花：花爆逐级满框（人物锁定：宽檐帽+护目镜，flash 取读自基图；-3 走 T2I 直出）
    2: ', the same figure with the same wide-brim hat and goggles, a far bigger burst with twice as many bright sparks flying, no readable book',
    3: ', the same figure with the same wide-brim hat and goggles at the bottom edge, an overwhelming storm of blazing sparks flooding the entire frame, no readable book, no props',
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
  herbPaste: { // 草药（旧 woodHerb 键改名）——审计：四阶平移，逐级点名体量
    1: ', the same gentle grip, the herb noticeably larger with three bright leaves, a stronger green glow halo',
    2: ', the same gentle grip, a lush bundle of glowing leaves nearly filling the palm, drifting light motes, vivid green radiance',
    3: ', the same gentle grip, a huge bursting spray of radiant leaves and curling tendrils overflowing the hand, the frame washed in green light',
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
  woodBlood: {
    2: ', the same hand and vine, more thorns coiling further up the wrist, more glowing dark-red sap dripping',
  },
  extract: {
    2: ', the same pull, the iridescent ribbon wider and brighter, stronger green-yellow-blue shimmer',
    3: ', the same pull, a torrent of iridescent green-yellow-blue light erupting from the cracking rock, the ribbon flooding the frame',
  },
  drawQi: {
    2: ', the same inhale, the pale blue streams thicker and brighter, clearly more streams rushing in from farther away',
    3: ', the same inhale, a vortex storm of pale blue light converging from every direction, the silhouette chest glowing as it fills',
  },
  purify: {
    2: ', the same gauntlet, a small waterfall of clear water pouring over it, the stain dissolving',
    3: ', the same gauntlet, a huge sparkling torrent of water flooding over it, brilliant purity',
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
  burnSnap: { // 燃爆(B)→A：爆得更烈
    3: ', the same pinch, the detonation now a violent fire pillar blasting up through the fingers, shrapnel sparks filling the frame',
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
    if (firstNew) refPath = firstNew; // 下一级锚定本级的首张新图，逐代传递
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
  DENOISE = VAR_DENOISE;
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
