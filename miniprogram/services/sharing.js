'use strict';

const cloudConfig = require('../config/cloud');
const { currentSupplements, USE_TEMPLATES } = require('./content-output');
const { createWxTransport, createRequestId } = require('./wx-transport');

function createShareClient(options) {
  const opts = options || {};
  const transport = opts.transport || createWxTransport({ functionName: cloudConfig.apiFunction,
    callFunction: opts.client ? (input) => opts.client.callFunction(input) : undefined });
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

function publicTemplate(templateId) {
  return USE_TEMPLATES.find((template) => template.id === templateId) || null;
}

function chatShareCard(preview, token) {
  const imageUrl = '/assets/share-card.png';
  if (!preview || typeof token !== 'string' || !/^[A-Za-z0-9]{28}$/.test(token)) {
    return { title: '随手记一句，整理成能用的文字', path: '/pages/welcome/index', imageUrl };
  }
  const template = publicTemplate(preview.templateId);
  const title = typeof preview.title === 'string' && preview.title.trim() ? preview.title.trim() : '一份文字分享';
  return { title: title + (template && template.id !== 'free' ? '｜' + template.name : ''),
    path: '/pages/shared/index?t=' + token, imageUrl };
}

module.exports = { createShareClient, selectedPreview, shareRevision, publicTemplate, chatShareCard };
