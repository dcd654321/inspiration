'use strict';

const cloudConfig = require('../config/cloud');
const { createWxTransport, createRequestId } = require('./wx-transport');

function createFeedbackClient(options) {
  const opts = options || {};
  const transport = opts.transport || createWxTransport({ functionName: cloudConfig.apiFunction,
    callFunction: opts.client ? (input) => opts.client.callFunction(input) : undefined });
  return {
    send: (action, payload, requestId) => transport.send(action, payload, requestId ? { requestId } : undefined),
    newRequestId: opts.newRequestId || createRequestId
  };
}

module.exports = { createFeedbackClient };
