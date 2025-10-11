// Simple global registry mapping card uniqueID -> {el: DOM element, tag: parent container tag}
const registry = new Map();

export function registerCardEl(id, el, parent_container_tag) {
  if (id == null || !el) return;
  if (!parent_container_tag) {
    console.warn("registerCardEl missing parent_container_tag", id, el);
    return;
  }
  registry.set(id, {el: el, tag: parent_container_tag});
}

// 仅在parent_container_tag与当前注册的匹配时才删除，避免误删
export function unregisterCardEl(id, parent_container_tag) {
  if (id == null) return;
  if(!parent_container_tag) {
    console.warn("unregisterCardEl missing parent_container_tag", id);
  }
  const current = registry.get(id);
  if (current && current.tag === parent_container_tag) {
    registry.delete(id);
  }
}

export function getCardEl(id) {
  return registry.get(id)?.el || null;
}

export default { registerCardEl, unregisterCardEl, getCardEl };

