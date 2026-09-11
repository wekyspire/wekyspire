import { describe, it, expect } from 'vitest';
import {
  showMenuDialog, menuDialogState, confirmMenuDialog, cancelMenuDialog,
} from '../src/shell/menuDialog.js';

// 菜单级全局模态弹窗（Promise 化状态机）：三模式 + 单例串行 + 空输入拦截。
// 渲染层（MenuDialog.vue）由浏览器验收，这里只测语义。

describe('menuDialog 三模式语义', () => {
  it('confirm 模式：确认 → { ok:true }；取消/Esc → { ok:false }', async () => {
    const p = showMenuDialog({ title: '提示', message: '只管确认', mode: 'confirm' });
    expect(menuDialogState().open).toBe(true);
    confirmMenuDialog();
    await expect(p).resolves.toEqual({ ok: true });
    expect(menuDialogState().open).toBe(false);

    const p2 = showMenuDialog({ title: '提示' }); // mode 缺省 = confirm
    cancelMenuDialog();
    await expect(p2).resolves.toEqual({ ok: false });
  });

  it('confirmCancel 模式：确认/取消各自兑现', async () => {
    const p = showMenuDialog({ title: '覆盖存档？', mode: 'confirmCancel' });
    cancelMenuDialog();
    await expect(p).resolves.toEqual({ ok: false });

    const p2 = showMenuDialog({ mode: 'confirmCancel' });
    confirmMenuDialog();
    await expect(p2).resolves.toEqual({ ok: true });
  });

  it('input 模式：非空确认返回去空格文本；空输入不允许确认；取消返回 ok:false', async () => {
    const p = showMenuDialog({ mode: 'input', defaultValue: '  种子值  ', placeholder: '输入' });
    confirmMenuDialog(); // 空格非空：应落地
    await expect(p).resolves.toEqual({ ok: true, text: '种子值' });

    const p2 = showMenuDialog({ mode: 'input', defaultValue: '   ' });
    confirmMenuDialog(); // 纯空白：拦截不落地
    expect(menuDialogState().open).toBe(true);
    cancelMenuDialog();
    await expect(p2).resolves.toEqual({ ok: false });
  });

  it('单例串行：已有弹窗时后来者直接以取消兑现，原弹窗不受影响', async () => {
    const first = showMenuDialog({ title: '第一个' });
    const second = showMenuDialog({ title: '第二个' });
    await expect(second).resolves.toEqual({ ok: false });
    expect(menuDialogState().title).toBe('第一个'); // 仍是第一个弹窗
    confirmMenuDialog();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it('每次打开重置输入框与文案；未打开时 confirm/cancel 为无操作', () => {
    showMenuDialog({ mode: 'input', defaultValue: '旧值' });
    cancelMenuDialog();
    // 未打开状态下调用不应抛错也不应改变状态
    confirmMenuDialog();
    cancelMenuDialog();
    expect(menuDialogState().open).toBe(false);

    showMenuDialog({ title: '新弹窗', confirmText: '覆盖并开始' });
    expect(menuDialogState().inputValue).toBe(''); // defaultValue 缺省清空上次的旧值
    expect(menuDialogState().confirmText).toBe('覆盖并开始');
    cancelMenuDialog();
  });
});
