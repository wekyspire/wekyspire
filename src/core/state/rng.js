// 确定性 RNG（mulberry32）。战斗内一切随机（洗牌/发现/随机行动）都走它，
// 注入种子保证 headless 可测、可复现。
export function createRng(seed = 1) {
  let a = seed >>> 0;

  const next = () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,                                  // [0, 1)
    int(min, max) {                        // 闭区间整数
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(arr) {
      if (!arr.length) return undefined;
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {                         // 原地 Fisher-Yates，返回同数组
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    // 序列化预留：内部状态就是一个 uint32
    getState() { return a >>> 0; },
    setState(s) { a = s >>> 0; },
  };
}
