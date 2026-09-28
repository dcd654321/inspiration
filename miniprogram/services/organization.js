'use strict';
const STAGES = [{ id: 'seed', label: '想法' }, { id: 'growing', label: '整理中' }, { id: 'ready', label: '可使用' }];
function organize(item, { tags, stage, now }) {
  if (!item || item.deletedAt || item.mergedInto) throw Error('请先恢复这条灵感。');
  if (!STAGES.some((x) => x.id === stage)) throw Error('请选择有效的整理阶段。');
  const values = Array.isArray(tags) ? tags.map((x) => typeof x === 'string' ? x.trim() : '') : [];
  if (!Array.isArray(tags) || values.length > 5 || values.some((x) => !x || x.length > 12 || /[\r\n]/.test(x)) || new Set(values).size !== values.length) throw Error('最多添加五个不同标签，每个不超过十二字。');
  return Object.assign({}, item, { tags: values, stage, updatedAt: now });
}
module.exports = { STAGES, organize };
