'use strict';
const core = require('../core/inspiration');
const { mergeInspirations } = require('../core/merge');
const { validateSummary, checkSafety } = require('../core/ai-contract');
const { createAiService } = require('./ai');
const { createWxTransport } = require('./wx-transport');
function createWxAi(config) {
  const transport = createWxTransport({ functionName: config.functionName });
  return createAiService({ enabled: config.enabled, timeoutMs: config.timeoutMs, async callModel(payload) {
    const response = await transport.send(payload.action, payload);
    if (!response.ok) { const err = Error('AI_FAILED'); err.code = response.code; throw err; }
    return response.data;
  } });
}
function acceptDraft(item, entries, { newId, now }) {
  const selected = entries.filter((entry) => entry.selected);
  if (!selected.length || selected.length > 15) throw Error('请选择需要保留的内容。');
  let next = item;
  for (const entry of selected) {
    if (typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > 200 || !checkSafety(entry.content).ok) throw Error('选中的内容为空、过长或不适合保存，请修改后重试。');
    next = core.appendSupplement(next, { content: entry.content, source: 'ai', id: newId('sup'), now });
  }
  return [next];
}
function acceptSummary(items, { scope, id, sourceIds, mode, targetId, text, newId, now }) {
  const checked = validateSummary({ text });
  if (!checked.ok) throw Error('汇总内容为空、过长或不适合保存，请修改后重试。');
  if (!['overwrite', 'append'].includes(mode)) throw Error('请选择汇总的保存方式。');
  if (scope === 'supplements') {
    return [core.mergeSupplements(items.find((item) => item.id === id), { sourceIds, mode,
      summary: { id: newId('sup'), content: checked.value.text }, now })];
  }
  const next = mergeInspirations(items, { sourceIds, mode, targetId, summaryText: checked.value.text,
    newId: mode === 'append' ? newId('insp') : undefined, historyId: newId('tex'), now });
  return next.filter((item) => JSON.stringify(items.find((old) => old.id === item.id)) !== JSON.stringify(item));
}
module.exports = { createWxAi, acceptDraft, acceptSummary };
