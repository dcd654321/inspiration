'use strict';

const valid = (value) => Boolean(value && /^[a-f0-9]{32}$/.test(value.cacheScope || '') &&
  Number.isSafeInteger(value.generation) && value.generation > 0);
const sameContext = (left, right) => valid(left) && valid(right) &&
  left.cacheScope === right.cacheScope && left.generation === right.generation;
const copy = (value) => JSON.parse(JSON.stringify(value));

function draftContext(app, store) {
  if (!app || !store || app.globalData.store !== store) return null;
  const revision = typeof store.getConfirmedRevision === 'function' ? store.getConfirmedRevision()
    : typeof store.readSnapshot === 'function' ? store.readSnapshot() : null;
  const context = { cacheScope: app.globalData.cacheScope, generation: revision && revision.generation };
  return valid(context) ? context : null;
}

// 文字来源版本不携带照片路径或文件权限；字段序列稳定，数组顺序有意义。
function sourceVersion(value) {
  function canonical(entry) {
    if (Array.isArray(entry)) return entry.map(canonical);
    if (entry && typeof entry === 'object') return Object.keys(entry).sort().reduce((result, key) => {
      if (key !== 'photos') result[key] = canonical(entry[key]);
      return result;
    }, {});
    return entry;
  }
  return JSON.stringify(canonical(value));
}

function createSessionDrafts({ now = Date.now, maxEntries = 12, maxAge = 30 * 60 * 1000 } = {}) {
  let context = null;
  const entries = new Map();
  const trim = () => {
    for (const [key, entry] of entries) if (now() - entry.at >= maxAge) entries.delete(key);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  return {
    bind(next) {
      if (!valid(next)) { entries.clear(); context = null; return; }
      if (!sameContext(context, next)) entries.clear();
      context = copy(next); trim();
    },
    put(key, owner, value) {
      if (!sameContext(context, owner) || typeof key !== 'string' || !key) return false;
      entries.delete(key);
      entries.set(key, { at: now(), value: copy(value) }); trim(); return true;
    },
    get(key, owner) {
      trim();
      if (!sameContext(context, owner)) return null;
      const entry = entries.get(key); return entry ? copy(entry.value) : null;
    },
    remove(key, owner) { if (sameContext(context, owner)) entries.delete(key); },
    clear() { entries.clear(); context = null; }
  };
}

module.exports = { createSessionDrafts, draftContext, sameContext, sourceVersion };
