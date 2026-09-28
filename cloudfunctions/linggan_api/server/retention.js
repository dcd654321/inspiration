'use strict';

const crypto = require('node:crypto');
const DAY = 86400000;

function createRetentionService({ db, now = Date.now }) {
  return {
    async run(options) {
      const opts = options || {};
      const at = now();
      const dryRun = opts.dryRun !== false;
      const limit = Number.isSafeInteger(opts.limit) ? Math.max(1, Math.min(100, opts.limit)) : 50;
      const counts = { shares: { eligible: 0, changed: 0, failed: 0 },
        feedback: { eligible: 0, changed: 0, failed: 0 }, rates: { eligible: 0, changed: 0, failed: 0 }, aiUsage: { eligible: 0, changed: 0, failed: 0 } };
      const scans = [
        ['shares', 'expired', at - 90 * DAY], ['shares', 'revoked', at - 90 * DAY],
        ['feedback', 'closed', at - 180 * DAY], ['feedback', 'open', at - 365 * DAY],
        ['rates', 'expired', at], ['aiUsage', 'expired', at]
      ];
      const seen = new Set();
      for (const [kind, reason, cutoff] of scans) {
        let rows;
        try { rows = await db.candidates(kind, reason, cutoff, limit); }
        catch (err) { counts[kind].failed += 1; continue; }
        for (const row of rows) {
          const key = kind + ':' + row._id;
          if (seen.has(key)) continue;
          seen.add(key);
          counts[kind].eligible += 1;
          if (dryRun) continue;
          try {
            if (await db.clean(kind, reason, row._id, cutoff, at)) counts[kind].changed += 1;
          } catch (err) { counts[kind].failed += 1; }
        }
      }
      return { dryRun, limit, counts };
    }
  };
}

function createCloudRetentionDb(db) {
  const names = { shares: 'linggan_shares', feedback: 'linggan_feedback', rates: 'linggan_rate_limits', aiUsage: 'linggan_ai_usage' };
  function condition(kind, reason, cutoff) {
    if (kind === 'shares') return { payloadPurgedAt: null,
      [reason === 'revoked' ? 'revokedAt' : 'expiresAt']: db.command.lte(cutoff).and(db.command.gt(0)) };
    if (kind === 'feedback') return reason === 'closed'
      ? { status: 'closed', closedAt: db.command.lte(cutoff).and(db.command.gt(0)) }
      : { status: db.command.neq('closed'), createdAt: db.command.lte(cutoff) };
    return { expiresAt: db.command.lte(cutoff) };
  }
  return {
    async candidates(kind, reason, cutoff, limit) {
      const result = await db.collection(names[kind]).where(condition(kind, reason, cutoff))
        .field({ _id: true }).orderBy('_id', 'asc').limit(limit).get();
      return result.data || [];
    },
    async clean(kind, reason, id, cutoff, at) {
      const query = db.collection(names[kind]).where(Object.assign({ _id: id }, condition(kind, reason, cutoff)));
      if (kind === 'shares') {
        const result = await query.update({ data: { snapshot: null, tokenCiphertext: null, payloadPurgedAt: at } });
        return result.stats.updated === 1;
      }
      const result = await query.remove();
      return result.stats.removed === 1;
    }
  };
}

function createMaintenanceHandler({ run, context, env }) {
  return async (event) => {
    const identity = context() || {};
    const expected = env.LINGGAN_MAINTENANCE_TOKEN;
    const token = event && event.token;
    if (identity.OPENID || identity.FROM_OPENID || typeof expected !== 'string' || expected.length < 32 ||
      typeof token !== 'string' || token.length > 256 ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const dryRun = env.LINGGAN_MAINTENANCE_ENABLED !== 'true' || event.dryRun !== false;
    try { return { ok: true, data: await run({ dryRun, limit: event.limit }) }; }
    catch (err) { return { ok: false, code: 'MAINTENANCE_FAILED' }; }
  };
}

module.exports = { createRetentionService, createCloudRetentionDb, createMaintenanceHandler };
