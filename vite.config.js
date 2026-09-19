import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { readFileSync } from 'node:fs'

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
    })],
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
      port: 5177
    },
    build: {
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
