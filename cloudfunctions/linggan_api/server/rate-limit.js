'use strict';

const crypto = require('node:crypto');
const RATES = Object.freeze({ 'share.create': 20, 'share.get': 60, 'share.qr': 5,
  'share.listMine': 30, 'share.revoke': 30, 'feedback.create': 10,
  'feedback.listMine': 30, 'feedback.reportShare': 10 });

function createCloudRateLimiter({ db, now = Date.now }) {
  return async function rateLimit(accountKey, action) {
    if (!accountKey || !Object.hasOwn(RATES, action)) throw Error('INVALID_RATE_SCOPE');
    const start = Math.floor(now() / 60000) * 60000;
    const id = crypto.createHash('sha256').update(JSON.stringify([accountKey, action, start])).digest('hex');
    const collection = db.collection('linggan_rate_limits');
    const found = await collection.where({ _id: id }).limit(1).get();
    if (!found.data.length) {
      try { await collection.add({ data: { _id: id, action, windowStart: start, used: 0, expiresAt: start + 60000 + 86400000 } }); }
      catch (err) {
        if (!(await collection.where({ _id: id }).limit(1).get()).data.length) throw err;
      }
    }
    const result = await collection.where({ _id: id, used: db.command.lt(RATES[action]) })
      .update({ data: { used: db.command.inc(1) } });
    return !!(result && result.stats && result.stats.updated === 1);
  };
}

module.exports = { createCloudRateLimiter, RATES };
