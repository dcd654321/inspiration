'use strict';
// AI 输出契约。
//
// 规范要求：模型返回的内容必须先通过结构与长度校验、再做内容安全过滤，
// 任何一道不过就**不展示、不写入**，按本次生成失败处理并允许重试。
// 本模块是那道关卡的唯一实现，页面与云函数都要走到它。
//
// 与 core/inspiration.js 的差别：这里的文本是模型产出，不是用户写下的原文，
// 因此条目会 trim 后返回（去掉首尾空白是规范化，不是改写用户内容）。

const { LIMITS } = require('./limits');
const { ERROR_CODES, ValidationError } = require('./errors');

// 草案的三个分区。缺任何一个都按契约不完整处理。
const SECTIONS = [
  { key: 'points', label: '要点' },
  { key: 'nextSteps', label: '下一步' },
  { key: 'risks', label: '风险' }
];

// 越界内容规则。
//
// 覆盖规范点名的四类超出本产品范围的内容：医疗与用药、极端行为、外部链接。
// 规则刻意保守——误伤会让正常灵感拿不到草案，比漏放更影响使用。
// **这份清单需要在实施前单独评审**，尤其要确认误伤的处置方式。
const SAFETY_RULES = [
  {
    name: 'EXTERNAL_LINK',
    // 只匹配明确的链接形态，不匹配「链接」「入口」这类普通词。
    pattern: /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|cn|net|org|io|co|me|xyz|top)\b)/i
  },
  {
    name: 'MEDICAL',
    pattern: /(吃药|用药|服药|停药|剂量|处方|药品|药物|抗生素|安眠药|退烧药|诊断|治疗方案|临床)/
  },
  {
    name: 'EXTREME_BEHAVIOR',
    pattern: /(自杀|自残|轻生|结束生命|伤害自己|伤害他人)/
  }
];

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  return value;
}

/**
 * 内容安全过滤。命中任一规则即视为不可展示。
 * 返回命中规则名，便于定位是哪一条规则拦下的。
 */
function checkSafety(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: true };
  }
  for (let i = 0; i < SAFETY_RULES.length; i += 1) {
    if (SAFETY_RULES[i].pattern.test(text)) {
      return { ok: false, rule: SAFETY_RULES[i].name };
    }
  }
  return { ok: true };
}

/** 结构与长度校验，不做内容安全。 */
function validateStructure(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: ERROR_CODES.INVALID_TYPE, field: 'draft' };
  }

  const value = {};

  for (let i = 0; i < SECTIONS.length; i += 1) {
    const { key } = SECTIONS[i];

    if (!Object.prototype.hasOwnProperty.call(raw, key) || raw[key] === undefined || raw[key] === null) {
      return { ok: false, code: ERROR_CODES.MISSING_SECTION, field: key };
    }
    if (!Array.isArray(raw[key])) {
      return { ok: false, code: ERROR_CODES.INVALID_TYPE, field: key };
    }
    if (raw[key].length < LIMITS.draftSectionMinItems) {
      return { ok: false, code: ERROR_CODES.TOO_FEW_ITEMS, field: key };
    }
    if (raw[key].length > LIMITS.draftSectionMaxItems) {
      return { ok: false, code: ERROR_CODES.TOO_MANY_ITEMS, field: key };
    }

    const items = [];
    for (let j = 0; j < raw[key].length; j += 1) {
      const item = raw[key][j];
      const field = key + '[' + j + ']';

      if (typeof item !== 'string') {
        return { ok: false, code: ERROR_CODES.INVALID_TYPE, field };
      }
      const trimmed = item.trim();
      if (trimmed.length === 0) {
        return { ok: false, code: ERROR_CODES.EMPTY_ITEM, field };
      }
      if (trimmed.length > LIMITS.draftItemMaxLength) {
        return { ok: false, code: ERROR_CODES.ITEM_TOO_LONG, field };
      }
      items.push(trimmed);
    }
    value[key] = items;
  }

  return { ok: true, value };
}

/**
 * 契约校验的唯一入口：先结构后安全。
 *
 * 返回 { ok: true, value } 或 { ok: false, code, field, rule? }。
 * 不抛错——调用方需要把失败当成一次可重试的生成失败来处理，而不是异常。
 */
function validateDraft(raw) {
  const structure = validateStructure(raw);
  if (!structure.ok) {
    return structure;
  }

  for (let i = 0; i < SECTIONS.length; i += 1) {
    const key = SECTIONS[i].key;
    for (let j = 0; j < structure.value[key].length; j += 1) {
      const safety = checkSafety(structure.value[key][j]);
      if (!safety.ok) {
        return {
          ok: false,
          code: ERROR_CODES.UNSAFE_CONTENT,
          field: key + '[' + j + ']',
          rule: safety.rule
        };
      }
    }
  }

  return { ok: true, value: deepFreeze(structure.value) };
}

/** 抛错版，供需要中断流程的调用方使用。 */
function parseDraft(raw) {
  const result = validateDraft(raw);
  if (!result.ok) {
    throw new ValidationError([{ field: result.field, code: result.code }]);
  }
  return result.value;
}

/** 正文是否短到不值得请求扩展：过短只会得到空洞草案，且规范要求不消耗额度。 */
function isTooShortToExpand(text) {
  return typeof text !== 'string' || text.trim().length < LIMITS.aiMinTextLength;
}

/**
 * 汇总结果的契约校验（`{ text: string }`）。
 *
 * 与 validateDraft 的差别：汇总**不产出结构化三分区**，只产出一段连续文本——
 * 汇总的本质是把多条收成一条，不是重新分析。所以这里没有分区与条目数的概念，
 * 只有「一段非空、不超长、不越界的话」。
 *
 * 两种校验共用同一条内容安全规则（checkSafety），不各写一套。
 */
function validateSummary(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: ERROR_CODES.INVALID_TYPE, field: 'summary' };
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'text') || raw.text === undefined || raw.text === null) {
    return { ok: false, code: ERROR_CODES.MISSING_FIELD, field: 'text' };
  }
  if (typeof raw.text !== 'string') {
    return { ok: false, code: ERROR_CODES.INVALID_TYPE, field: 'text' };
  }

  const text = raw.text.trim();
  if (text.length === 0) {
    return { ok: false, code: ERROR_CODES.EMPTY_ITEM, field: 'text' };
  }
  if (text.length > LIMITS.summaryMaxLength) {
    return { ok: false, code: ERROR_CODES.ITEM_TOO_LONG, field: 'text' };
  }

  const safety = checkSafety(text);
  if (!safety.ok) {
    return { ok: false, code: ERROR_CODES.UNSAFE_CONTENT, field: 'text', rule: safety.rule };
  }

  return { ok: true, value: deepFreeze({ text }) };
}

/** 抛错版，供需要中断流程的调用方使用。 */
function parseSummary(raw) {
  const result = validateSummary(raw);
  if (!result.ok) {
    throw new ValidationError([{ field: result.field, code: result.code }]);
  }
  return result.value;
}

/**
 * 该不该发起一次汇总。少于两条（补充）或两个（灵感）没有意义，
 * **必须在调用前拦住**——否则会白白消耗一次生成额度。
 */
function isTooFewToSummarize(itemCount) {
  return typeof itemCount !== 'number' || itemCount < LIMITS.mergeMinItems;
}

module.exports = {
  SECTIONS,
  SAFETY_RULES,
  validateDraft,
  validateStructure,
  parseDraft,
  validateSummary,
  parseSummary,
  checkSafety,
  isTooShortToExpand,
  isTooFewToSummarize
};
