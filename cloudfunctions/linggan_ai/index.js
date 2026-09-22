'use strict';
// 云函数入口：linggan_ai
//
// 与 linggan_api 一样，这里只做入口该做的事：取身份、调模型、用契约校验输出、
// 收敛错误码。**没有任何业务数据在这里落盘**——AI 的输出要不要写入，由用户在
// 客户端确认（见 ai-expansion 规范「用户确认后才落盘」）。
//
// ⚠️ `./server/` 与 `./core/` 是 `scripts/build-cloud.cjs` 同步过来的副本。
// **不要直接改这里的文件**——改了会被下次同步覆盖，`npm run check` 也会报不一致。
//
// `./core/` 与小程序端是**同一份代码**，这是刻意的：两边的契约与内容安全规则
// 一旦分叉，就会出现「客户端认为安全、服务端认为不安全」这种极难排查的问题。

const cloud = require('wx-server-sdk');

const { validateDraft, validateSummary } = require('./core/ai-contract');
const { LIMITS } = require('./core/limits');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ACTIONS = ['expand', 'summarize'];

/**
 * 调用模型。
 *
 * ⚠️ **厂商尚未确定**（docs/PENDING-INPUT.md 第 2.1 项）。在它定下来之前，
 * 这里只会返回「未接入」——**绝不会伪造一个看起来像 AI 的结果**。规范明令禁止
 * 以「AI 扩展」名义展示本地规则拼接的内容。
 *
 * 接入时要遵守的两条：
 *   1. 密钥只从 `process.env` 读，**不进仓库、不进前端包**。
 *   2. 超时由这一个函数自己控制，别让它拖垮调用方。
 */
async function callModel(action, payload) {
  const apiKey = process.env.LINGGAN_AI_KEY;
  const endpoint = process.env.LINGGAN_AI_ENDPOINT;

  if (!apiKey || !endpoint) {
    return { ok: false, code: 'AI_DISABLED', message: 'AI 扩展还没开放。' };
  }

  // TODO(2.1)：接入具体厂商。请求体按 action 组装：
  //   expand    → { text, supplements }
  //   summarize → { scope, items }
  // 返回值需是 validateDraft / validateSummary 能接受的形状。
  return { ok: false, code: 'AI_DISABLED', message: 'AI 扩展还没开放。' };
}

function fail(code, message) {
  return { ok: false, code, message };
}

exports.main = async (event) => {
  const request = event || {};

  // 身份只从可信上下文取。这个函数目前不用它做额度计算，但调用记录要绑定到身份上，
  // 所以缺失身份时直接拒绝，不给出「匿名可用」的路径。
  const wxContext = cloud.getWXContext();
  if (!wxContext || !wxContext.OPENID) {
    return fail('UNAUTHENTICATED', '无法确认身份');
  }

  if (ACTIONS.indexOf(request.action) === -1) {
    return fail('INVALID_ACTION', '未知的操作');
  }

  const payload = request.payload || {};

  // 请求体上限在服务端**再卡一次**。客户端已经卡过，但不能假设请求一定来自客户端。
  if (request.action === 'summarize') {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length < LIMITS.mergeMinItems) return fail('AI_TOO_FEW', '至少需要两条内容才能汇总。');
    if (items.length > LIMITS.summaryMaxSourceItems) return fail('AI_TOO_LARGE', '选中的内容太多了。');

    let total = 0;
    for (const item of items) total += typeof item.content === 'string' ? item.content.length : 0;
    if (total > LIMITS.summaryMaxSourceChars) return fail('AI_TOO_LARGE', '选中的内容太长了。');
  }

  let raw;
  try {
    raw = await callModel(request.action, payload);
  } catch (err) {
    return fail('AI_FAILED', '这次生成失败了。可以重试。');
  }

  if (!raw || raw.ok !== true) {
    return raw || fail('AI_FAILED', '这次生成失败了。可以重试。');
  }

  // 输出契约与内容安全校验。**不通过就不返回内容**——不展示也就无从写入。
  const result = request.action === 'expand' ? validateDraft(raw.data) : validateSummary(raw.data);
  if (!result.ok) {
    return fail(result.code, '这次生成的内容不符合要求，没有采用。');
  }

  return { ok: true, data: result.value };
};
