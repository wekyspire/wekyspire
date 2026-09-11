// 显示状态同步调度器（自 bridge/index.js 抽出：生产 bridge 与直播守护进程共用同一份，
// tools/broadcast.mjs 需要一个不依赖 createBridge 的等价标脏/补同步机制）。
//
// 语义（与抽出前逐行等价）：
//   标脏 = 记下「有未同步的变更」+ onDirty 钩子（生产 bridge 用它置投影脏位并发
//   STATE_DIRTY）；随后若动画队列已排空（即时链播完/无节拍变更）立刻补一次
//   syncState，另挂一个 setTimeout(0) 兜底（Core 存在不经 presenter 的变更）。
//   syncing 是 syncState → markDirty → syncIfIdle 的递归守卫。
export function createStateSync({ sequencer, getPresenter, onDirty = null }) {
  let unsyncedChanges = false;
  let syncFallbackScheduled = false;
  let syncing = false;

  const syncIfIdle = () => {
    if (syncing || !unsyncedChanges || sequencer.pendingCount > 0) return;
    syncing = true;
    try { getPresenter().syncState(); } finally { syncing = false; }
  };

  const markDirty = () => {
    unsyncedChanges = true;
    onDirty?.();
    syncIfIdle();
    if (!syncFallbackScheduled) {
      syncFallbackScheduled = true;
      setTimeout(() => {
        syncFallbackScheduled = false;
        syncIfIdle();
      }, 0);
    }
  };

  return {
    markDirty,
    syncIfIdle,
    /** 快照拉取后清账（bridge 的 getSnapshot 用） */
    clearDirty: () => { unsyncedChanges = false; },
    hasUnsyncedChanges: () => unsyncedChanges,
  };
}
