'use strict';
// 灵感级的汇总编排。
//
// 为什么单独一个模块：`core/inspiration.js` 里的函数都是**对单条对象**的纯函数，
// 而「把多个灵感汇总成一个」是一次跨对象操作——它同时改动目标、来源和（另存时）
// 一条全新的灵感。塞进 inspiration.js 会让那个模块的语义变浑。
//
// 与 `mergeSupplements` 一样做成**一次调用的原子操作**：返回完整的新数组，
// 调用方拿到的要么是全部结果，要么什么都没发生。规范要求「失败不留痕」，
// 分步做的话中间任何一步出错都可能留下半合并状态。

const { LIMITS } = require('./limits');
const { ERROR_CODES, ValidationError } = require('./errors');
const { createInspiration, updateText, markMerged, byUpdatedAtDesc } = require('./inspiration');

const MODES = ['overwrite', 'append'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value);
}

function throwIfAny(errors) {
  if (errors.length > 0) throw new ValidationError(errors);
}

/**
 * 把多个灵感汇总成一个。
 *
 * @param {Inspiration[]} inspirations 当前全部灵感
 * @param {object} input
 * @param {string[]} input.sourceIds   被勾选的灵感 id
 * @param {'overwrite'|'append'} input.mode
 * @param {string} input.summaryText   汇总结果文本
 * @param {string} [input.targetId]    mode 为 overwrite 时必填，必须是 sourceIds 之一
 * @param {string} [input.newId]       mode 为 append 时必填，新灵感的 id
 * @param {string} [input.historyId]   mode 为 overwrite 时必填，目标原文进历史要用
 * @param {number} input.now
 *
 * @returns {Inspiration[]} 新的完整数组（按 updatedAt 倒序）。失败抛 ValidationError。
 *
 * **覆盖与另存的差别只在「汇总结果落在哪」和「来源是否收起」**，数据从不删除：
 *
 * | | 汇总结果 | 被汇总的来源 |
 * | --- | --- | --- |
 * | overwrite | 成为目标的 text（旧原文进历史） | 写 mergedInto，默认收起 |
 * | append | 成为一条全新灵感 | 写 mergedInto，默认收起 |
 */
function mergeInspirations(inspirations, input) {
  const list = Array.isArray(inspirations) ? inspirations : [];
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const sourceIds = Array.isArray(source.sourceIds) ? source.sourceIds : null;
  if (!sourceIds) {
    errors.push({ field: 'sourceIds', code: ERROR_CODES.MISSING_FIELD });
  } else if (sourceIds.length < LIMITS.mergeMinItems) {
    // 少于两条没有汇总的意义。界面应当在调用前就拦住，这里是兜底。
    errors.push({ field: 'sourceIds', code: ERROR_CODES.LIMIT_EXCEEDED });
  }

  if (MODES.indexOf(source.mode) === -1) {
    errors.push({ field: 'mode', code: ERROR_CODES.INVALID_MERGE_MODE });
  }

  if (typeof source.summaryText !== 'string' || source.summaryText.trim().length === 0) {
    errors.push({ field: 'summaryText', code: ERROR_CODES.EMPTY_TEXT });
  } else if (source.summaryText.length > LIMITS.textMaxLength) {
    errors.push({ field: 'summaryText', code: ERROR_CODES.TEXT_TOO_LONG });
  }

  if (source.now === undefined || typeof source.now !== 'number' || !Number.isFinite(source.now)) {
    errors.push({ field: 'now', code: ERROR_CODES.INVALID_NOW });
  }

  if (sourceIds) {
    // 来源必须都存在、且都没被合并过
    sourceIds.forEach((id) => {
      const found = list.filter((item) => item.id === id)[0];
      if (!found) {
        errors.push({ field: 'sourceIds', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
      } else if (found.mergedInto) {
        errors.push({ field: 'sourceIds', code: ERROR_CODES.ALREADY_MERGED });
      }
    });

    if (source.mode === 'overwrite') {
      if (!isValidId(source.targetId)) {
        errors.push({ field: 'targetId', code: source.targetId ? ERROR_CODES.INVALID_ID : ERROR_CODES.MISSING_FIELD });
      } else if (sourceIds.indexOf(source.targetId) === -1) {
        // 目标必须是被勾选的之一。否则「覆盖」会去改一条用户根本没选中的灵感。
        errors.push({ field: 'targetId', code: ERROR_CODES.MERGE_SELF });
      }
      if (!isValidId(source.historyId)) {
        errors.push({ field: 'historyId', code: ERROR_CODES.EMPTY_HISTORY_ID });
      }
    }

    if (source.mode === 'append') {
      if (!isValidId(source.newId)) {
        errors.push({ field: 'newId', code: source.newId ? ERROR_CODES.INVALID_ID : ERROR_CODES.MISSING_FIELD });
      } else if (sourceIds.indexOf(source.newId) !== -1) {
        errors.push({ field: 'newId', code: ERROR_CODES.MERGE_SELF });
      }
    }
  }

  throwIfAny(errors);

  const now = source.now;
  let next = list.slice();

  if (source.mode === 'overwrite') {
    const target = next.filter((item) => item.id === source.targetId)[0];
    // 走 updateText 而不是直接改 text：旧原文必须进历史，而且 historyId 由它来强制
    const updated = updateText(target, { text: source.summaryText, historyId: source.historyId, now });
    next = next.map((item) => (item.id === source.targetId ? updated : item));

    // 目标自己不该被标为「已合并进自己」
    sourceIds
      .filter((id) => id !== source.targetId)
      .forEach((id) => {
        next = next.map((item) => (
          item.id === id ? markMerged(item, { targetId: source.targetId, now }) : item
        ));
      });
  } else {
    const created = createInspiration({ text: source.summaryText, id: source.newId, now });
    next = next.concat([created]);

    sourceIds.forEach((id) => {
      next = next.map((item) => (
        item.id === id ? markMerged(item, { targetId: source.newId, now }) : item
      ));
    });
  }

  return next.slice().sort(byUpdatedAtDesc);
}

module.exports = { mergeInspirations, MODES };
