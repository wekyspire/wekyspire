import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'

// 调试存档服务（**dev only**）：把 tmp/saves/*.json 挂在 /debug-saves/ 下，
// 供调试模式用 `?debug=1&save=<名>` 直接从造好的存档起跑（tools/saveForge.mjs 产出）。
// 只在 dev server 生效（configureServer 不进构建产物）；文件名白名单，避免任意文件读取。
// tmp/ 是 gitignore 的一次性产物目录，故存档不会进仓库。
function debugSavesPlugin(root) {
  return {
    name: 'wekyspire-debug-saves',
    configureServer(server) {
      server.middlewares.use('/debug-saves', (req, res, next) => {
        const m = /^\/([A-Za-z0-9_-]+)\.json$/.exec((req.url ?? '').split('?')[0]);
        if (!m) { next(); return; }
        const file = path.join(root, 'tmp', 'saves', `${m[1]}.json`);
        if (!existsSync(file) || !statSync(file).isFile()) { next(); return; }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file, 'utf-8'));
      });
    },
  };
}


// 美术资源打包（quest_prompts/ASSET_PACK.md 设计实现）：产物里的全部位图资产
// 裸拼接成单个 artpack-<md5前8>.bin（webp 已压缩不再 deflate），配一份 ESM
// manifest（dist 根 artpack-manifest.js：包 URL + 总字节 + {文件名: [offset,len,mime]}）。
// 运行期 src/stage/art/artpack.js 动态 import manifest → 流式拉包 → slice→blob →
// resolveArtUrl 换汇；dev / 缺包 / 长度不符一律回退逐张旧路径。产物文件名含内容
// hash → 包名随内容变化 = 天然 immutable 缓存键（配套 Apache 头见设计文档 §5）。
const ART_MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function artPackPlugin() {
  return {
    name: 'wekyspire-artpack',
    generateBundle(_options, bundle) {
      const files = Object.entries(bundle)
        .filter(([name, info]) => info.type === 'asset'
          && /^assets\/[^/]+\.(webp|png|jpe?g)$/i.test(name))
        .sort(([a], [b]) => (a < b ? -1 : 1));
      if (!files.length) return;
      const entries = {};
      const parts = [];
      let offset = 0;
      for (const [name, info] of files) {
        const src = Buffer.from(info.source);
        const ext = name.split('.').pop().toLowerCase();
        entries[name.split('/').pop()] = [offset, src.length, ART_MIME[ext] ?? 'application/octet-stream'];
        parts.push(src);
        offset += src.length;
      }
      const pack = Buffer.concat(parts);
      const hash = createHash('md5').update(pack).digest('hex').slice(0, 8);
      this.emitFile({ type: 'asset', fileName: `assets/artpack-${hash}.bin`, source: pack });
      const manifest = `// 构建期生成（wekyspire-artpack）：美术包目录。
`
        + `export const PACK_URL = 'assets/artpack-${hash}.bin';
`
        + `export const PACK_TOTAL = ${pack.length};
`
        + `export const ENTRIES = ${JSON.stringify(entries)};
`;
      this.emitFile({ type: 'asset', fileName: 'artpack-manifest.js', source: manifest });
      console.log(`[artpack] ${files.length} 张位图 → artpack-${hash}.bin（${(pack.length / 1048576).toFixed(1)} MB）`);
    },
  };
}

// 版本号单一事实源 = package.json；只在构建期注入 version 字段（不内联整份 JSON）
const pkgVersion = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')).version

// 版本行一致性（自动把关，AGENTS「版本与 changelog」铁律的机械化）：
// 读取 public/changelog.md 顶部条目 `## YYYY.M.D [Alpha X.Y.Z]`——
//   ① Alpha 编号必须与 package.json 一致，不一致直接构建失败（两处忘了同步当场报）；
//   ② 条目日期作为 __CHANGELOG_DATE__ 注入：开始界面版本行显示**最新版本的日期**，
//     不再是「进页面当天的日期」。dev 下改 changelog 需重启 dev server 才生效。
const changelogHead = readFileSync(path.join(process.cwd(), 'public/changelog.md'), 'utf-8')
  .match(/^## (\d{4})\.(\d{1,2})\.(\d{1,2}) \[Alpha ([\d.]+)\]/m)
if (!changelogHead) {
  throw new Error('public/changelog.md 顶部没有合法版本条目（期望 `## YYYY.M.D [Alpha X.Y.Z]`）')
}
if (changelogHead[4] !== pkgVersion) {
  throw new Error(`版本号不同步：changelog 顶部 Alpha ${changelogHead[4]} ≠ package.json ${pkgVersion}——改完 changelog 记得同步 package.json 的 version`)
}
const changelogDate = `${changelogHead[1]}-${changelogHead[2].padStart(2, '0')}-${changelogHead[3].padStart(2, '0')}`

// https://vitejs.dev/config/
export default defineConfig(({mode}) => {
  const root = process.cwd();
  const viteEnv = loadEnv(mode, root);
  console.log(viteEnv);
  return {
    base: viteEnv.VITE_BASE || './',
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion),
      __CHANGELOG_DATE__: JSON.stringify(changelogDate),
    },
    plugins: [vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('colored-')
        }
      }
    }), debugSavesPlugin(root), artPackPlugin()],
    resolve: {
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
      alias: {
        '@assets': path.join(__dirname, './src/assets'),
        '@data': path.join(__dirname, './src/data'),
        '@': path.join(__dirname, './src')
      }
    },
    server: {
      host: 'localhost',
      port: 5177,
      // 公网远程验收口：wekyspire-dev.hineven.site 经服务器 Apache 反代 + SSH 反向
      // 隧道打进本机，Host 头非 localhost 会被 vite ≥4.5 的 DNS rebinding 防护 403。
      // 白名单只放这一个域（不开 true——dev 服务器暴露面越小越好）。
      allowedHosts: ['wekyspire-dev.hineven.site'],
    },
    build: {
      // 目标环境 es2022（2026-09-27 WebGPU 迁移随行）：游戏本就只跑支持 WebGPU 的新设备
      // （加载门预检卡死老旧端），es2022 的顶层 await（Chrome 94+/Safari 16.4+）远低于
      // WebGPU 门槛——TSL/compute 迁移期的 async 装配模式不再受 esbuild target 限制。
      target: 'es2022',
      // 入口：正式壳 index.html + 观战页 watch.html（连 headless 直播中继，
      // 见 AGENTS.md「headless 试玩与直播观战」）+ 休息阶段面板陈列页 uiGallery.html
      // （Three 面板的浏览器视觉门，与 propGallery/roomGallery 同范式）。
      // dev 模式下 Vite 直接按路径服务根目录任意 .html，无需配置；这里是为了让
      // **构建产物**也带上这些页面。
      rollupOptions: {
        input: {
          main: path.join(root, 'index.html'),
          watch: path.join(root, 'watch.html'),
          uiGallery: path.join(root, 'uiGallery.html')
        }
      }
    }
  }
})
