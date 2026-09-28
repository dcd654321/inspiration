'use strict';
const crypto = require('node:crypto');
const TABLE = 'linggan_ai_usage';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
function createCloudAiQuota({ db, now = Date.now, dailyLimit = 20, minuteLimit = 3 }) {
  const daily = Math.min(20, Math.max(1, Number(dailyLimit) || 20));
  const perMinute = Math.min(3, Math.max(1, Number(minuteLimit) || 3));
  return {
    async reserve(accountKey, requestId, fingerprint) {
      const time = now(), dayStart = Math.floor((time + 28800000) / 86400000) * 86400000 - 28800000;
      const id = hash(accountKey + '|' + dayStart), requestHash = hash(requestId);
      const minuteStart = Math.floor(time / 60000) * 60000;
      const collection = db.collection(TABLE);
      const found = await collection.where({ _id: id }).limit(1).get();
      if (!found.data.length) {
        try { await collection.add({ data: { _id: id, dayStart, used: 0, minuteStart, minuteUsed: 0, requests: {}, expiresAt: dayStart + 8 * 86400000 } }); }
        catch (err) { if (!(await collection.where({ _id: id }).limit(1).get()).data.length) throw err; }
      }
      return db.runTransaction(async (tx) => {
        const ref = tx.collection(TABLE).doc(id), doc = (await ref.get()).data;
        const previous = doc.requests[requestHash];
        if (previous) return { ok: false, code: previous.fingerprint === fingerprint ? 'AI_REQUEST_REPLAY' : 'REQUEST_ID_REUSED' };
        if (doc.used >= daily || Object.keys(doc.requests).length >= 100) return { ok: false, code: 'AI_QUOTA_EXCEEDED' };
        const minuteUsed = doc.minuteStart === minuteStart ? doc.minuteUsed : 0;
        if (minuteUsed >= perMinute) return { ok: false, code: 'AI_RATE_LIMITED' };
        await ref.update({ data: { used: doc.used + 1, minuteStart, minuteUsed: minuteUsed + 1,
          requests: Object.assign({}, doc.requests, { [requestHash]: { status: 'pending', fingerprint } }) } });
        return { ok: true, id, requestHash };
      });
    },
    async finish(lease, refund) {
      return db.runTransaction(async (tx) => {
        const ref = tx.collection(TABLE).doc(lease.id), doc = (await ref.get()).data;
        const request = doc.requests[lease.requestHash];
        if (!request || request.status !== 'pending') return;
        await ref.update({ data: { used: Math.max(0, doc.used - (refund ? 1 : 0)),
          requests: Object.assign({}, doc.requests, { [lease.requestHash]: Object.assign({}, request, { status: refund ? 'failed' : 'done' }) }) } });
      });
    }
  };
}
module.exports = { createCloudAiQuota };
