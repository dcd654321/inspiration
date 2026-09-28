'use strict';

const { activeSupplements } = require('../core/inspiration');
const { formatAbsolute } = require('../core/format');
const USE_TEMPLATES = Object.freeze([
  { id: 'free', name: '自由稿' }, { id: 'social', name: '社交内容' },
  { id: 'video', name: '短视频脚本' }, { id: 'work', name: '工作提纲' },
  { id: 'action', name: '行动清单' }
]);

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

/** 模板只提供结构和空项，不推断用户意图、不补写事实。 */
function buildTemplateText(item, selectedIds, templateId) {
  if (templateId === 'free' || !templateId) return buildUseText(item, selectedIds);
  if (!USE_TEMPLATES.some((template) => template.id === templateId)) throw Error('UNKNOWN_TEMPLATE');
  const text = buildUseText(item, selectedIds);
  if (!text) return '';
  const layouts = {
    social: ['【内容素材】', '\n\n【标题】\n\n【开头】\n\n【结尾】'],
    video: ['【内容素材】', '\n\n【开场】\n画面：\n旁白：\n\n【展开】\n画面：\n旁白：\n\n【收尾】\n画面：\n旁白：'],
    work: ['【背景与材料】', '\n\n【目标】\n\n【讨论要点】\n\n【下一步】'],
    action: ['【想法与依据】', '\n\n【行动清单】\n□ 任务：\n  完成标准：\n  计划时间：']
  };
  return layouts[templateId][0] + '\n' + text + layouts[templateId][1];
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

module.exports = { currentSupplements, buildUseText, buildArchiveText, USE_TEMPLATES, buildTemplateText };
