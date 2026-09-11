// propKit 出口（WORKFLOW §2）：契约本体，主会话/人工维护，flash 禁改。
// 资产侧标准用法：import { P, K, B } from '../kit/index.js'
//   P.* 调色板 token（跟当前主题）｜K.* 图元/修饰器/撒布/合并 ｜B.* 行为模板（P5 前空）
// three 本体由资产文件自行 import（禁 three 之外的库）。

import { P, PALETTES, setTheme, getTheme, shade } from './palette.js';
import {
  M, FAMILIES, materialOf, familyMaterial,
} from './materials.js';
import {
  box, cyl, cone, prism, lathe, sphereLo, plate,
  tilt, jitter, chip, mirror, scaleXYZ, aim, put, grp, paint,
} from './primitives.js';
import { createRng, scatter } from './scatter.js';
import { mergeStatic } from './merge.js';
import { B } from './behaviors.js';

export { P, PALETTES, setTheme, getTheme, shade };
export { M, FAMILIES, materialOf, familyMaterial };
export {
  box, cyl, cone, prism, lathe, sphereLo, plate,
  tilt, jitter, chip, mirror, scaleXYZ, aim, put, grp, paint,
};
export { createRng, scatter };
export { mergeStatic };
export { B };

/** 图元+修饰器+工具的命名空间（喂料模板里的 K.* 即它）。 */
export const K = Object.freeze({
  box, cyl, cone, prism, lathe, sphereLo, plate,
  tilt, jitter, chip, mirror, scaleXYZ, aim, put, grp, paint,
  shade, createRng, scatter, mergeStatic, materialOf,
});
