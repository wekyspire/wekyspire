// 应用版本号：**单一事实源 = 根目录 package.json 的 version**（发版只改那一处）。
//
// 经 Vite `define` 在构建期注入（vite.config.js 读 package.json 的 version 字段），
// 而不是 import 整份 package.json——后者会把 devDependencies/scripts 等开发元数据
// 一并内联进线上产物。`typeof` 守卫是为了在未注入该宏的环境（如个别测试执行器）下
// 退化为 'dev' 而不是抛 ReferenceError。
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
