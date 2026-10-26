'use strict';
const { activeSupplements, isDeleted, isMerged, isArchived, byUpdatedAtDesc } = require('../core/inspiration');
const DAY = 86400000;
const valid = (item) => item && !isDeleted(item) && !isMerged(item) && !isArchived(item);

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
  const archived = opts.archived === true;
  return (items || []).filter((item) => archived
    ? item && !isDeleted(item) && !isMerged(item) && isArchived(item)
    : merged ? item && !isDeleted(item) && isMerged(item) && !isArchived(item) : valid(item))
    .sort(archived ? (a, b) => b.archivedAt - a.archivedAt || byUpdatedAtDesc(a, b) || a.id.localeCompare(b.id) : byUpdatedAtDesc).flatMap((item) => {
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

module.exports = { searchInspirations };
