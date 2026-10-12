'use strict';

const crypto = require('node:crypto');
const { dayStart } = require('./feedback');
const COLLECTIONS = { feedback: 'linggan_feedback', usage: 'linggan_usage' };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const one = (result) => Array.isArray(result.data) ? result.data[0] || null : result.data || null;
function limited(code) { const err = new Error(code); err.code = code; throw err; }

function createCloudFeedbackDb({ db, now = Date.now }) {
  async function first(name, where) { return one(await db.collection(name).where(where).limit(1).get()); }
  async function countFeedbackSince(accountKey, at) {
    return (await db.collection(COLLECTIONS.feedback).where({ accountKey, createdAt: db.command.gte(at) }).count()).total || 0;
  }
  async function ensureUsage(accountKey, at) {
    const id = hash(accountKey);
    if (await first(COLLECTIONS.usage, { _id: id })) return id;
    const start = dayStart(at);
    const data = { _id: id, accountKey, dayStart: start,
      feedbackCount: await countFeedbackSince(accountKey, start), updatedAt: at };
    try { await db.collection(COLLECTIONS.usage).add({ data }); }
    catch (err) { if (!await first(COLLECTIONS.usage, { _id: id })) throw err; }
    return id;
  }
  async function insertFeedback(doc) {
    const accountKey = doc.accountKey;
    const at = now();
    const id = await ensureUsage(accountKey, at);
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.usage).doc(id);
      const current = one(await ref.get());
      if (!current || current.accountKey !== accountKey || !Number.isSafeInteger(current.dayStart) ||
        !Number.isSafeInteger(current.feedbackCount) || current.feedbackCount < 0) throw Error('INVALID_QUOTA');
      const start = dayStart(at);
      const used = current.dayStart === start ? current.feedbackCount : 0;
      if (used >= 5) limited('FEEDBACK_LIMIT');
      // 更新反馈字段即可；历史配额文档中的其他字段保持原值。
      await ref.update({ data: { dayStart: start, feedbackCount: used + 1, updatedAt: at } });
      // 唯一索引冲突回滚业务写入与计数，服务层再读取原请求结果。
      await transaction.collection(COLLECTIONS.feedback).add({ data: doc });
    });
  }
  async function listFeedback(accountKey, before, limit) {
    const where = { accountKey };
    if (before) where._id = db.command.lt(before);
    return (await db.collection(COLLECTIONS.feedback).where(where).orderBy('_id', 'desc').limit(limit).get()).data || [];
  }
  return {
    findFeedbackByRequest: (accountKey, requestId) => first(COLLECTIONS.feedback, { accountKey, requestId }),
    insertFeedback, listFeedback, countFeedbackSince
  };
}

module.exports = { createCloudFeedbackDb, COLLECTIONS };
