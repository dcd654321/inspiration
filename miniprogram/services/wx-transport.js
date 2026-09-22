'use strict';
// `wx.cloud.callFunction` 的适配器。
//
// store 的 `transport` 一直传的是 null（云未启用），这是它的真实实现。
// 与其他适配器一样，它只做三件事：拼信封、发出去、把结果原样带回来。
//
// **不做重试、不做降级、不解释错误码**——那些是 store 和页面的事。
// 适配器只负责跨过 wx 这道边界，越薄越好：它是最不可能被测到的一层
// （Node 里跑不了 wx），所以逻辑越少，出错的面越小。

const REQUEST_ID_PREFIX = 'req_';

/** 生成一个请求标识。同一逻辑操作重试时必须复用同一个值，否则传输层幂等不成立。 */
function createRequestId() {
  return REQUEST_ID_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * @param {object} options
 * @param {string} options.functionName 云函数名，取自 config/cloud-resources.js
 * @param {(input: object) => Promise<object>} [options.callFunction]
 *   底层调用。默认走 `wx.cloud.callFunction`；**测试时注入替身**——
 *   这一层本身很薄，但「云函数返回了畸形结果」这条路径值得测。
 * @param {() => string} [options.newRequestId] 供测试注入；默认用 createRequestId
 */
function createWxTransport(options) {
  const opts = options || {};
  const functionName = opts.functionName;
  const newRequestId = typeof opts.newRequestId === 'function' ? opts.newRequestId : createRequestId;
  const callFunction = typeof opts.callFunction === 'function'
    ? opts.callFunction
    : (input) => wx.cloud.callFunction(input);

  if (typeof functionName !== 'string' || functionName.length === 0) {
    throw new Error('createWxTransport 需要一个 functionName');
  }

  return {
    /**
     * @param {string} action  动作名，见 server/protocol.js
     * @param {object} payload 动作参数
     * @param {object} [meta]  `{ requestId }`——**重试时必须复用同一个**，
     *   否则服务端会把它当成两次不同的操作各做一遍
     */
    async send(action, payload, meta) {
      const requestId = (meta && meta.requestId) || newRequestId();

      const response = await callFunction({
        name: functionName,
        data: { action, payload, requestId }
      });

      // 云函数抛错时 result 里带的是 errMsg 而不是我们的信封。这种不属于业务失败，
      // 当成一次网络错误交给 store 处理——它会保留内容并稍后重试。
      const result = response && response.result;
      if (!result || typeof result.ok !== 'boolean') {
        return { ok: false, code: 'INTERNAL', message: '服务返回了无法识别的内容' };
      }

      return result;
    }
  };
}

module.exports = { createWxTransport, createRequestId, REQUEST_ID_PREFIX };
