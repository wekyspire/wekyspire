// Core 的表现意图出口。指令只调 ctx.presenter.xxx(...)，不关心谁实现：
// Bridge 层实现为动画指令入队；headless 测试注入录制型 presenter 做断言。
const noop = () => {};

// 空实现：任何方法都是 noop（生产环境的兜底）
export function createNullPresenter() {
  return new Proxy({}, { get: () => noop });
}

// 录制实现：把每次调用记为 { method, args }（headless 测试/调试用）
export function createRecordingPresenter() {
  const target = {
    calls: [],
    clear() { this.calls.length = 0; },
  };
  return new Proxy(target, {
    get: (t, method) => (
      method in t
        ? t[method]
        : (...args) => t.calls.push({ method, args })
    ),
  });
}
