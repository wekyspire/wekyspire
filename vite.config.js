import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

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
      }
    },
    server: {
      host: 'localhost',
      port: 5177
    }
}; })
