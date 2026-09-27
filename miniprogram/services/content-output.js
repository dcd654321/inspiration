'use strict';

const { activeSupplements } = require('../core/inspiration');
const { formatAbsolute } = require('../core/format');

function byCreatedAt(a, b) {
  return a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id));
}

/** 只输出时间线上仍有效的补充；已并入正文的内容不能重复出现。 */
function currentSupplements(item) {
  if (!item) return [];
  return activeSupplements(item).slice().sort(byCreatedAt);
}

/** 使用稿不加品牌、时间和标签，可直接粘贴到用户自己的目的地。 */
function buildUseText(item, selectedIds) {
  if (!item || typeof item.text !== 'string') return '';
  const selected = Array.isArray(selectedIds) ? new Set(selectedIds) : null;
  const parts = [item.text];
  currentSupplements(item).forEach((supplement) => {
    if (!selected || selected.has(supplement.id)) parts.push(supplement.content);
  });
  return parts.join('\n\n');
}

function historyLines(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return ['无'];
  const lines = [];
  entries.slice().sort((a, b) => a.replacedAt - b.replacedAt).forEach((entry, index) => {
    lines.push((index + 1) + '. 修改于 ' + formatAbsolute(entry.replacedAt));
    lines.push(entry.text);
    if (index < entries.length - 1) lines.push('');
  });
  return lines;
}

/** 留档保留现存内容与历史，不含照片、已删除补充或内部标识。 */
function buildArchiveText(item, generatedAt) {
  if (!item || typeof item.text !== 'string') return '';
  const lines = [
    '灵感文字留档',
    '生成时间：' + formatAbsolute(generatedAt),
    '记录时间：' + formatAbsolute(item.createdAt),
    '最近修改：' + formatAbsolute(item.updatedAt),
    '',
    '【当前正文】',
    item.text,
    '',
    '【原文修改记录】'
  ];
  lines.push(...historyLines(item.textHistory));
  lines.push('', '【补充】');

  const supplements = Array.isArray(item.supplements) ? item.supplements.slice().sort(byCreatedAt) : [];
  if (supplements.length === 0) lines.push('无');
  supplements.forEach((supplement, index) => {
    const source = supplement.source === 'ai' ? ' · AI 生成，请核对' : '';
    const state = supplement.foldedAt ? ' · 已并入正文' : (supplement.mergedInto ? ' · 已合并' : '');
    lines.push('');
    lines.push((index + 1) + '. ' + formatAbsolute(supplement.createdAt) + source + state);
    lines.push(supplement.content);
    lines.push('修改记录：');
    lines.push(...historyLines(supplement.contentHistory));
  });

  return lines.join('\n');
}

module.exports = { currentSupplements, buildUseText, buildArchiveText };
