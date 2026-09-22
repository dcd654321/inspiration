'use strict';
// AI 能力的调用与降级。
//
// 模型调用（`callModel`）与额度（`quota`）都从外面注入，理由与前几层一致：
// **超时、额度耗尽、契约不合法、内容安全命中这四条降级路径，占了 ai-expansion
// 与 ai-summarize 两份规范里一半的场景**，而它们在真机上很难稳定复现。
//
// 这个模块**只负责「调用 → 校验 → 返回结果对象」**，不负责把结果写进数据。
// 「确认后才落盘」由页面做（task 5.3）：契约校验通过只代表结果可以展示，
// 不代表它可以写进用户的灵感。

const { validateDraft, validateSummary, isTooShortToExpand, isTooFewToSummarize } = require('../core/ai-contract');
const { LIMITS } = require('../core/limits');

const ACTION = { expand: 'expand', summarize: 'summarize' };
const SCOPE = { supplements: 'supplements', inspirations: 'inspirations' };

/** AI 相关的错误码。与云函数协议的错误码分开——这些是「生成失败」，不是「请求失败」。 */
const CODE = {
  disabled: 'AI_DISABLED',
  timeout: 'AI_TIMEOUT',
  quotaExceeded: 'AI_QUOTA_EXCEEDED',
  contractInvalid: 'AI_CONTRACT_INVALID',
  unsafeContent: 'AI_UNSAFE_CONTENT',
  tooShort: 'AI_TOO_SHORT',
  tooFew: 'AI_TOO_FEW',
  tooLarge: 'AI_TOO_LARGE',
  failed: 'AI_FAILED'
};

/** 降级时的提示。规范要求每种失效都明确告知，且不影响基础功能。 */
const MESSAGE = {
  [CODE.disabled]: 'AI 扩展还没开放。',
  [CODE.timeout]: '这次生成花的时间太长，已经停下。可以重试。',
  [CODE.quotaExceeded]: '本次可用额度已用完。',
  [CODE.contractInvalid]: '这次生成的内容不符合要求，没有采用。可以重试。',
  [CODE.unsafeContent]: '这次生成的内容不适合展示，已经丢弃。',
  [CODE.tooShort]: '这条灵感还太短，先补充一点内容再扩展。',
  [CODE.tooFew]: '至少需要两条内容才能汇总。',
  [CODE.tooLarge]: '选中的内容太多了，分批汇总会更稳。',
  [CODE.failed]: '这次生成失败了。可以重试。'
};

function fail(code) {
  return { ok: false, code, message: MESSAGE[code] || MESSAGE[CODE.failed] };
}

function createAiService(options) {
  const opts = options || {};
  const enabled = opts.enabled === true;
  const callModel = opts.callModel;
  const quota = opts.quota || null;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 12000;

  /** 带超时的调用。超时不取消底层请求（小程序里也没有可靠的取消手段），
   *  只是不再等它——结果作废，用户看到的是「失败可重试」。 */
  function withTimeout(promise) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ __timeout: true });
      }, timeoutMs);

      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ value });
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ __error: err });
        }
      );
    });
  }

  /**
   * 一次生成的公共流程：未启用 → 额度 → 调用 → 超时 → 契约校验。
   *
   * 顺序是刻意的：**额度在调用之前扣**，否则超额的那次已经把模型调出去了，
   * 成本已经产生。校验不过则退还——那是平台的锅，不该记在用户头上。
   */
  async function run(action, payload, validate) {
    if (!enabled || typeof callModel !== 'function') {
      return fail(CODE.disabled);
    }

    if (quota && typeof quota.tryConsume === 'function' && !quota.tryConsume()) {
      return fail(CODE.quotaExceeded);
    }

    const outcome = await withTimeout(Promise.resolve().then(() => callModel(payload)));
    if (outcome.__timeout) return fail(CODE.timeout);

    if (outcome.__error) {
      if (quota && typeof quota.refund === 'function') quota.refund();
      return fail(CODE.failed);
    }

    const result = validate(outcome.value);
    if (!result.ok) {
      // 校验不过退额度：用户没拿到任何东西
      if (quota && typeof quota.refund === 'function') quota.refund();
      if (result.code === 'UNSAFE_CONTENT') return fail(CODE.unsafeContent);
      return fail(CODE.contractInvalid);
    }

    return { ok: true, value: result.value, action };
  }

  /** 扩展：把一句话展开成结构化草案。 */
  async function expand(input) {
    const data = input || {};
    // 过短的正文只会得到空洞的草案，而且规范要求**不消耗额度**
    if (isTooShortToExpand(data.text)) {
      return fail(CODE.tooShort);
    }
    return run(ACTION.expand, {
      action: ACTION.expand,
      text: data.text,
      supplements: Array.isArray(data.supplements) ? data.supplements : []
    }, validateDraft);
  }

  /**
   * 汇总：把多条收成一条。
   *
   * 请求体必须卡上限，否则勾选几十条长灵感会打出一次超大请求，成本与超时都不可控。
   */
  async function summarize(input) {
    const data = input || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const scope = data.scope;

    if (scope !== SCOPE.supplements && scope !== SCOPE.inspirations) {
      return fail(CODE.failed);
    }
    // 少于两条发出去也是白耗额度
    if (isTooFewToSummarize(items.length)) {
      return fail(CODE.tooFew);
    }
    if (items.length > LIMITS.summaryMaxSourceItems) {
      return fail(CODE.tooLarge);
    }

    let totalChars = 0;
    for (const item of items) {
      totalChars += typeof item.content === 'string' ? item.content.length : 0;
    }
    if (totalChars > LIMITS.summaryMaxSourceChars) {
      return fail(CODE.tooLarge);
    }

    return run(ACTION.summarize, {
      action: ACTION.summarize,
      scope,
      items: items.map((item) => ({ id: item.id, content: item.content }))
    }, validateSummary);
  }

  return { expand, summarize };
}

module.exports = { createAiService, ACTION, SCOPE, CODE, MESSAGE };
