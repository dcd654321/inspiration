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
const crypto = require('node:crypto');

const ACTIONS = [
  'snapshot.pull', 'snapshot.push', 'inspiration.delete',
  'share.create', 'share.get', 'share.listMine', 'share.revoke', 'share.qr',
  'feedback.create', 'feedback.listMine', 'feedback.reportShare'
];

const PROTOCOL_CODE = {
  unauthenticated: 'UNAUTHENTICATED',
  forbiddenSource: 'FORBIDDEN_SOURCE',
  invalidAction: 'INVALID_ACTION',
  requestIdReused: 'REQUEST_ID_REUSED',
  invalidPayload: 'INVALID_PAYLOAD',
  internal: 'INTERNAL'
};

function fail(code, message) {
  return { ok: false, code, message: message || code };
}

function requestFingerprint(action, payload) {
  const canonical = JSON.stringify([action, payload], (key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const sorted = {};
    Object.keys(value).sort().forEach((name) => { sorted[name] = value[name]; });
    return sorted;
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
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
  const sharing = opts.sharing || null;
  const requestCache = opts.requestCache || null;
  const cacheTtlMs = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 10 * 60 * 1000;
  const now = opts.now;
  const inFlight = new Map();

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

    // 传输层幂等：同一 requestId 只可重试相同的动作与参数。
    // 与实体级幂等（按 id upsert）是两回事，两者都要有——前者防的是「请求重复到达」，
    // 后者防的是「同一份数据被提交多次」。
    // 分享的只读结果与撤销状态有关，绝不能命中旧的传输层成功缓存。
    // 创建动作在新集合里做跨实例幂等，反馈也有持久去重键。
    const cacheKey = requestCache && !/^(share|feedback)\./.test(request.action) &&
      typeof request.requestId === 'string' && request.requestId.length > 0
      ? accountKey + ':' + request.requestId
      : null;
    let fingerprint = null;

    if (cacheKey) {
      try { fingerprint = requestFingerprint(request.action, request.payload); }
      catch (err) { return fail(PROTOCOL_CODE.invalidPayload, '操作内容无效'); }
      const cached = requestCache.get(cacheKey);
      if (cached && now() - cached.at < cacheTtlMs) {
        return cached.fingerprint === fingerprint
          ? cached.response
          : fail(PROTOCOL_CODE.requestIdReused, '请求标识与操作内容不一致');
      }
      const pending = inFlight.get(cacheKey);
      if (pending) {
        return pending.fingerprint === fingerprint
          ? pending.promise
          : fail(PROTOCOL_CODE.requestIdReused, '请求标识与操作内容不一致');
      }
    }

    const execute = async () => {
      let response;
      try {
        if (request.action === 'snapshot.pull') {
          response = await repository.pull(accountKey);
        } else if (request.action === 'snapshot.push') {
          response = await repository.push(accountKey, request.payload);
        } else if (request.action === 'inspiration.delete') {
          response = await repository.remove(accountKey, request.payload);
        } else if (!sharing) {
          response = fail('SERVICE_UNAVAILABLE', '这项服务暂时不可用');
        } else if (request.action === 'share.create') {
          response = await sharing.createShare(accountKey, request.payload, request.requestId);
        } else if (request.action === 'share.get') {
          response = await sharing.getShare(accountKey, request.payload);
        } else if (request.action === 'share.listMine') {
          response = await sharing.listMine(accountKey, request.payload);
        } else if (request.action === 'share.revoke') {
          response = await sharing.revokeShare(accountKey, request.payload);
        } else if (request.action === 'share.qr') {
          response = await sharing.getShareCode(accountKey, request.payload);
        } else if (request.action === 'feedback.create') {
          response = await sharing.createFeedback(accountKey, request.payload, request.requestId);
        } else if (request.action === 'feedback.listMine') {
          response = await sharing.listFeedback(accountKey, request.payload);
        } else {
          response = await sharing.reportShare(accountKey, request.payload, request.requestId);
        }
      } catch (err) {
        // 未预期的异常一律收敛成一个稳定的码，不把堆栈透给客户端
        response = fail(PROTOCOL_CODE.internal, '服务暂时不可用');
      }
      if (cacheKey && response && response.ok === true) {
        requestCache.set(cacheKey, { at: now(), fingerprint, response });
      }
      return response;
    };

    if (!cacheKey) return execute();
    const promise = execute().finally(() => { inFlight.delete(cacheKey); });
    inFlight.set(cacheKey, { fingerprint, promise });
    return promise;
  }

  return { handle, ACTIONS, CODE };
}

module.exports = { createProtocol, ACTIONS, PROTOCOL_CODE, CODE };
