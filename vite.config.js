import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({mode}) => {
  const root = process.cwd();
  const viteEnv = loadEnv(mode, root);
  console.log(viteEnv);
  return {
    base: viteEnv.VITE_BASE || './',
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
      // 两个入口：正式壳 index.html + 观战页 watch.html（连 headless 直播中继，
      // 见 AGENTS.md「headless 试玩与直播观战」）。dev 模式下 Vite 直接按路径服务
      // 根目录任意 .html，无需配置；这里是为了让**构建产物**也带上观战页。
      rollupOptions: {
        input: {
          main: path.join(root, 'index.html'),
          watch: path.join(root, 'watch.html')
        }
      }
    }
  }
})
