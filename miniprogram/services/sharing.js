'use strict';

const cloudConfig = require('../config/cloud');
const { currentSupplements } = require('./content-output');
const { createWxTransport, createRequestId } = require('./wx-transport');

function createShareClient(options) {
  const opts = options || {};
  const transport = opts.transport || createWxTransport({ functionName: cloudConfig.apiFunction });
  return {
    send: (action, payload, requestId) => transport.send(action, payload, requestId ? { requestId } : undefined),
    newRequestId: opts.newRequestId || createRequestId
  };
}

function selectedPreview(item, ids) {
  const supplements = currentSupplements(item);
  const selected = new Set(ids);
  if (selected.size !== ids.length || ids.some((id) => !supplements.some((s) => s.id === id))) return null;
  if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
  return [item.text.trim()].concat(supplements.filter((s) => selected.has(s.id)).map((s) => s.content.trim())).join('\n\n');
}

function shareRevision(store) {
  if (!store || typeof store.getConfirmedRevision !== 'function') return null;
  return store.getConfirmedRevision();
}

module.exports = { createShareClient, selectedPreview, shareRevision };
