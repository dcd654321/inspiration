'use strict';
const { activeSupplements, isDeleted, isMerged, byUpdatedAtDesc } = require('../core/inspiration');
const DAY = 86400000;
const valid = (item) => item && !isDeleted(item) && !isMerged(item);
const dayKey = (at) => new Date(at + 8 * 3600000).toISOString().slice(0, 10);

function snippet(text, query) {
  const index = text.toLocaleLowerCase().indexOf(query);
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, Math.max(start + 90, index + query.length));
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function searchInspirations(items, options) {
  const opts = options || {};
  const query = String(opts.query || '').trim().slice(0, 100).toLocaleLowerCase();
  const at = opts.now == null ? Date.now() : opts.now;
  // 旧调用方用 filter 表达单项条件；列表页的筛选面板用 recent 布尔量叠加到其他条件上。
  // 两套写法都保留：filter 的四个值语义不变，recent 是新增的可组合条件。
  const merged = opts.filter === 'merged';
  const recent = opts.recent === true || opts.filter === 'recent';
  return (items || []).filter((item) => merged ? item && !isDeleted(item) && isMerged(item) : valid(item)).sort(byUpdatedAtDesc).flatMap((item) => {
    const supplements = activeSupplements(item);
    if (opts.filter === 'supplemented' && supplements.length === 0) return [];
    if (recent && item.updatedAt < at - 7 * DAY) return [];
    if (['seed', 'growing', 'ready'].includes(opts.stage) && (item.stage || 'seed') !== opts.stage) return [];
    if (!query) return [{ item, matchText: '', matchSource: '' }];
    const choices = [{ text: item.text, source: '正文' }].concat(supplements.map((s) => ({ text: s.content, source: '补充' })), (item.tags || []).map((text) => ({ text, source: '标签' })));
    const found = choices.find((entry) => typeof entry.text === 'string' && entry.text.toLocaleLowerCase().includes(query));
    return found ? [{ item, matchText: snippet(found.text, query), matchSource: found.source }] : [];
  });
}

function createReviewService({ storage, cacheScope, now = Date.now }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope)) throw Error('INVALID_REVIEW_SCOPE');
  const key = 'linggan:v2:' + cacheScope + ':review';
  function read() {
    const value = storage.get(key);
    return value && typeof value.enabled === 'boolean' && typeof value.dayKey === 'string' &&
      (value.selectedId === null || typeof value.selectedId === 'string') && typeof value.dismissed === 'boolean'
      ? value : { enabled: true, dayKey: '', selectedId: null, dismissed: false };
  }
  function setEnabled(enabled) { storage.set(key, Object.assign({}, read(), { enabled: enabled === true })); }
  function getRecommendation(items) {
    let state = read();
    if (!state.enabled) return null;
    const at = now();
    const today = dayKey(at);
    if (state.dayKey !== today) {
      const candidates = (items || []).filter((item) => valid(item) && item.updatedAt <= at - 2 * DAY)
        .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id)).slice(0, 10);
      const index = Math.floor(at / DAY) % Math.max(candidates.length, 1);
      state = { enabled: true, dayKey: today, selectedId: candidates[index] ? candidates[index].id : null, dismissed: false };
      storage.set(key, state);
    }
    if (state.dismissed || !state.selectedId) return null;
    return (items || []).find((item) => valid(item) && item.id === state.selectedId) || null;
  }
  function dismiss() { storage.set(key, Object.assign({}, read(), { dayKey: dayKey(now()), dismissed: true })); }
  return { isEnabled: () => read().enabled, setEnabled, getRecommendation, dismiss };
}

module.exports = { searchInspirations, createReviewService };
