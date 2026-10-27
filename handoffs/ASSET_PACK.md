# 美术资源打包（ASSET_PACK）

> 2026-09-30 设计定稿。目标：把首载的 509 个美术请求合成一个 binary 下载，
> 本地解包换 blob URL——治小水管服务器（1MB 上行）在加载阶段被并发小请求
> 打到 100kb/s 的问题；美术继续膨胀时请求数恒为 1。

## 代码加载分层（L0/L1/L2，与美术包正交——2026-09-30 补）

代码不进二进制包：JS 必须以可解析模块到达（blob 模块加载器与 Vite 模块图
对着干，不值当），且文本 brotli 压缩 4-5×（2.4MB→~550KB）——裸拼接反而
放大传输量。三层各管一件事：

| 层 | 内容 | 状态 |
|---|---|---|
| **L0 服务器** | mod_brotli（js/css/html；`artpack-*.bin` 排除）+ hash 资产 `Cache-Control: immutable` + `index.html` `no-cache`。**实测线上无压缩无缓存头**——2.38MB JS 原始字节过 1MB 管子 | 待服务器配置（Apache 段落由前端侧写好待贴） |
| **L1 静态启动壳** | 加载门视觉内联 index.html/watch.html，HTML 解析即上色（先于一切 JS）；Vue 只留 assetsReady 状态机，经 `window.__bootShell` 推进度 | ✅ 已落地（ca2c218），CDP 限速 300kb/s 下 1.2s 壳已上色、appMounted=false 实证 |
| **L2 内容切分** | 见下节 | 设计定稿，待实施 |

### L2：内容注册表切出关键路径（Phase A，~15 行）

**现状解剖**（dist 实测）：关键路径 = modulepreload 的 2.38MB——
`tooltipHub` 1.55MB（**内容定义本体在内**：`describe:`×246 / `agent:`×34，
卡牌/敌人/事件定义全随急加载图走）+ `assetManifest` 0.59MB（美术 URL 表
518 条 + 舞台共享代码）+ `main` 0.15MB。

**切分依据（已核实）**：生产图里 `core/content/index.js` 的引用点仅
App.vue:8 与 WatchApp.vue:8 两处；开始界面（模式选择/存档列表/changelog）
零注册表依赖——内容只在第一场战斗装配/卡组展示时才真正被查。

**方案**：两处静态 import 改 `import()`，与 GPU 探测/美术预载并行启动；
加载门放行条件 `assetsReady && contentReady`（美术 16MB 恒为长杆，内容
永不拖后腿）；import 失败复用壳的失败态+重试。Vite 自动把内容子树切出
独立 chunk（两入口共享），tooltipHub/main 相应瘦身，modulepreload 列表
缩短——**此后事件/敌人/卡牌代码再膨胀，加长的只是壳后面的并行下载，
不再是放行前的串行等待**。

**Phase B（three/舞台层延后挂载）暂缓**：静态壳已接管首帧后，急加载路径
只影响"揭幕时机"，而美术包恒为长杆；等内容代码真膨胀到与美术同量级再议。

**给用户管道的账（1MB/s，首访）**：L0 前 JS 2.4s ∥ 美术 16s → 揭幕 ~16s；
L0 后 JS ~0.6s；回访（immutable 缓存）JS+美术全缓存 → 揭幕近乎即时。
L2 的价值不在今天的秒数，在"内容膨胀不再回头咬启动"。


## 0. 现状事实（设计的地基，均已核实）

- 美术 = `dist/assets/` 下 **509 张 webp ≈ 16MB**（代码 js 仅 2.3MB）；
  `src/assets` 共 515 文件（含 css/mp3）。
- **全部美术消费收敛在 6 处 `import.meta.glob(?url, eager)`**：
  `assetManifest.js`（全量清单+预载）、`imageCache.js` 消费方的五个表
  （unitArt / cardArtCache / bubbleArt / relic / towerArt）+
  `eventArt.js`。全仓库**没有**单文件直连 `?url` 引用。
- 五个舞台侧缓存共同基类 `ArtImageCache`（`src/stage/art/imageCache.js`）：
  加载唯一入口 `img.src = url`（:85-95）；预载经 `warm(url, img)` 注入已解码图。
- 加载门 `AssetLoadingScreen` 进度按**字节**驱动（HEAD 探测 Content-Length，
  探测缺席退化为按张数）；`preloadAllArt` 被 App.vue 与 watch.html（WatchApp）共用。
- vite.config.js 已有自制插件惯例（debugSavesPlugin / 版本一致性校验）。

## 1. 格式：裸拼接 + JS manifest（不压缩、不 zip）

- `artpack-<hash8>.bin`：509 个 webp **原样字节拼接**（webp 已压缩，再 deflate
  纯烧服务器 CPU 几乎不减体积）。hash = 包内容的 md5 前 8 位——美术不变则
  文件名不变，天然 immutable 缓存键。
- `artpack-manifest.js`（dist 根，ESM asset，~25KB / gzip 后 ~5KB）：
  ```js
  export const PACK_URL = 'assets/artpack-3f9a2c1d.bin';
  export const PACK_TOTAL = 16883210;      // 字节（进度条精确分母 + 完整性校验）
  export const ENTRIES = {                  // 键 = 产物文件名（含内容 hash）
    'acrobatics-dfaba4ac.webp': [0, 34110, 'image/webp'],
    // ... 偏移、长度、mime
  };
  ```
- 选 JS 而非 JSON：运行期 `await import(BASE_URL + 'artpack-manifest.js')`
  一步拿到解析好的对象（无 fetch+parse、无 CORS 心智负担）；文件不在模块图里
  （emitFile asset），dev 服务器上不存在 → import 抛错 → 自然走回退。

## 2. 构建期：vite 插件（约 80 行，进 vite.config.js）

`generateBundle` 钩子：

1. 遍历 `bundle` 里的 asset 产物，筛 `assets/*.webp|png|jpe?g`（排除自身产物）。
2. 按文件名排序拼接（确定性输出）得 `packBuf`；md5 取 hash 命名。
3. `this.emitFile` 两件：`artpack-<hash>.bin`（source = packBuf）、
   `artpack-manifest.js`（source = 上述模板字符串，**PACK_URL 用相对路径**
   `assets/...`，运行期拼 BASE_URL——VITE_BASE=/ 与 ./ 两种部署都成立）。
4. **不删除**逐文件产物（保留作回退与远期按需；服务器多占 16MB 磁盘可接受）。

部署链零改动：cron 跑 `npm run build` → 插件随构建产出 → rsync 带走。

## 3. 运行期：pack loader + 三个消费点（约 120 + 20 行）

新模块 `src/stage/art/artpack.js`：

```
loadArtPack(onProgress)          // 动态 import manifest → fetch PACK_URL
                                 //   （ReadableStream 逐块累计 → onProgress(loadedBytes, PACK_TOTAL)）
                                 // → arrayBuffer → 校验 byteLength === PACK_TOTAL
                                 // → ENTRIES 逐项 buf.slice → new Blob([v],{type}) → objectURL 表
resolveArtUrl(url)               // url 末段命中 ENTRIES → blob URL；否则原样返回
                                 //   （未加载/未命中 = 透传，回退路径零感知）
```

三个消费点（全部一行级改动）：

| 位置 | 改法 |
|---|---|
| `ArtImageCache` 加载（imageCache.js:95） | `img.src = resolveArtUrl(url)` |
| `preloadAllArt`（assetManifest.js） | 预载前先 `loadArtPack`；有 pack 时**跳过 HEAD 探测与逐张 Image**——直接 `caches.warm(blobUrl, img)` 批量解码（blob Image 解码不走路由），字节进度直通进度门；无 pack 走旧路径 |
| `eventArtUrl`（eventArt.js） | `return resolveArtUrl(EVENT_ART[key] ?? placeholder(key))` |

进度门 UI **零改动**：pack 模式给出的字节进度比 HEAD 探测更准（精确总字节），
stats 形状不变（loadedBytes/totalBytes/elapsedMs）。

## 4. 回退矩阵

| 场景 | 行为 |
|---|---|
| dev 服务器 | manifest 不存在 → import 抛 → catch → 逐张旧路径（现状行为，开发零摩擦） |
| pack fetch 失败/长度不符 | 同上回退 + console.warn；**不重试 pack**（逐张路径自会重试） |
| watch.html | 共用 preloadAllArt，自动受益 |
| 部分文件未入 pack（新类型） | resolveArtUrl 透传原 URL，混跑无感 |

## 5. 服务器配置（配套一次性）

- `/assets/` 与 `artpack-*.bin` / `artpack-manifest.js`：
  `Cache-Control: public, max-age=31536000, immutable`（文件名内容 hash，永不变内容）。
- **`artpack-*.bin` 排除 mod_deflate/mod_brotli**（webp 再压缩白烧小水管 CPU）；
  `artpack-manifest.js` 照常文本压缩。
- 顺手项（与打包正交）：开 HTTP/2（mod_http2 + event MPM）。

## 6. 边界与风险

- **内存**：16MB ArrayBuffer 常驻 + 509 个 Blob 视图（slice 惰性拷贝）——
  桌面/笔记本无虞；真到上百 MB 时升级「manifest 记 per-file Range 按需取」
  （游戏 pak + 流式 IO 套路，全量预载门架构下现在不需要）。
- **objectURL 生命周期**：pack 的 blob URL 全局常驻（预载语义 = 全局缓存），不 revoke。
- **构建确定性**：排序拼接保证同输入同输出；美术只增不改时 pack 只增尾部
  （hash 仍变 = 正确，缓存键要的就是内容寻址）。
- **BASE_URL**：manifest 内相对路径 + 运行期拼 `import.meta.env.BASE_URL`，
  `/` 与 `./` 两种部署均成立。

## 7. 工作量与验收

- vite 插件 ~80 行 + artpack loader ~120 行 + 三个消费点 ~20 行 + 文档；
  一次性工程，无内容侵入。
- 验收：① build 后 dist 出现 pack+manifest，md5 与条目数对账 509；
  ② 浏览器起跑走 pack（Network 面板请求数 509→1，进度条按真实字节走）；
  ③ 删掉 pack 文件手动回归回退路径；④ 视觉零差（blob 与原 URL 同字节）；
  ⑤ watch.html 同样走 pack。
