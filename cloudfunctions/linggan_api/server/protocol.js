'use strict';
// 云函数协议层：动作分发、身份、传输层幂等。
//
// 与仓库层分开，是因为这层管的是**协议**（信封、动作名、requestId、错误码），
// 仓库层管的是**数据**（读写、幂等、冲突）。混在一起的话，改协议要动数据逻辑，
// 改数据逻辑又怕碰坏协议。
//
// 身份从参数传进来，**不在这里读 wx 上下文**：这一层要能在 Node 里单测，
// 而取上下文那一步是云函数入口的事（`cloudfunctions/linggan_api/index.js`）。

const { createRepository, CODE } = require('./repository');

const ACTIONS = ['snapshot.pull', 'snapshot.push', 'inspiration.delete'];

const PROTOCOL_CODE = {
  unauthenticated: 'UNAUTHENTICATED',
  forbiddenSource: 'FORBIDDEN_SOURCE',
  invalidAction: 'INVALID_ACTION',
  internal: 'INTERNAL'
};

function fail(code, message) {
  return { ok: false, code, message: message || code };
}

/**
 * @param {object} options
 * @param {object} options.repository  仓库层实例（通常由 createRepository 建）
 * @param {object} [options.requestCache] 传输层幂等缓存：{ get(key), set(key, value) }
 * @param {number} [options.cacheTtlMs]  requestId 缓存有效期
 * @param {() => number} options.now
 */
function createProtocol(options) {
  const opts = options || {};
  const repository = opts.repository || createRepository(opts);
  const requestCache = opts.requestCache || null;
  const cacheTtlMs = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 10 * 60 * 1000;
  const now = opts.now;

  /**
   * 处理一次调用。
   *
   * @param {object} context 可信上下文。**只从这里取身份**——`{ accountKey }` 由云函数
   *   入口用 `cloud.getWXContext()` 推导后传入，绝不接受客户端传的字段。
   * @param {object} event   请求体：`{ action, payload, requestId }`
   */
  async function handle(context, event) {
    const accountKey = context && context.accountKey;

    if (typeof accountKey !== 'string' || accountKey.length === 0) {
      return fail(PROTOCOL_CODE.unauthenticated, '无法确认身份');
    }
    if (context.sourceAllowed === false) {
      return fail(PROTOCOL_CODE.forbiddenSource, '请求来源未获准');
    }

    const request = event || {};
    if (ACTIONS.indexOf(request.action) === -1) {
      return fail(PROTOCOL_CODE.invalidAction, '未知的操作');
    }

    // 传输层幂等：同一 requestId 重试直接返回上次的结果。
    // 与实体级幂等（按 id upsert）是两回事，两者都要有——前者防的是「请求重复到达」，
    // 后者防的是「同一份数据被提交多次」。
    const cacheKey = requestCache && typeof request.requestId === 'string' && request.requestId.length > 0
      ? accountKey + ':' + request.requestId
      : null;

    if (cacheKey) {
      const cached = requestCache.get(cacheKey);
      if (cached && now() - cached.at < cacheTtlMs) return cached.response;
    }

    let response;
    try {
      if (request.action === 'snapshot.pull') {
        response = await repository.pull(accountKey);
      } else if (request.action === 'snapshot.push') {
        response = await repository.push(accountKey, request.payload);
      } else {
        response = await repository.remove(accountKey, request.payload);
      }
    } catch (err) {
      // 未预期的异常一律收敛成一个稳定的码，不把堆栈透给客户端
      response = fail(PROTOCOL_CODE.internal, '服务暂时不可用');
    }

    if (cacheKey) {
      requestCache.set(cacheKey, { at: now(), response });
    }

    return response;
  }

  return { handle, ACTIONS, CODE };
}

module.exports = { createProtocol, ACTIONS, PROTOCOL_CODE, CODE };
