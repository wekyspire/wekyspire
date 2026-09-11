import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { readFileSync } from 'node:fs'

// 版本号单一事实源 = package.json；只在构建期注入 version 字段（不内联整份 JSON）
const pkgVersion = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')).version

// https://vitejs.dev/config/
export default defineConfig(({mode}) => {
  const root = process.cwd();
  const viteEnv = loadEnv(mode, root);
  console.log(viteEnv);
  return {
    base: viteEnv.VITE_BASE || './',
    define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
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
