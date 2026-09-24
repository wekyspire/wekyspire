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
const NEGATIVE = 'outline, line art, ink lines, thin lines, cel shading, flat shading, clean vector, anime, cartoon network style, detailed, intricate, fine texture, realistic, photorealistic, photographic, 3d render, smooth airbrush gradients, airbrush rendering, armor panel lines, rivets, glossy, ornate, environment scenery, text, letter, watermark, signature, border, frame, white background, multiple panels, small subject, tiny subject, distant full body, wide shot, emblem, logo, icon, sticker, glowing eyes, luminous pupils, black helmet, dark helmet, extra fingers, six fingers, mutated hand, deformed fingers, shiny chrome, shield, buckler, kite shield, round shield, tower shield, katana, scimitar, curved saber, dao';

// 动作场景表：每键一句「谁在干什么」，骑士是玩家卡的演员；
// Z 状态/敌方衍生卡没有骑士——画那个东西本身（同一风格）。
// 武装设定（2026-09-22 用户定）：骑士**无盾**（格挡只靠臂甲）；佩**大剑**（直刃双手巨剑，非刀）。
// 防同图纪律（2026-09-22 用户试玩发现「不同系列图完全一样」）：同一演员 + 紧特写口径下，
// 「骑士胸前一点小火光」式 prompt 必然收敛成同一张图——写 prompt 必须**先定构图轴**
// （机位：正面/背影/侧脸/俯视/手部特写/铠甲特写；姿态：站/跪/坐/浮/掷/倒；景别：半身/全身/微距），
// 再填内容物。近义键（掌火系、咏唱系、格挡系）两两构图轴不得相同。
// 家族色彩锚点（2026-09-22 用户定）：**体修 = 骑士本体 + 大面积黑/灰黑**；**火系 = 橙黄橙红为
// 主体、骑士只占小面积或仅暗示存在（激烈爆裂为视觉锚点）**；**普通卡 = 绿黄蓝等无冷暖倾向的
// 多彩中性色**（既有别于火系，又有别于体修）。骑士不必全脸出镜——只露一只手、或只暗示
// 骑士存在时表现力往往更强。木系绿、风系青为既有家族色，不动。
// 体修虚无 flavor（2026-09-22 用户定）：体修越高深，内核越「虚无、简单、幻灭、空洞」
// （空形拳/摘星手/断神斩，联动骑士破灭虚无主义者的性格曲线）——S 级与高阶变体倾向
// 低饱和、纯黑白强对比、笔触模糊虚幻；按卡名与意境选择性落实，不一刀切。
const SCENES = [
  // —— 体修大系 ——
  { id: 'fierceFist', prompt: `${KNIGHT}, exaggerated foreshortening: a huge five-fingered gauntlet fist filling the left half of the frame aimed left, the knight charging right behind it, red scarf sweeping across, bright impact ring on the knuckles` },
  { id: 'slash', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its plain honest steel blade catching a diagonal edge of light, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, quiet grounded mood` },
  { id: 'duckHead', prompt: `${KNIGHT}, blocking a heavy blow with crossed armored forearms raised in front of the visor, the vambrace taking the impact with bursting sparks, helmet low behind the arms, braced stance` },
  { id: 'punch', prompt: `${KNIGHT}, lunging toward the left, leading with a heavy straight punch, tight crop on the torso and the leading fist, charging momentum, red scarf streaming behind` },
  { id: 'focusChant', prompt: `extreme close-up of two steel-gray armored gauntlets pressed together in prayer, a single bright drop of light floating between the palms, the hands filling the entire frame, no helmet in frame, dark background` },
  // —— 体修·拳组合（过牌；骑士本体 + 大面积黑灰） ——
  { id: 'fastPunch', prompt: `side view of ${KNIGHT}, delivering a clean straight punch toward the left, fist leading with a sharp speed line, compact efficient form` },
  { id: 'fullCharge', prompt: `extreme close-up of a steel-gray fist wound far back behind the shoulder, coiled to its limit, every plate trembling with stored force, side view, maximal wind-up, dark background` },
  { id: 'wildPunch', prompt: `${KNIGHT}, swinging a wild desperate haymaker, blood trickling from under the vambrace, reckless full-body swing, red scarf whipping` },
  { id: 'wildFlurry', prompt: `${KNIGHT}, throwing a flurry of rapid punches toward the left, multiple fist afterimages trailing the arms, a blurring rain of blows` },
  { id: 'agileCombo', prompt: `${KNIGHT}, light on his feet landing a quick one-two jab, nimble bouncing stance, fast snappy hits` },
  { id: 'counterDraw', prompt: `extreme close-up of an open steel-gray palm deflecting sideways, the redirecting parry with glancing motion lines, a precise counter-catch, dark background` },
  { id: 'mimicFist', prompt: `extreme close-up of a steel-gray armored hand shaped into a pouncing beast claw, fingers hooked like a feral paw, imitation-beast form, no helmet in frame, dark background` },
  { id: 'snakeFist', prompt: `extreme close-up of a steel-gray armored hand pressed into a striking snake-head point, two fingers extended as fangs, sinuous whip-fast motion lines, no helmet in frame, dark background` },
  { id: 'dragonFist', prompt: `extreme close-up of a steel-gray armored fist rearing upward like a rising dragon's head, the knuckles forming the dragon's brow, ascending coiled motion, no helmet in frame, dark background` },
  { id: 'voidFist', prompt: `extreme close-up of a steel-gray armored open palm held empty and open toward the viewer, the hand and wrist half-dissolved into gray mist, near black and white, hollow void-calm, no helmet in frame, dark background` },
  { id: 'emptyFist', prompt: `extreme close-up of a steel-gray armored open palm in a single still strike, the hand half-dissolved into blank emptiness, stark black and white with hard white rim light, the air cracking around the fingers, no helmet in frame, dark background` },
  { id: 'chargeUp', prompt: `${KNIGHT}, fists pressed together gathering crackling force between the gauntlets, storing power for the coming strikes` },
  { id: 'endlessCombo', prompt: `a sweeping row of overlapping punch afterimages trailing across the frame, five sequential steel-gray fists blurring one after another in a single flowing barrage, the knight's body a smear of motion behind them, endless combo, dark background` },
  { id: 'instantThousand', prompt: `${KNIGHT}, unleashing an instant barrage, a wide fan of desaturated gray fist afterimages erupting all at once, time frozen, the colors draining out of the scene, blurred illusory motion, near-monochrome` },
  { id: 'instantStrike', prompt: `extreme close-up of a steel-gray armored fist landing a flash-fast jab toward the left, sharp motion lines, dark background` },
  { id: 'adrenaline', prompt: `extreme close-up of a steel-gray fist slamming into an open armored palm, the psych-up gesture, a sharp impact burst and motion lines, raw adrenaline, dark background` },
  { id: 'crashLanding', prompt: `${KNIGHT}, mid-air driving a crashing elbow drop downward, full bodyweight behind the elbow, impact dust bursting` },
  { id: 'elbowMaster', prompt: `extreme close-up of a legendary steel-gray elbow joint presented heroically to the camera, a gleaming point of armor, comedic reverence for the boss elbow, dark background` },
  { id: 'elbowReturn', prompt: `extreme close-up of a steel-gray elbow thrust skyward in triumph, raised high like a returning champion, dramatic backlight on the point, dark background` },
  { id: 'elbowStrike', prompt: `extreme close-up of a steel-gray elbow mid-swing, the pointed elbow joint leading the strike with sharp motion lines, no helmet in frame, dark background` },
  { id: 'feint', prompt: `${KNIGHT}, a deceptive feint, the body blurred in a fake-out sway, an afterimage leaning the wrong way` },
  { id: 'fistPress', prompt: `extreme close-up of a steel-gray fist pressing downward with crushing weight, the air compressed beneath the knuckles, grinding pressure, dark background` },
  { id: 'hunYuanPlus', prompt: `extreme close-up of two steel-gray palms circling each other in a flowing exchange, one upturned one downturned, a small swirl of air spiraling between them, cyclical motion, dark background` },
  { id: 'leverage', prompt: `extreme close-up of a steel-gray plate gauntlet catching a bright incoming force streak and turning it aside, the redirected force curving away past the medieval knight armor, gauntlet clearly armored, no robes no fabric, dark background` },
  { id: 'novice', prompt: `extreme close-up of a steel-gray fist pressed gently into an open armored palm in a formal martial salute, the beginner's greeting, respectful stillness, dark background` },
  { id: 'wildFist', prompt: `extreme close-up of a steel-gray fist flickering through multiple ghostly phantom hand shapes, ever-changing afterimages of open palm claw and fist overlapping it, the ten-thousand-change fist, dark background` },
  { id: 'voidCard', prompt: `a blank translucent ghostly playing card fading at the edges, empty nothingness, pale dim outline on black` },
  // —— 体修·刀组合（卡序；大剑动作族） ——
  // 斩局内进阶链 v3（2026-09-22 用户三轮迭代）：**刀刃当主角、骑士淡化**（半露于画缘，S 级成剪影）；
  // prompt 只写可直接入画的具体景物（不为难 AI 具象化「斩金断石」）；明度/能量严格渐强——
  // 暗钢 → 金火花 → 沙暴 → 碧涛 → 白光 → 泛白，让玩家一眼读出「一重更比一重强」。
  // 链内全部键共享同一取景句式（级联锁构图），每级四轴变身：刀刃形态色泽/背景景物/明度能量/骑士存在感。
  { id: 'rockCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its steel blade chipped and dusty gray, a big boulder split into two halves behind the blade with rock chunks and brown-gray dust settling, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, dim dusty mood` },
  { id: 'goldCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its edge glowing golden-hot, a sheared metal column stump beside the blade with a shower of golden sparks and metal shards flying, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dark background, warm spark-lit mood` },
  { id: 'mountainCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its blade broadened and humming, visible shockwave rings rippling the air around the blade, a mountain peak behind with massive clouds of dust and sand blasting off its slopes, gravel and sand storming outward in every direction, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, violent storm-force mood` },
  { id: 'seaCleave', prompt: `a heavy two-handed greatsword huge and dominant across the frame, its blade wrapped in streaming water ribbons, two towering walls of seawater parting to the left and right of the blade with white foam and spray between them, the knight only half-visible at the frame edge gripping it with both gauntlets, red scarf at the corner, dramatic cool blue mood` },
  { id: 'skyCleave', prompt: `a colossal blade of condensed white light huge and dominant across the frame, its radiant edge flaring, dark storm clouds split open in a huge rift behind the blade with a waterfall of pale light pouring through, the knight a small silhouette at the frame edge gripping it with both gauntlets, red scarf vivid, blazing bright mood` },
  { id: 'godCleave', prompt: `a colossal arc of void-white fire huge and filling the entire frame, its edge dissolving into drifting sparks of light, a vast radiant figure of pale light collapsing and scattering into ash-like fragments behind the blade, the knight a near-invisible silhouette at the frame edge with only the red scarf vivid, the frame flooding toward white, overwhelming god-slaying mood` },
  { id: 'ironShard', prompt: `a burst of jagged iron shards flying toward the left, sharp metal fragments, dark background` },
  { id: 'handCleave', prompt: `${KNIGHT}, a flashy showy flourish of his greatsword, the blade spinning in a decorative arc, stylish guarding sweep` },
  { id: 'perfectCleave', prompt: `a flat rosette of interlaced blade-arc trails blooming like a steel flower facing the camera, ornate defensive flourish pattern, no person visible, dark background` },
  { id: 'silverDance', prompt: `${KNIGHT}, dancing with his greatsword in a flowing spin, the blade tracing silver ribbons around him, a graceful deadly dance` },
  { id: 'graceDance', prompt: `a steel-gray knight in an elegant flowing blade dance, his sword tracing one smooth continuous ribbon of light in a tall graceful arc, poised and unhurried, dark background` },
  { id: 'cycloneSlash', prompt: `${KNIGHT}, a full spinning round slash, the greatsword sweeping a complete circle, rotational force, scarf flung outward` },
  { id: 'cleave', prompt: `${KNIGHT}, a wide horizontal cleave sweeping across the whole frame, the greatsword arc huge and flat, hitting everything at once` },
  { id: 'flyingDagger', prompt: `${KNIGHT}, hurling a throwing knife toward the left, arm snapped forward in the throw, the dagger streaking with a speed line` },
  { id: 'returningDagger', prompt: `extreme close-up of a curved throwing dagger spinning back into an open steel-gray gauntlet, the returning catch, a circular motion trail closing the loop, dark background` },
  { id: 'fineDagger', prompt: `extreme close-up of an ornate slim throwing dagger pinched between steel-gray gauntlet fingers, fine craftsmanship gleaming, dark background` },
  { id: 'perfectDagger', prompt: `extreme close-up of a single dagger frozen mid-spin in the air, concentric motion rings around its rotation, a flawless trajectory line, no person, no hands, the dagger alone, dark background` },
  { id: 'storeEdge', prompt: `extreme close-up of a long blade being slowly slid back into its sheath, only a sliver of bright edge still visible, concealed sharpness, quiet tension, dark background` },
  { id: 'breath', prompt: `extreme close-up of a steel-gray helmet visor with slow visible breath misting in the cold air, calm rhythmic breathing, two faint breath clouds, dark background` },
  { id: 'honeBlade', prompt: `${KNIGHT}, carefully drawing a whetstone along his greatsword's edge, tender blade-care, soft sparks` },
  { id: 'forgingBlade', prompt: `${KNIGHT}, hammering the edge of his greatsword on an anvil, forging sparks flying, the blade glowing hot` },
  { id: 'edgeBreath', prompt: `extreme close-up of a steel-gray helmet visor with a small throwing blade held horizontally at the slit like held in teeth, the held-edge trick, dark background` },
  { id: 'unsheathe', prompt: `extreme close-up of a long blade mid-draw flashing halfway out of its sheath, the exposed steel catching a streak of light, sharp draw motion, dark background` },
  { id: 'whetstone', prompt: `extreme close-up of a whetstone grinding bright sparks off a greatsword edge, steel-gray gauntlets working the stone, no helmet in frame, dark background` },
  { id: 'honeEdge', prompt: `extreme close-up of a steel-gray gauntlet wiping a greatsword's edge with a dark cloth, the wiped line gleaming mirror-bright against the dull steel, a bright gleam streak revealing, no helmet in frame, dark background` },
  { id: 'annihilatingEdge', prompt: `${KNIGHT}, his greatsword wreathed in a dark annihilating aura, the edge humming with destructive certainty` },
  { id: 'practiceBlade', prompt: `a wooden training post with a clean diagonal cut through it, the severed top half sliding off mid-fall, sawdust and wood fibers flying, a fading blade-arc afterimage, quiet precise practice cut, no person visible, dark background` },
  { id: 'quickCleave', prompt: `extreme close-up of a greatsword mid-spin whipping in a short snappy arc, strong motion blur on the fast blade, only steel-gray gauntlets on the grip, tight crop, speed lines, no helmet in frame, dark background` },
  { id: 'quickDrawShield', prompt: `extreme close-up of a greatsword being whipped horizontally into a flat guard, half-drawn with sharp draw speed lines, the flat of the blade catching light like a barrier, only steel-gray gauntlets, no helmet in frame, dark background` },
  { id: 'ironRain', prompt: `a rain of jagged iron shards pouring down across the frame, a metallic storm, dark background` },
  { id: 'bladeArt', prompt: `extreme close-up of a long blade tracing a single sharp technique arc, the edge leaving a clean bright motion line, precise swordcraft, no person visible, dark background` },
  { id: 'bladeHeart', prompt: `extreme close-up of a long blade held flat across the chest over the heart, both steel-gray gauntlets cradling it gently, the blade resting against the armor like a cherished heart, quiet devotion, dark background` },
  // —— 体修·拆组合（格挡；防御与姿态） ——
  { id: 'carefulStrike', prompt: `${KNIGHT}, a precise measured palm strike toward the left, exact surgical form, perfect balance and timing` },
  { id: 'doubleStrike', prompt: `${KNIGHT}, landing two punches in one instant, twin afterimage fists striking the same point, two impact bursts side by side, one knight only, tight crop` },
  { id: 'pluckStar', prompt: `near-monochrome: ${KNIGHT}, reaching high into an empty black sky, the gauntlet closing around a single pale dim point of light, the body in desaturated grays dissolving at the edges, vast hollowness all around, one faint star, no warm color` },
  { id: 'breakStance', prompt: `${KNIGHT}, smashing through an enemy guard with a breaking strike, a structure-collapsing impact` },
  { id: 'barrier', prompt: `extreme close-up of two crossed steel-gray vambraces stacked like a fortress wall filling the entire frame, interlocking armor plates like bricks, an immovable bulwark of steel, no helmet in frame, dark background` },
  { id: 'shatterHit', prompt: `extreme close-up of a steel-gray armored fist punching straight at the camera, the knuckle impact bursting with white fracture cracks radiating through the air, the shattering blow frozen at contact, no helmet in frame, dark background` },
  { id: 'soulOfWar', prompt: `a steel-gray knight with a pale spectral flame aura rising from his shoulders, ghost-white war-spirit fire licking upward without heat, an otherworldly warrior soul, dark background` },
  { id: 'heavyStomp', prompt: `low angle of ${KNIGHT}, a low sweeping leg kick across the ground, dust kicked up in a wide arc, an ankle-level sweep` },
  { id: 'endure', prompt: `${KNIGHT}, down on one knee bracing his crossed vambraces over the helmet, dented armor taking a heavy hit, dust settling, grim immovable endurance, low angle` },
  { id: 'guard', prompt: `${KNIGHT}, raising one vambrace as a shield before the visor, protective forearm cover, a solid guard` },
  { id: 'defensePrep', prompt: `extreme close-up of an open steel-gray palm raised in a calm catching gesture, fingers spread ready to receive a blow, quiet defensive preparation, dark background` },
  { id: 'turtleStance', prompt: `extreme close-up of a steel-gray knight curled into a tight armored ball, knees elbows and helmet interlocked into a rounded shell of plate armor, no face visible, a living turtle shell, dark background` },
  { id: 'divineTurtle', prompt: `a steel-gray knight curled into a tight armored ball, brilliant golden light pouring from every seam between the interlocked plates, a sacred divine turtle shell glowing like a relic, holy radiance flooding the dark, dark background` },
  { id: 'martialStance', prompt: `extreme low close-up of two steel-gray armored boots planted wide in a deep horse stance, ground-level view, dust settling around the greaves, an immovable foundation, dark background` },
  { id: 'berserkStance', prompt: `extreme close-up of a steel-gray helmet thrown back in a berserker's roar, the visor slit flaring bright, fury tremor lines shaking the frame, dark background` },
  { id: 'fastRain', prompt: `a steel-gray knight in a blur of rapid rhythm, rain-like streaks of speed lines pouring diagonally across the frame, relentless flowing tempo, dark background` },
  { id: 'prepareMove', prompt: `extreme close-up of a steel-gray fist chambered tight at the waist, coiled with held-back force, side view, quiet trembling tension before the strike, dark background` },
  { id: 'rally', prompt: `extreme close-up of a steel-gray gauntlet grabbing its own shoulder pauldron in a limbering warm-up stretch, loosening the joints, small motion tremors, dark background` },
  { id: 'bloodFist', prompt: `${KNIGHT}, his gauntlet dripping blood that glows with stolen vitality, a grim life-draining fist` },
  { id: 'powerStance', prompt: `extreme close-up of two steel-gray fists pressed knuckle-to-knuckle in front of the chest, force doubling between them, trembling power lines, dark background` },
  { id: 'winWithout', prompt: `${KNIGHT}, holding up a single playing card between two fingers, calm confidence with nothing left, minimal composition` },
  { id: 'haveWithout', prompt: `${KNIGHT}, fanning a full hand of playing cards wide, abundance as armor, a confident display` },
  // —— 火大系（火光映甲） ——
  { id: 'gatherFlame', prompt: `a single huge torch flame roaring upward filling most of the frame, only a steel-gray armored gauntlet visible at the bottom edge holding it aloft, the orange-yellow fire mass dominant, sparks flying` },
  { id: 'emberMote', prompt: `extreme close-up of a glowing charcoal ember chunk cradled in darkness, its bright orange cracks filling the frame with warm light, only the edges of steel-gray gauntlet fingers visible around it` },
  { id: 'fireControl', prompt: `a large serpentine whip of fire arcing across the frame, guided by a single steel-gray gauntlet at the frame edge, the orange fire serpent dominant, embers trailing in its wake` },
  { id: 'fireworks', prompt: `${KNIGHT}, hurling an exploding fireball toward the left, the explosion burst large in frame, arm still extended from the throw` },
  { id: 'fireBolt', prompt: `a huge roaring fireball mid-flight filling the frame with a long blazing tail toward the left, only the knight's throwing gauntlet visible at the rear corner edge, the orange fireball dominant` },
  { id: 'inflame', prompt: `extreme close-up of a steel-gray armored hand snapping its fingers, a small flame just catching on the thumb tip, sparks flying from the snap, dark background` },
  { id: 'fuelTheFire', prompt: `a fierce blaze filling the lower half of the frame, a burning playing card tumbling down into it from above, only the knight's tossing gauntlet at the top edge, flames flaring up` },
  { id: 'playWithFire', prompt: `a steel-gray gauntlet idly twirling a ribbon of flame around one raised finger like a coin trick, playful casual fire manipulation, small fire dancing between the armored fingers, no helmet in frame, dark background` },
  { id: 'allIn', prompt: `${KNIGHT}, arms spread wide as his own cards burst into flame around him, burning card scraps swirling upward, drawing a violent surge of fiery power out of the burning cards, desperate all-in eruption` },
  { id: 'flameBirth', prompt: `a tiny newborn flame cradled in two cupped steel-gray gauntlets, extreme close-up on the small delicate fire, warm glow on the armored fingers, tender scale contrast between huge hands and little flame, dark background` },
  { id: 'flameHeal', prompt: `${KNIGHT}, head tilted up with arms open at his sides as warm golden light pours down over his shoulders and helmet from above, healing glow washing the armor, gentle embers rising` },
  { id: 'highFever', prompt: `a steel-gray knight hunched forward enduring an internal burn, bright molten light leaking through the gaps between his armor plates and from his helmet slit, glowing white-hot cracks of light across his chest and pauldrons, his body a lit furnace inside the steel shell, heat shimmer warping the air, no flames outside the armor` },
  { id: 'warmUp', prompt: `many small candle flames floating in a loose ring in the dark, a small steel-gray knight seen from behind standing among them, the ring of warm flames dominant, tiny bright points everywhere` },
  { id: 'melt', prompt: `${KNIGHT}, pouring a stream of molten metal from a crucible, the glowing liquid bright against the dark, visor reflecting the glow` },
  { id: 'explosiveArt', prompt: `a huge festive fireworks burst filling the entire frame in orange and gold, a small knight silhouette at the bottom edge looking up, the explosion dominant` },
  { id: 'fireWhirl', prompt: `${KNIGHT}, spinning with a tornado of fire around him, the fire whirl wrapping the frame, scarf pulled into the spiral` },
  { id: 'residualHeatPlus', prompt: `${KNIGHT}, holding up a cooling gauntlet with faint heat waves and dim embers, the fight already over, subdued orange glow` },
  { id: 'fireTemper', prompt: `a forge blaze roaring across the frame, a glowing hot blade held into the fire by tongs, a storm of sparks, only the knight's arm silhouette at the frame edge, the fire and molten glow dominant` },
  { id: 'hotHands', prompt: `${KNIGHT}, shaking his burning-hot gauntlets, small flames dancing on the fingers, recoiling pose` },
  { id: 'silence', prompt: `${KNIGHT}, snuffing a candle flame between two gauntlets, a thin smoke wisp rising, the light just dying out` },
  { id: 'relief', prompt: `${KNIGHT}, wrenching open a round pressure valve, steam blasting out sideways, both hands on the valve wheel` },
  { id: 'kindling', prompt: `${KNIGHT}, a bleeding cut on his forearm, the blood drops catching small flames, arm held up close in frame` },
  { id: 'fireRain', prompt: `${KNIGHT}, an armored forearm raised overhead as cover under a rain of burning drops, fire rain streaking down around him` },
  { id: 'firstStrike', prompt: `a flaming dart huge in frame streaking toward the left with a long fire trail, only the knight's extended throwing arm visible at the rear edge, the dart and its trail dominant` },
  { id: 'patience', prompt: `extreme close-up of an upturned steel-gray armored palm, a drop of dark blood on it with a slow dark-red flame rising from the drop, ominous stillness, dark background` },
  { id: 'fireWall', prompt: `${KNIGHT}, standing behind a rising wall of flames, the fire wall filling the left frame, silhouetted through the fire` },
  { id: 'burnBurstPlus', prompt: `two identical mirrored flames drifting apart filling the frame, a single open steel-gray gauntlet between them at the bottom edge, the doubling fire pair dominant` },
  { id: 'willOWisp', prompt: `${KNIGHT}, reaching toward a pale blue-white ghost flame floating freely in the air beside him, cold wisp light on the visor and gauntlet, the wisp drifting just beyond his fingers` },
  { id: 'mirrorBurn', prompt: `${KNIGHT}, holding up a mirror shard reflecting a bright flame, the reflected fire large in the shard, dark around` },
  { id: 'spark', prompt: `${KNIGHT}, striking a burst of tiny sparks off his gauntlets, the spark burst filling the frame, sharp bright points` },
  { id: 'shock', prompt: `${KNIGHT}, landing a fiery impact punch toward the left, a shockwave ring exploding from the fist, debris pushed outward` },
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
  { id: 'heatWave', prompt: `a rolling wall of visible heat distortion blasting toward the left, shimmering air ripples large in frame, the ground below scorched black, only the knight's pushing palm at the right edge` },
  { id: 'burnSnap', prompt: `extreme close-up of two steel-gray gauntlet fingers pinching a flame and crushing it into a violent detonation, the fire collapsing inward then bursting through the fingers, dark background` },
  { id: 'fireControlDisturb', prompt: `many scattered flames across the frame streaming like iron filings toward a single steel-gray gauntlet at the center, the fires converging and swirling into the palm, gathering motion lines` },
  { id: 'fireControlBurn', prompt: `${KNIGHT}, half-body portrait, an upturned steel-gray gauntlet palm holding a single bright flame at his side, the flame the only light source, dark background, calm controlled fire` },
  { id: 'fireControlRefine', prompt: `a bright orange flame and a black smog mass colliding mid-frame and annihilating each other in white sparks, paired cancellation, a steel-gray gauntlet directing the clash from the bottom edge` },
  { id: 'fireControlScorch', prompt: `extreme close-up of a steel-gray gauntlet fist being dipped and coated in thick clinging flame, fire wrapping the knuckles like fuel, loaded for the next strike, dark background` },
  { id: 'fireControlSupreme', prompt: `an open steel-gray gauntlet palm-up with a whole court of tiny shaped flames hovering above it — a ring, a serpent, a blade, a bird — every flame bending to one will, supreme mastery, dark background` },
  // 自焚/焰愈/焚天/镜燃/燃心
  { id: 'redHotBlade', prompt: `${KNIGHT}, holding his greatsword low with the blade glowing red-hot from within, heat shimmer rising off the metal, embers dripping from the edge, the glowing blade the brightest thing in frame` },
  { id: 'immolateGrand', prompt: `everything in the frame consumed by white-hot incinerating fire, a knight silhouette at the center walking forward out of the inferno unburned, total annihilation blaze, the white fire dominant` },
  { id: 'nirvana', prompt: `a steel-gray knight kneeling inside a blooming lotus of fire, new bright armor gleaming through the burning old shell, rebirth from the flames, rising fire petals filling the frame` },
  { id: 'burnBurstStar', prompt: `a star-shaped flame erupting in three blinding points, the triple-pronged star fire huge in frame, radiating triple heat waves, only a steel-gray gauntlet at the bottom edge presenting it` },
  { id: 'karmaFire', prompt: `${KNIGHT}, struck by flames on one shoulder while an equal stream of fire pours off his other arm redirected outward toward the left, the fire passing through him like a conduit, karma reflected` },
  { id: 'burningHeart', prompt: `a steel-gray knight clutching his chest as fire glows through the seams of his breastplate, the heart burning inside the armor, orange light leaking from every plate gap, tight torso crop` },
  { id: 'absoluteFlame', prompt: `flames frozen mid-flicker like red glass, locked at their peak forever, crystallized fire shards suspended in air, a steel-gray gauntlet touching the frozen flame surface, absolute stillness` },
  { id: 'flameCloak', prompt: `a steel-gray knight seen from behind wearing a long flowing cloak made entirely of fire, the flame-cape billowing wide and filling the frame, embers trailing from its hem, helmet turned slightly left` },
  { id: 'smeltCard', prompt: `extreme close-up of a playing card melting down in a steel-gray gauntlet's grip, its edges dripping molten glowing metal that pools into a bright ingot below, smelting heat, dark background` },
  { id: 'douseFlame', prompt: `a burning steel-gray knight doused from above, his flames collapsing into a huge burst of steam, fire dying across the armor, the steam cloud filling the frame` },
  { id: 'expand', prompt: `a steel-gray knight with arms pushed wide apart as the space between his gauntlets visibly expands and stretches, a growing fire swelling in the gap, capacity blooming outward, symmetric composition` },
  { id: 'fireAffinity', prompt: `a small gentle flame bending down like a bowing figure over an open steel-gray gauntlet, the fire showing favor, a warm intimate glow, quiet blessing, tight close-up` },
  { id: 'fireMastery', prompt: `concentric rings of fire orbiting a steel-gray knight like layered shields, each flame ring spinning at a different height, mastery of the element, the fire rings filling the frame` },
  { id: 'fireWard', prompt: `a wave of fire splashing against an invisible barrier around a calm steel-gray knight, the flames parting around him like water around a stone, a ward circle traced in light` },
  { id: 'shockCard', prompt: `extreme close-up of a steel-gray knight flinching, shoulders hunched and arms half-raised in a startle, a cold shock ripple stamped across the armor, intimidated, dark background` },
  // —— 木大系 ——
  { id: 'herbPaste', prompt: `${KNIGHT}, holding a sprouting herb with two bright leaves in his gauntlet, soft green light, careful gentle grip` },
  { id: 'miasma', prompt: `${KNIGHT}, conjuring a swamp miasma cloud with droplets over his palm, sickly green vapor curling around the arm` },
  { id: 'woodBark', prompt: `extreme close-up of a steel-gray armored forearm held across the frame, thick tree-bark plates sprouting over the vambrace, bark texture in big planes, no helmet in frame` },
  { id: 'breathOfLife', prompt: `top-down view: two steel-gray armored gauntlets cupping soil with a tiny sprouting seedling inside a ring of soft light, the rim of a rounded helmet just at the top edge of the frame, ground-level composition` },
  { id: 'woodSting', prompt: `${KNIGHT}, hurling a thorny stinger toward the left, a poison drop glistening on its tip, throwing motion` },
  { id: 'woodBlood', prompt: `close-up of a steel-gray armored hand pressing onto a thorned black vine, thorns pricking the palm seam, drops of glowing dark-red sap welling up, the vine coiling around the wrist` },
  // —— 风大系 ——
  { id: 'windBlade', prompt: `${KNIGHT}, slashing a crescent wind blade toward the left, the cyan slash large in frame, scarf whipped by the gust` },
  { id: 'lightness', prompt: `${KNIGHT}, dissolving into a swirling gust spiral, motion-blurred dodge toward the right, cyan air rings` },
  { id: 'bathWind', prompt: `${KNIGHT}, releasing a single feather from his fingers, air rings floating around it, head tilted in chant` },
  { id: 'atEase', prompt: `${KNIGHT}, floating cross-legged on a soft cloud puff, relaxed weightless pose, scarf drifting slowly` },
  { id: 'airFloat', prompt: `${KNIGHT}, levitating high off the ground at a tilted diagonal, boots dangling, red scarf drifting straight upward, a ring of pale cyan air beneath him, weightless floating pose` },
  // —— 通用灰卡家族（骑士的日常动作） ——
  { id: 'purify', prompt: `${KNIGHT}, washing a dark stain off his gauntlet with a bright clear water drop, the stain dissolving, close on the hands` },
  { id: 'extract', prompt: `a steel-gray armored hand pulling a long iridescent ribbon of light out of a small gray rock, the ribbon shimmering green, yellow and blue like an oil sheen, stretched taut across the frame` },
  { id: 'drawQi', prompt: `${KNIGHT}, leaning back with chest open as many thin streams of pale breath-light converge from all around into his visor and chest, inhaling the air, inward rushing motion lines` },
  { id: 'manaJar', prompt: `extreme close-up of a small round glass potion jar held in a steel-gray gauntlet, bright sapphire-blue glow escaping from the opened mouth, cool blue light on the metal, no helmet in frame` },
  { id: 'stimulant', prompt: `a vivid yellow-green bolt of energy crackling around a steel-gray armored forearm held across the frame, sharp bright jolt lines, sudden vigor, no helmet in frame` },
  { id: 'psiShield', prompt: `${KNIGHT}, projecting a hexagonal energy barrier from his open palm toward the left, the barrier large and bright` },
  { id: 'acrobatics', prompt: `three bright balls — one green, one yellow, one blue — arcing through the air in a juggling loop, a steel-gray gauntlet tossing from the bottom edge, colorful motion trails` },
  { id: 'prePrepared', prompt: `${KNIGHT}, leaning casually on a folded closed umbrella with green, yellow and blue panels like a cane, ready relaxed pose, umbrella tip on the ground, the colorful umbrella the accent` },
  { id: 'panpanBread', prompt: `extreme close-up of a small round golden bread loaf resting on a green checkered cloth held in a steel-gray gauntlet, steam rising, cool rim light balancing the warm crust` },
  { id: 'noonNap', prompt: `${KNIGHT}, dozing off sitting bathed in cool blue moonlight, helmet nodding down onto the crossed arms resting on the pommel of his planted greatsword, a crescent moon above, one tiny warm ember glowing beside him` },
  { id: 'holdOut', prompt: `${KNIGHT}, bracing behind a rising brick wall, armored forearm up and shoulder set, dust in the air, determined hold` },
  { id: 'instantCooldown', prompt: `extreme close-up of an hourglass with vivid blue sand frozen mid-fall, held in a steel-gray gauntlet, cool blue glow, sharp stillness, no helmet in frame` },
  { id: 'murmurChant', prompt: `extreme close-up side profile of a rounded steel-gray helmet with a thin horizontal visor slit, soft glowing rings of sound rippling out from the slit toward the left, dark background` },
  { id: 'expandChant', prompt: `${KNIGHT}, both palms upturned with three small chant lights floating in a row above them — one green, one yellow, one blue — holding several lights aloft at once, calm expanded focus, colorful glows` },
  { id: 'helicopter', prompt: `a little toy helicopter with yellow and blue blades taking off from an open steel-gray gauntlet, whimsical small rotor wash, the colorful toy in close-up` },
  // —— 灰卡补全（多彩中性色：蓝绿黄无冷暖倾向；五只魏启罐各自不同构图） ——
  { id: 'manaJarPlus', prompt: `a tall elegant glass vial of swirling sapphire-blue liquid held up high in a steel-gray gauntlet, light refracting through it in green and yellow sparkles, raised against the dark, no helmet in frame` },
  { id: 'manaJarRoyal', prompt: `an ornate square crystal decanter of deep blue liquid presented flat on two open steel-gray gauntlets, a gilded label and green-gold glints, ceremonial offering pose, dark background` },
  { id: 'manaJarLegend', prompt: `an absurdly oversized round glass jug of radiant blue liquid cradled in both steel-gray arms like a baby, its glow flooding the armor with blue, green and yellow light motes floating, tight crop on the huge jug` },
  { id: 'swiftManaJar', prompt: `a steel-gray knight tilting a small blue-glowing jar to his visor slit and chugging it fast, motion blur on the tilt, blue light streaking, speed lines, tight profile crop` },
  { id: 'swiftManaJarPlus', prompt: `a luxurious wide goblet brimming with luminous blue liquid raised in a toast by a steel-gray gauntlet, yellow and green gem glints on the cup, a celebratory splash frozen mid-air, dark background` },
  { id: 'burstStimulant', prompt: `${KNIGHT}, a vivid yellow-green shockburst radiating from his whole body, energy rings blasting outward from the chest, arms flung wide, the multi-hued jolt flooding the frame` },
  { id: 'fullStimulant', prompt: `close-up of a steel-gray breastplate with vivid yellow-green and blue energy lines tracing across the plates like waking circuitry, charge flowing through the armor, no helmet in frame` },
  { id: 'piercingShot', prompt: `a single bullet punching clean through a thick steel plate, the through-hole glowing at the edges, debris bursting out the far side, the piercing trajectory drawn as one straight speed line across the frame, no person, no hands, object-only macro` },
  { id: 'pointShot', prompt: `extreme close-up of a single bullet frozen mid-flight with a thin bright trail, a gun muzzle with a small precise flash at the frame edge, dark background, calm deadly accuracy, no person, no hands, object-only macro` },
  { id: 'suppressionFire', prompt: `countless bright bullet trails streaking across the frame in a dense sweeping fan, a cascade of tumbling spent shell casings catching warm light in the foreground, the sheer density of fire conveying a suppressive barrage, dark background, no person, no hands, no weapon visible, only flying bullet trails and casings` },
  // —— Z 状态卡（没有骑士——画那个东西本身，同一风格） ——
  { id: 'badOmen', prompt: `a huge dark question-mark-shaped shadow looming on a black field, faint cold rim light, ominous painterly smog` },
  { id: 'burnWound', prompt: `a close-up of a bandaged burned forearm, scorched skin edges under the wraps, muted warm pain light` },
  { id: 'dustCloud', prompt: `a billowing blinding dust cloud filling the frame, gray swirling masses, grit in the air` },
  { id: 'inkBlot', prompt: `a black ink splatter exploding across the frame, glossy dark masses with sharp tendrils, high contrast` },
  { id: 'looseLeaf', prompt: `a single loose paper sheet caught mid-air in a gust, tumbling with motion lines, pale sheet on black` },
  { id: 'sidestep', prompt: `a pair of armored boots mid-dodge sliding sideways, sharp motion lines, dust kicking up, close crop` },
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
// 体修虚无后缀（2026-09-22 用户定）：体修越高深越「虚无、简单、幻灭」——这些链的高阶变体
// 不再「更亮更爆」，而是色彩流失、笔触虚幻、趋近黑白（红围巾作唯一残色）。优先级最高。
const ESCALATION_VOID = {
  fastPunch: { // 快拳(B)→炮拳(A)→真拳(S)：真拳归于至简
    3: ', the same straight punch, noticeably desaturated: armor and background drained to muted grays, the edges softened, only the red scarf keeps full color',
    4: ', the same straight punch rendered in pure black and white with harsh contrast, the form reduced to a few blurred essential strokes, pure void-calm, the red scarf the sole spot of color',
  },
  fullCharge: { // 蓄满一击(C/B)→全神一击(A)：全神 = 敛神入空
    2: ', the same charging stance, the light dimming, the colors muting toward gray, the charge turning inward and silent',
    3: ', the same charging stance in near monochrome, desaturated grays, soft dissolving edges, all spirit condensed into emptiness',
  },
  wildFlurry: { // 乱拳(C)→雨拳(B)→千手(A)→万手(S)：万手归一、一片空茫
    2: ', the same flurry, more afterimages, a faster rhythm',
    3: ', the same flurry, the afterimages blurring into gray mist, the color draining away',
    4: ', the same flurry dissolved into a storm of pale gray afterimages, stark monochrome, ten thousand fists as one empty blur, the red scarf the only color',
  },
  martialStance: { // 武术姿态(C)→大师姿态(B)→天一姿态(A)：天人合一、返璞
    2: ', the same stance, the colors muting, the presence growing still and empty',
    3: ', the same stance in stark black and white, heaven and man as one, the form simplified to essential blurred strokes, the red scarf the only color',
  },
};
// 按键定制后缀：通用 ESCALATION「more intense energy」在安静的体修微距/生活场景上读不动
// （0.8 保真压过模糊措辞——试点实测近半键进阶不可读），凡此皆进本表。
// 铁律：后缀必须**点名新增可视元素**（裂纹/尘土/光膜/残影/血珠……），不许只写「更强更亮」。
const ESCALATION_CUSTOM = {
  // —— 体修微距（2026-09-22 变体评审首轮失败键返工：构图轴已锁，进阶靠具体新元素） ——
  agileCombo: { // 敏捷连击(C)→疾速连击(B)→暴风连击(A)：残影逐级增多
    2: ', the same coiled double-fist lean, now with a pale blurred afterimage of his fists echoing behind, faint speed lines',
    3: ', the same lean, two pale afterimage echoes trailing his fists, sharp speed lines, stormy motion blur',
  },
  barrier: { // 壁垒(C)→堡垒(B)→铜城(A)：铜城 = 铜辉能量壳
    2: ', the same armored ball, a faint pale-blue energy shimmer glazing the plates',
    3: ', the same armored ball enclosed in a bright bronze-glowing energy shell, glowing seams between the plates',
  },
  berserkStance: { // 狂战姿态(B)→狂战掌控(A)：怒吼显形
    3: ', the same roaring helmet, a pale wild aura flaring off the shoulders, the roar visible as a shockwave ring around the head',
  },
  bloodFist: { // 血拳(B)→血拳(A)：血更盛
    3: ', the same bloody fist, blood now dripping and beading off the knuckles, a faint dark-red blood mist around the hand',
  },
  defensePrep: { // 防御准备(C)→守护姿态(B)→玄龟姿态(A)：玄龟 = 六边龟甲光膜；头盔必须在（首轮出过裸脸）
    2: ', the same overhead open-palm catch, a faint pale energy film above the palm, helmet on, no visible face',
    3: ', the same pose, the energy film hardened into a translucent turtle-shell pattern of glowing hexes above the palm, helmet on, visor in shadow, no visible face',
  },
  endure: { // 忍耐(C)→强撑(B)：甲损尘落
    2: ', the same hunched covering pose, the armor now scratched and dented, dust and small debris raining on him',
  },
  fistPress: { // 拳压(C)→拳压(B)→拳压(A)：地面裂纹逐级炸开
    2: ', the same downward grinding fist, cracks beginning to spread under the knuckles, dust rising',
    3: ', the same fist, a spiderweb of bright cracks bursting outward under it, debris and dust blasting up',
  },
  guard: { // 盾(C)→坚固盾(B)→强化盾(A)：臂甲逐级硬化发光
    2: ', the same crossed-vambrace guard, a faint steel-blue sheen hardening on the armor plates',
    3: ', the same guard, the vambraces glowing with a reinforced bright rim, a small impact spark bursting off them',
  },
  hunYuanPlus: { // 变招(B)→混元(A)→混元(S)：混元归虚
    3: ', the same circling palms, a faint swirl of pale and dark mist spiraling between the hands',
    4: ', the same circling palms in stark monochrome, the mist swirl dissolved into pure black-and-white emptiness, the forms simplified to blurred strokes',
  },
  mimicFist: { // 仿形拳(C)→豹形拳(B)→虎形拳(A)：手形生爪（只画手，不许出兽脸）
    2: ', the same phantom gauntlet hand-shapes, the fingers sharpening into claws like a leopard paw, hands only, no animal, no creature face',
    3: ', the same cluster, the claws longer and heavier like a tiger claw, more phantom hands, fiercer, hands only, no animal, no creature face',
  },
  novice: { // 入门(C)→精通(B)→无双(A)：拳掌间光逐级迸发
    2: ', the same fist-in-palm salute, the grip firmer, a faint resolve glow seeping from the seam between fist and palm',
    3: ', the same salute, radiant light bursting from the seam between fist and palm, peerless conviction',
  },
  powerStance: { // 架势(B)→架势(A)：拳压出冲击环
    3: ', the same pressed knuckles, a shockwave ring and dust burst radiating from the fists, the armor straining',
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
    2: ', the same wild punch, blood trickling from the knuckles, the swing wilder, heavy motion blur',
    3: ', the same punch, blood spraying from the knuckles, the whole body thrown into the berserk swing, violent motion blur',
  },
  // —— 刀系/肘系/杂项（同批返工） ——
  annihilatingEdge: { // 斩灭(A)→斩灭(S)：刃口噬光（首轮「drinking the light」语义太玄，构图漂了——改死锚 pose）
    4: ', the exact same pose and framing, the same dark blade held the same way, its edge turning void-black with a thin annihilating pale rim, the background darker',
  },
  breath: { // 呼吸(C)→武者呼吸(B)→完美呼吸(A)：气息更绵长
    2: ', the same visor close-up, the breath mist thicker and slower, faint cool vapor curling',
    3: ', the same visor, a perfect slow breath: one long elegant ribbon of pale mist drifting out, total calm',
  },
  cleave: { // 横劈(C)→强力劈(B)→裂空劈(A)：裂空 = 劈开空气
    2: ', the same horizontal swing, the blade trailing a bright speed arc, the air splitting behind the edge',
    3: ', the same swing, a huge splitting arc tearing across the frame, the air itself cracked open along the trajectory, debris flung',
  },
  cycloneSlash: { // 回旋斩(C)→回旋爆斩(B)→完美回斩(A)：环爆、双环
    2: ', the same spinning ring slash, the ring erupting into a bursting spiral, sparks flying off the arc',
    3: ', the same ring, a perfect seamless blazing circle with a second inner ring of light, sparks storming outward',
  },
  edgeBreath: { // 含刃术(C→B→A)：刃更寒
    2: ', the same blade held at the visor, the steel brighter, a faint cold gleam along the edge',
    3: ', the same pose, the blade gleaming razor-bright, cold light running along the edge, breath mist curling off the steel',
  },
  elbowMaster: { // 牢大(B)→牢大(A)：喜剧系——肘尖高光星
    3: ', the same heroic elbow display, the elbow point gleaming with a heroic four-point shine star, confident polish',
  },
  elbowReturn: { // 牢大归来(B)→A：更高更傲
    3: ', the same elbow thrust skyward, a triumphant four-point shine star on the elbow point, the pose higher and prouder',
  },
  elbowStrike: { // 肘击(C)→猛烈(B)→强大(A)→纯粹(S)：S「纯粹」归简（喜剧系的简不是虚无，是干净）
    2: ', the same elbow swing, heavier motion blur, a small shock ring bursting at the impact point',
    3: ', the same swing, a bigger shock ring at the elbow point, dust blasting off',
    4: ', the same elbow purified to essence: stark monochrome, the swing reduced to one clean blurred arc, pure and simple',
  },
  fastRain: { // 快如雨(C)→疾如风(B)→疾如风(A)：雨成风暴
    2: ', the same rain-soaked knight, the rain denser and faster, sharper diagonal streaks, the wind picking up his scarf',
    3: ', the same figure, a storm of wind-driven rain lashing diagonally across the frame, the scarf whipping hard, blurring speed',
  },
  feint: { // 假动作(C→B→A)：影分身逐级凝实
    2: ', the same knight and his shadow double, the double more solid and convincing, harder to tell apart',
    3: ', the same pair, the shadow double fully materialized with its own red scarf, two indistinguishable knights',
  },
  flyingDagger: { // 飞刀(C)→强力飞刀(B)→绝灭飞刀(A)：刀尾光轨
    2: ', the same dagger thrust, the dagger trailing a sharp speed line, faster and heavier',
    3: ', the same thrust, the dagger screaming forward with a long bright trail, the tip glowing, annihilating momentum',
  },
  handCleave: { // 花刀(C→B)→蔽目花刀(A)：蔽目 = 耀目刀幕
    2: ', the same flourished curved blade, a brighter arc trail following the flourish',
    3: ', the same flourish, a dazzling blinding fan of arc light veiling the frame',
  },
  haveWithout: { // 以有胜无(B)→A：牌更盛
    3: ', the same card fan, the cards glowing with a confident bright rim, more cards fanned, abundance',
  },
  honeBlade: { // 养刀术(C→B→A)：刃口觉醒
    2: ', the same blade care, the edge catching a brighter gleam as it is wiped',
    3: ', the same pose, the blade fully awakened: a keen bright edge, light running along the steel',
  },
  melt: { // 熔流：更沸更溅
    3: ', the same molten pour, the stream thicker and brighter, sparks and molten drops splashing, heat haze shimmering',
  },
  quickCleave: { // 快速花刀(C→B→A)：刀弧残影成倍
    2: ', the same quick flourish, faster: the blade trailing two blurred arc echoes',
    3: ', the same flourish, the blade a fan of three blurred arc echoes, lightning-quick',
  },
  silverDance: { // 刀舞(B)→风暴刀舞(A)：银弧成暴
    3: ', the same blade dance, the arcs multiplying into a storm of silver trails, blades everywhere',
  },
  storeEdge: { // 收刃(C)→潜锋(B)→藏锋(A)：越藏越深、杀气越敛
    2: ', the same sheathing motion, the blade sliding deeper, a colder subdued gleam, hidden menace',
    3: ', the same sheath, the blade almost fully hidden, only a sliver of cold steel visible, the quietest deadliest moment',
  },
  whetstone: { // 砺刀(C)→磨锋(B)→展锐(A)：展锐 = 锋芒毕露
    2: ', the same whetting, brighter sparks skipping off the stone, the edge beginning to gleam',
    3: ', the same stone, the honed edge flashing razor-bright, a keen line of light on the steel, sparks flying',
  },
  winWithout: { // 以无胜有(B)→A：唯一牌更亮
    3: ', the same single held card, the card glowing bright against the emptiness around it, decisive minimalism',
  },
  // —— 预防性定制（主批后半段的安静/青绿键——通用「blazing」会把木绿/风青拉成橙，且微距无钩可读） ——
  miasma: { // 瘴气：毒雾逐浓
    1: ', the same conjuring, the miasma cloud a little thicker, more droplets beading',
    2: ', the same palm, thick sickly green vapor billowing, poison droplets dripping',
    3: ', the same arm, a huge roiling swamp miasma engulfing it, dense green fumes, dripping poison',
  },
  woodBark: { // 树皮甲：甲皮逐厚
    1: ', the same forearm, more bark plates spreading further up the arm',
    2: ', the same forearm, thick bark armor covering it whole, mossy glints in the seams',
    3: ', the same forearm, a full ancient-tree bark shell: massive ridged plates, green vitality glowing in the seams',
  },
  woodSting: { // 飞刺：刺雨逐密
    1: ', the same throw, a second smaller stinger trailing the first',
    2: ', the same throw, a volley of thorny stingers fanning out, poison drops scattering',
    3: ', the same throw, a storm of thorny stingers with green trails filling the frame',
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
    1: ', the same cloud float, the cloud a little fluffier, deeper relaxation',
    2: ', the same pose, a bigger softer cloud, a few drifting motes of dream-light',
    3: ', the same pose on a grand fluffy cloud throne, total serenity, soft glow all around',
  },
  bathWind: { // 放羽：羽环逐多
    1: ', the same feather release, two feathers floating, more air rings drifting',
    2: ', the same release, a small swirl of feathers wrapped in bright cyan air rings',
  },
  lightness: { // 化风：人逐散
    1: ', the same gust dodge, more blurred, an extra cyan air ring',
    2: ', the same dodge, half-dissolved into the gust, a stronger cyan spiral',
    3: ', the same gust, the knight almost fully dissolved into a swirling cyan wind storm, only the red scarf and one gauntlet still hinting his shape',
  },
  windBlade: { // 风刃：刃逐大
    1: ', the same wind slash, the cyan crescent larger and brighter',
    2: ', the same slash, a huge bright cyan crescent with gust rings trailing',
    3: ', the same slash, a massive tearing cyan blade-storm, double crescents, the air ripped open',
  },
  holdOut: { // 坚守：墙逐高
    1: ', the same braced wall, the wall one course higher, more dust in the air',
    2: ', the same brace, the wall much taller, dust and pebbles cascading down',
    3: ', the same brace behind a towering brick bulwark, a dust storm around, unbreakable hold',
  },
  psiShield: { // 灵能屏障：两层屏障显形（两轮「更大更亮」都读不出——屏障已大，加新层）
    2: ', the same pose, a second smaller hexagonal barrier materializing in front of the first one, double-layered defense, bright glowing rims',
  },
  relief: { // 泄压：蒸汽逐猛
    1: ', the same valve, more steam blasting out sideways',
    2: ', the same valve fully wrenched open, a huge white steam blast',
    3: ', the same pose, an enormous roaring steam eruption flooding the frame',
  },
  silence: { // 灭烛：烟缕逐多、暗逐深
    1: ', the same snuffing, the smoke wisp curling higher, the dark deeper',
    2: ', the same gauntlets, two just-snuffed candles, twin smoke wisps rising',
    3: ', the same gauntlets, three just-snuffed candle stumps in a row, smoke ribbons braiding upward, near-total dark',
  },
  warmUp: { // 烛环：烛环逐盛
    1: ', the same candle ring, more small flames joining, more bright points',
    2: ', the same ring, a denser circle of warm flames, brighter glow on his back',
    3: ', the same knight, a grand blazing circle of candle flames all around, his silhouette washed in warm light',
  },
  // —— 安静/生活场景（「更丰盈/更深沉」分级） ——
  fireControlBurn: { // 控火术：燃(C)→散(B)→爆(A)：散=火星飞散、爆=喷爆发作
    2: ', the same pose, the palm flame scattering into a spray of bright embers and small flames streaming off his hand',
    3: ', the same pose, the palm flame erupting into a violent bright blast, fire bursting upward, embers storming',
  },
  flameHeal: { // 焰愈(C)→炽愈(B)→浴火(A)：A = 火焰如水流淌全身
    2: ', the same kneeling pose, the warm light column widening, small flames kindling along his shoulders and arms',
    3: ', the same kneeling figure bathed in fire: flames washing over his whole body like water, a roaring warm blaze, unburned and serene',
  },
  kindling: { // 可燃血液(C→B→A)：血焰沿臂蔓延
    2: ', the same wrist, the blood-drop flame catching properly: a small bright flame standing on the arm, more blood welling',
    3: ', the same arm, the kindled blood flame roaring up along the vambrace, bright fire wrapping the forearm',
  },
  herbPaste: { // 草药（旧 woodHerb 键改名）
    1: ', the same gentle grip, the herb larger with more bright leaves, the soft green glow a little stronger',
    2: ', the same gentle grip, the herb grown lush: a small bundle of bright sprouting leaves, vivid green glow, drifting motes of light',
    3: ', the same gentle grip, the herb bursting with life: a large lush spray of glowing leaves and tendrils, strong green radiance',
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
    3: ', the same dozing scene, serene deep-blue night, a large glowing crescent moon, the single warm ember point',
  },
  murmurChant: {
    1: ', the same whisper, the sound ripples a little clearer and brighter',
    2: ', the same whisper, vivid glowing ripples drifting farther out',
  },
  patience: {
    2: ', the same upturned palm, the dark-red flame larger and hungrier, more blood welling up',
    3: ', the same upturned palm, the dark-red flame raging high, blood dripping, an ominous blaze',
  },
  willOWisp: {
    3: ', the same floating ghost flame, larger and brighter, cold blue-white light washing the armor, wisps of cold mist',
  },
  woodBlood: {
    2: ', the same hand and vine, more thorns coiling further up the wrist, more glowing dark-red sap dripping',
  },
  extract: {
    2: ', the same pull, the iridescent ribbon wider and brighter, stronger green-yellow-blue shimmer',
    3: ', the same pull, a torrent of iridescent green-yellow-blue light erupting from the cracking rock, the ribbon flooding the frame',
  },
  drawQi: {
    2: ', the same inhale, the pale streams thicker and brighter, rushing in from farther away',
    3: ', the same inhale, a storm of pale breath-light converging from every direction, the air itself rushing into him',
  },
  purify: {
    2: ', the same washing, the water drop larger and brighter, the stain dissolving faster, clear light',
    3: ', the same washing, a cascade of bright clear water washing the gauntlet clean, brilliant purity',
  },
  stimulant: {
    2: ', the same jolt, the yellow-green energy crackling louder across the whole arm',
    3: ', the same jolt, a roaring yellow-green charge wrapping the arm, energy arcs leaping outward',
  },
  expandChant: {
    4: ', the same upturned palms, five bright chant lights floating in a row — green, yellow, blue and more — a full row of colorful glows',
  },
  prePrepared: {
    1: ', the same relaxed lean, a bit more poised, a subtle glint of readiness',
    2: ', the same relaxed lean, a confident poised aura, the umbrella gleaming',
    3: ', the same casual pose, radiating quiet confidence, dramatic rim light, the umbrella held like a sword',
  },
  holdOut: {
    1: ', the same hold, the wall a little higher and sturdier, more dust in the air',
    2: ', the same hold, a tall solid wall, rubble and dust in the air, a stronger impact',
    3: ', the same hold, a massive bulwark wall, debris flying, an unbreakable stance',
  },
};

// 变体场景表：多等阶键（tmp/series_tiers.json）为最低阶之外的每个等阶出一行 <key>-<tierIdx>

function buildWorkflow(scene, seed, refName = null) {
  const wf = {
    '451': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_bf16.safetensors', weight_dtype: 'default' } },
    '453': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_bf16.safetensors', type: 'qwen_image', device: 'default' } },
    '454': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    '452': {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['453', 0], prompt: `${scene.prompt}, ${STYLE}`, negative_prompt: NEGATIVE, resolution: 1024 },
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
      const esc = ESCALATION_VOID[key]?.[idx] ?? ESCALATION_CUSTOM[key]?.[idx] ?? ESCALATION[idx];
      const vscene = { id: vid, prompt: scene.prompt + esc };
      const dir = path.join(OUT_DIR, vid);
      fs.mkdirSync(dir, { recursive: true });
      const have = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length;
      let firstNew = null;
      for (let i = have; i < COUNT; i++) {
        const seed = Math.floor(Math.random() * 1e15);
        const outPath = path.join(dir, `cand_${i}_${seed}.png`);
        console.log(`级联 ${vid} [${i + 1}/${COUNT}]（ref=${path.basename(refPath)}，seed ${seed}）…`);
        try {
          const refName = await uploadImage(refPath);
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
