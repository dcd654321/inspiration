'use strict';

const crypto = require('node:crypto');
const REQUEST_RE = /^[A-Za-z0-9_-]{8,128}$/;
const DAY = 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_DAY = 5;

function ok(data) { return { ok: true, data }; }
function fail(code, message) { return { ok: false, code, message }; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ownKeysOnly(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
}
function dayStart(ms) { return Math.floor((ms + 8 * 3600000) / DAY) * DAY - 8 * 3600000; }
function makeId(at, randomBytes) {
  return at.toString(36).padStart(10, '0') + '_' + randomBytes(8).toString('hex');
}
function feedbackView(doc) {
  return { feedbackId: doc._id, category: doc.category, body: doc.body,
    status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

function createFeedbackService(options) {
  const opts = options || {};
  const db = opts.db;
  const now = opts.now || Date.now;
  const randomBytes = opts.randomBytes || crypto.randomBytes;
  if (!db) throw new Error('createFeedbackService 需要 db');

  async function createFeedback(accountKey, payload, requestId) {
    if (!ownKeysOnly(payload, ['category', 'body']) || !['bug', 'idea', 'other'].includes(payload.category)) {
      return fail('INVALID_PAYLOAD', '反馈类别无效');
    }
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId) || typeof payload.body !== 'string' ||
      payload.body.trim().length < 10 || payload.body.trim().length > 1000) {
      return fail('INVALID_PAYLOAD', '请填写 10 到 1000 字的意见');
    }
    const text = payload.body.trim();
    // 保留普通反馈原有摘要格式，同一历史请求仍能回读原结果。
    const digest = sha(JSON.stringify([payload.category, text, null]));
    const previous = await db.findFeedbackByRequest(accountKey, requestId);
    if (previous) return previous.requestDigest === digest
      ? ok(feedbackView(previous)) : fail('REQUEST_ID_REUSED', '请求标识与操作内容不一致');
    const at = now();
    if (await db.countFeedbackSince(accountKey, dayStart(at)) >= MAX_FEEDBACK_DAY) {
      return fail('FEEDBACK_LIMIT', '今天提交的反馈已达上限');
    }
    const doc = { _id: makeId(at, randomBytes), accountKey, requestId, requestDigest: digest,
      dedupeKey: 'f_' + randomBytes(16).toString('hex'), category: payload.category, body: text,
      relatedShareId: null, reportDayKey: null, status: 'submitted', createdAt: at, updatedAt: at, closedAt: null };
    try { await db.insertFeedback(doc); }
    catch (err) {
      const raced = await db.findFeedbackByRequest(accountKey, requestId);
      if (raced && raced.requestDigest !== digest) return fail('REQUEST_ID_REUSED', '请求标识与操作内容不一致');
      if (!raced || raced.accountKey !== accountKey) return err.code === 'FEEDBACK_LIMIT'
        ? fail('FEEDBACK_LIMIT', '今天提交的反馈已达上限') : fail('INTERNAL', '反馈暂时无法提交');
      return ok(feedbackView(raced));
    }
    return ok(feedbackView(doc));
  }

  async function listFeedback(accountKey, payload) {
    if (!ownKeysOnly(payload, ['before']) ||
      (payload.before != null && (typeof payload.before !== 'string' || payload.before.length > 80))) {
      return fail('INVALID_PAYLOAD', '列表参数无效');
    }
    const records = await db.listFeedback(accountKey, payload.before || null, 20);
    return ok({ items: records.map(feedbackView), nextBefore: records.length === 20 ? records[records.length - 1]._id : null });
  }

  function guarded(action, fn) {
    return async (accountKey, ...args) => {
      try {
        if (typeof opts.rateLimit !== 'function') throw Error('RATE_LIMIT_UNAVAILABLE');
        if (!await opts.rateLimit(accountKey, action)) return fail('RATE_LIMITED', '操作较频繁，请稍后重试');
      } catch (err) { return fail('RATE_LIMIT_UNAVAILABLE', '服务暂时繁忙，请稍后重试'); }
      return fn(accountKey, ...args);
    };
  }
  return { createFeedback: guarded('feedback.create', createFeedback), listFeedback: guarded('feedback.listMine', listFeedback) };
}

module.exports = { createFeedbackService, dayStart };
