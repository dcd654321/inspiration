'use strict';

const crypto = require('node:crypto');
const { dayStart } = require('./sharing-feedback');
const COLLECTIONS = { shares: 'linggan_shares', feedback: 'linggan_feedback', usage: 'linggan_usage' };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const one = (result) => Array.isArray(result.data) ? result.data[0] || null : result.data || null;
function limited(code) { const err = new Error(code); err.code = code; throw err; }

function createCloudSharingDb({ db, accounts, now = Date.now }) {
  async function first(name, where) { return one(await db.collection(name).where(where).limit(1).get()); }
  async function count(name, where) { return (await db.collection(name).where(where).count()).total || 0; }
  async function list(name, field, owner, before, limit) {
    const where = { [field]: owner };
    if (before) where._id = db.command.lt(before);
    return (await db.collection(name).where(where).orderBy('_id', 'desc').limit(limit).get()).data || [];
  }
  // 初始化只允许与新版写入并行；部署前必须停止旧版无配额写入。
  async function ensureUsage(accountKey, at) {
    const id = hash(accountKey);
    if (await first(COLLECTIONS.usage, { _id: id })) return id;
    const start = dayStart(at);
    const active = await db.collection(COLLECTIONS.shares).where({ ownerAccountKey: accountKey,
      revokedAt: null, expiresAt: db.command.gt(at) }).limit(21).get();
    const data = { _id: id, accountKey, dayStart: start,
      shareCount: await count(COLLECTIONS.shares, { ownerAccountKey: accountKey, createdAt: db.command.gte(start) }),
      feedbackCount: await count(COLLECTIONS.feedback, { accountKey, createdAt: db.command.gte(start) }),
      activeShares: (active.data || []).map((x) => ({ shareId: x._id, expiresAt: x.expiresAt })), updatedAt: at };
    try { await db.collection(COLLECTIONS.usage).add({ data }); }
    catch (err) { if (!await first(COLLECTIONS.usage, { _id: id })) throw err; }
    return id;
  }
  async function insert(doc, kind) {
    const accountKey = kind === 'share' ? doc.ownerAccountKey : doc.accountKey;
    const at = now();
    const id = await ensureUsage(accountKey, at);
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.usage).doc(id);
      const current = one(await ref.get());
      if (!current || current.accountKey !== accountKey || !Array.isArray(current.activeShares)) throw Error('INVALID_QUOTA');
      const next = Object.assign({}, current, { updatedAt: at,
        activeShares: current.activeShares.filter((x) => x.expiresAt > at) });
      if (next.dayStart !== dayStart(at)) {
        next.dayStart = dayStart(at); next.shareCount = 0; next.feedbackCount = 0;
      }
      if (kind === 'share') {
        if (next.shareCount >= 10 || next.activeShares.length >= 20) limited('SHARE_LIMIT');
        next.shareCount += 1;
        next.activeShares.push({ shareId: doc._id, expiresAt: doc.expiresAt });
      } else {
        if (next.feedbackCount >= 5) limited('FEEDBACK_LIMIT');
        next.feedbackCount += 1;
      }
      delete next._id;
      await ref.set({ data: next });
      // 唯一索引冲突会回滚整个事务，包括额度；服务层再读取原请求结果。
      await transaction.collection(kind === 'share' ? COLLECTIONS.shares : COLLECTIONS.feedback).add({ data: doc });
    });
  }
  async function revokeShare(owner, id, at) {
    const usageId = await ensureUsage(owner, at);
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.shares).doc(id);
      const doc = one(await ref.get());
      if (!doc || doc.ownerAccountKey !== owner) throw Error('NOT_FOUND');
      const quotaRef = transaction.collection(COLLECTIONS.usage).doc(usageId);
      const quota = one(await quotaRef.get());
      if (!quota || !Array.isArray(quota.activeShares)) throw Error('INVALID_QUOTA');
      if (doc.revokedAt == null) await ref.update({ data: { revokedAt: at } });
      await quotaRef.update({ data: { activeShares: quota.activeShares.filter((x) => x.shareId !== id), updatedAt: at } });
    });
  }
  return {
    getAccount: (key) => accounts.get(key),
    findShareByRequest: (ownerAccountKey, requestId) => first(COLLECTIONS.shares, { ownerAccountKey, requestId }),
    findShareByHash: (tokenHash) => first(COLLECTIONS.shares, { tokenHash }),
    findShareById: (_id) => first(COLLECTIONS.shares, { _id }),
    insertShare: (doc) => insert(doc, 'share'),
    listShares: (owner, before, limit) => list(COLLECTIONS.shares, 'ownerAccountKey', owner, before, limit),
    countActiveShares: (ownerAccountKey, at) => count(COLLECTIONS.shares, { ownerAccountKey, revokedAt: null, expiresAt: db.command.gt(at) }),
    countSharesSince: (ownerAccountKey, at) => count(COLLECTIONS.shares, { ownerAccountKey, createdAt: db.command.gte(at) }),
    revokeShare,
    async revokeSharesForSource(ownerAccountKey, sourceInspirationId, at) {
      // 不用 skip：每次处理后条件不再命中，重试从剩余记录继续。
      for (let batch = 0; batch < 10; batch += 1) {
        const result = await db.collection(COLLECTIONS.shares).where({ ownerAccountKey, sourceInspirationId, revokedAt: null }).limit(20).get();
        if (!result.data.length) return;
        for (const doc of result.data) await revokeShare(ownerAccountKey, doc._id, at);
      }
      throw Error('REVOKE_RETRY_REQUIRED');
    },
    findFeedbackByRequest: (accountKey, requestId) => first(COLLECTIONS.feedback, { accountKey, requestId }),
    findFeedbackByDedupeKey: (dedupeKey) => first(COLLECTIONS.feedback, { dedupeKey }),
    insertFeedback: (doc) => insert(doc, 'feedback'),
    listFeedback: (owner, before, limit) => list(COLLECTIONS.feedback, 'accountKey', owner, before, limit),
    countFeedbackSince: (accountKey, at) => count(COLLECTIONS.feedback, { accountKey, createdAt: db.command.gte(at) })
  };
}

module.exports = { createCloudSharingDb, COLLECTIONS };
