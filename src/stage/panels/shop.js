// 售货机操纵面板（场景式商店房点售货机 → 下沿停靠 / 无场景的占位路径）。

/**
 * 售货机操纵面板（场景式商店房里点售货机 → 下沿停靠）。
 * @param snap 房间快照
 * @param opts.standalone 无场景的占位路径（房间面板就是这一份）：末尾给"离开房间"而不是"离开售货机"
 * @param opts.buttons    带购买按钮（缺省 = standalone）。场景版不带：3D 货架就在眼前，
 *                        再排一列按钮只会把面板顶高、把货架挤到操纵条下面
 */
export function buildShopPanel(snap, { standalone = false, buttons = standalone } = {}) {
  const shop = snap.shop ?? { items: [], pending: null };
  const w = [];

  // 卡包/遗物包三选一（买到即开，金币已扣）：**走全屏选择 overlay**（用户定 2026-09-12：
  // "不要塞在操纵条里"），操纵条只留一个兜底入口（overlay 已自动打开，这里是安全阀）。
  // 三选一**可放弃**：overlay 的「返回」= 放弃这个包（钱已花，选择权在你）。
  if (shop.pending) {
    if (shop.pending.kind === 'relic') {
      w.push({ kind: 'title', text: `遗物包 · ${shop.pending.rarity} 级`, align: 'center' });
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '三件遗物中挑一件（不想要就放弃）' });
      w.push({
        kind: 'button', id: 'shop:openRelicPack', width: 300, size: 'main',
        label: '打开遗物包选择', action: { action: 'openShopRelicPack', local: true },
      });
      return w;
    }
    w.push({ kind: 'title', text: `卡包 · ${shop.pending.packId}`, align: 'center' });
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '包内三选一——择一张加入牌组（不想要就放弃）' });
    w.push({
      kind: 'button', id: 'shop:openPack', width: 300, size: 'main',
      label: '打开卡包选择', action: { action: 'openShopPack', local: true },
    });
    return w;
  }

  w.push({ kind: 'title', text: '售货机', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `持有 ${snap.money} 金币`
      + (shop.discount < 1 ? ` ｜ 瑞米给了折扣（${Math.round(shop.discount * 10)} 折）` : ''),
  });
  // 购买有两条路：**直接点货架上的商品**（场景里的 billboard，买不起价格标红）或这里的按钮。
  // 场景版（dock 停靠面板）**不再放按钮**：货架就在眼前的 3D 里，重复一排按钮只会把面板顶高、
  // 把货架挤到操纵条下面去；占位版（standalone）没有 3D 货架，才需要按钮。
  w.push({
    kind: 'sub', align: 'center', tint: '#77809a',
    text: buttons ? '选择要买的商品：' : '点击货架上的商品直接购买（买不起的价格标红）｜点面板外可拉远',
  });
  if (shop.broken) {
    w.push({
      kind: 'sub', align: 'center', tint: '#c9a86a',
      text: '瑞米：“上次逃得太狼狈了，嘿嘿……忘记补货了……”',
    });
  }
  // 商品**已经在 3D 货柜里**（billboard + 价签，可直接点买）——场景版（dock 操纵条）不再把
  // 货柜内容复述一遍列表（用户 2026-09-13 报："下方UI又把货柜内的物品描述了一遍，很蠢"）。
  // 只有无场景的占位版（standalone，眼前没有 3D 货架）才需要列表 + 购买按钮作为唯一入口。
  if (buttons) {
    for (const it of shop.items) {
      const tag = it.kind === 'relic' ? '[遗物]' : it.kind === 'pack' ? '[卡包]' : it.kind === 'apple' ? '[苹果]' : '[补给]';
      w.push({
        kind: 'text', align: 'center',
        tint: it.sold ? '#5d6584' : (it.affordable ? undefined : '#8a6a6a'),
        text: `${tag} ${it.label} ｜ ${it.price} 金` + (it.sold ? '（已售出）' : ''),
        // 遗物货 hover 出效果预览（买之前能看清是什么）
        ...(it.relicId ? { token: { type: 'relic', payload: { relicId: it.relicId } } } : {}),
      });
      if (!it.sold) {
        w.push({
          kind: 'button', id: `shop:buy:${it.index}`, width: 240, size: 'sub',
          label: it.affordable ? `购买（${it.price} 金）` : '金币不足',
          enabled: it.affordable,
          action: { action: 'buyShopItem', index: it.index },
        });
      }
    }
  }
  w.push({ kind: 'gap' });
  if (standalone) {
    w.push({ kind: 'button', id: 'shop:leaveRoom', width: 220, size: 'sub', label: '离开', action: { action: 'leaveRoom' } });
  }
  // 场景版（dock 操纵条）：**不给「离开售货机/返回房间」按钮**——点面板外的房间空白处
  // 即拉远回全景（与所有机器面板同一套退出口，用户定 2026-09-12）
  return w;
}
