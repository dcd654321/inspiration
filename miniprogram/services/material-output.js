'use strict';
const { currentSupplements, buildTemplateText } = require('./content-output');
const MATERIAL_LIMITS = Object.freeze({ parts: 40, sources: 20, chars: 12000 });

function listMaterials(items) {
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.deletedAt || item.mergedInto || typeof item.text !== 'string' || !item.text.trim()) continue;
    const source = { inspirationId: item.id, sourceText: item.text.slice(0, 45) };
    result.push(Object.assign({}, source, { key: item.id + ':text', kind: '正文', content: item.text, createdAt: item.createdAt }));
    for (const entry of currentSupplements(item)) {
      if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
      result.push(Object.assign({}, source, { key: item.id + ':supplement:' + entry.id, kind: '补充', content: entry.content, createdAt: entry.createdAt }));
    }
  }
  return result;
}

function buildMaterialDraft(items, selections, templateId) {
  if (!Array.isArray(selections) || !selections.length) throw Error('请至少选择一段素材。');
  if (selections.length > MATERIAL_LIMITS.parts) throw Error('每次最多选择四十段素材，请减少选择。');
  const available = new Map(listMaterials(items).map((entry) => [entry.key, entry]));
  const keys = new Set(), sources = new Set(), parts = [];
  for (const selected of selections) {
    if (!selected || typeof selected.key !== 'string' || keys.has(selected.key)) throw Error('选材重复或无效，请重新选择。');
    keys.add(selected.key);
    const current = available.get(selected.key);
    if (!current || current.content !== selected.content) throw Error('部分来源已修改、删除或收起。请刷新素材后重新选择，当前稿件仍保留。');
    sources.add(current.inspirationId); parts.push(current.content);
  }
  if (sources.size > MATERIAL_LIMITS.sources) throw Error('每次最多使用二十条灵感，请减少来源。');
  const text = parts.join('\n\n');
  if (text.length > MATERIAL_LIMITS.chars) throw Error('所选素材合计超过 12000 字，请减少选择。');
  return { text: buildTemplateText({ text, supplements: [] }, [], templateId), materialCount: parts.length, sourceCount: sources.size };
}

module.exports = { MATERIAL_LIMITS, listMaterials, buildMaterialDraft };
