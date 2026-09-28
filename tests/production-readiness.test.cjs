'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryCloudDatabase } = require('./helpers/cloud-db.cjs');
const { createCloudSharingDb } = require('../server/cloud-sharing-db');
const { createCloudRateLimiter } = require('../server/rate-limit');
const { createSharingFeedbackService } = require('../server/sharing-feedback');
const { createRetentionService, createCloudRetentionDb, createMaintenanceHandler } = require('../server/retention');
const DAY = 86400000;
const at = Date.UTC(2026, 8, 27, 6);
function share(id, owner = 'owner', createdAt = at) {
  return { _id: id, ownerAccountKey: owner, requestId: id, tokenHash: id, createdAt,
    expiresAt: at + 30 * DAY, revokedAt: null, payloadPurgedAt: null, sourceInspirationId: 'idea',
    snapshot: { body: 'private', title: 'title' }, tokenCiphertext: { data: 'cipher' } };
}
function feedback(id) { return { _id: id, accountKey: 'owner', requestId: id, dedupeKey: id, createdAt: at }; }

test('原子配额：多实例并发创建不超限且失败事务不占额', async () => {
  const db = memoryCloudDatabase();
  const a = createCloudSharingDb({ db, accounts: {}, now: () => at });
  const b = createCloudSharingDb({ db, accounts: {}, now: () => at });
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).insertShare(share('s' + i))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal(db.rows('linggan_shares').length, 10);
  assert.equal(db.rows('linggan_usage')[0].shareCount, 10);
  const fbs = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => a.insertFeedback(feedback('f' + i))));
  assert.equal(fbs.filter((r) => r.status === 'fulfilled').length, 5);
  assert.equal(db.rows('linggan_feedback').length, 5);
});

test('配额事务：重复请求回滚计数，撤销释放有效分享名额', async () => {
  const db = memoryCloudDatabase();
  const api = createCloudSharingDb({ db, accounts: {}, now: () => at });
  await api.insertShare(share('one'));
  await assert.rejects(api.insertShare(Object.assign(share('two'), { requestId: 'one' })));
  assert.equal(db.rows('linggan_usage')[0].shareCount, 1);
  await api.revokeShare('owner', 'one', at);
  assert.equal(db.rows('linggan_usage')[0].activeShares.length, 0);
  assert.equal(db.rows('linggan_usage')[0].shareCount, 1);
  await assert.rejects(api.revokeShare('other', 'one', at));
});

test('配额事务：旧数据基线和跨日有效上限不被重置绕过', async () => {
  const db = memoryCloudDatabase();
  db.seed('linggan_shares', Array.from({ length: 20 }, (_, i) => share('old' + i, 'owner', at - DAY)));
  let clock = at;
  const api = createCloudSharingDb({ db, accounts: {}, now: () => clock });
  await assert.rejects(api.insertShare(share('new')), { code: 'SHARE_LIMIT' });
  await api.revokeShare('owner', 'old0', at);
  await api.insertShare(share('new'));
  clock += DAY;
  await assert.rejects(api.insertShare(share('tomorrow')), { code: 'SHARE_LIMIT' });
  clock += 31 * DAY;
  await api.insertShare(Object.assign(share('later'), { createdAt: clock, expiresAt: clock + DAY }));
  assert.equal(db.rows('linggan_usage')[0].shareCount, 1);
  assert.equal(db.rows('linggan_usage')[0].activeShares.length, 1);
});

test('访问限流：跨实例固定窗口原子递增并隔离账户和动作', async () => {
  const db = memoryCloudDatabase();
  let clock = at;
  const a = createCloudRateLimiter({ db, now: () => clock });
  const b = createCloudRateLimiter({ db, now: () => clock });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)('owner', 'share.qr')));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(await a('other', 'share.qr'), true);
  assert.equal(await a('owner', 'share.get'), true);
  clock += 60000;
  assert.equal(await a('owner', 'share.qr'), true);
});

test('访问限流失败关闭，不读正文也不生成小程序码', async () => {
  let accessed = false;
  const db = { findShareByHash: async () => { accessed = true; } };
  const denied = createSharingFeedbackService({ db, rateLimit: async () => false });
  assert.equal((await denied.getShare('owner', { token: 'A'.repeat(28) })).code, 'RATE_LIMITED');
  assert.equal((await denied.getShareCode('owner', { token: 'A'.repeat(28) })).code, 'RATE_LIMITED');
  const unavailable = createSharingFeedbackService({ db });
  assert.equal((await unavailable.getShare('owner', { token: 'A'.repeat(28) })).code, 'RATE_LIMIT_UNAVAILABLE');
  assert.equal(accessed, false);
});

test('保留期清理：默认演练无写入，执行只清到期内容并保留分享元数据', async () => {
  const db = memoryCloudDatabase();
  db.seed('linggan_shares', [Object.assign(share('expired'), { expiresAt: at - 90 * DAY }),
    Object.assign(share('revoked'), { revokedAt: at - 91 * DAY }), share('active')]);
  db.seed('linggan_feedback', [
    { _id: 'oldopen', status: 'submitted', createdAt: at - 365 * DAY },
    { _id: 'oldclosed', status: 'closed', closedAt: at - 180 * DAY },
    { _id: 'recentclosed', status: 'closed', createdAt: at - 400 * DAY, closedAt: at - DAY }
  ]);
  db.seed('linggan_rate_limits', [{ _id: 'old', expiresAt: at - 1 }, { _id: 'new', expiresAt: at + DAY }]);
  const service = createRetentionService({ db: createCloudRetentionDb(db), now: () => at });
  const preview = await service.run({});
  assert.equal(preview.dryRun, true);
  assert.equal(preview.counts.shares.eligible, 2);
  assert.equal(db.rows('linggan_shares')[0].snapshot.body, 'private');
  const result = await service.run({ dryRun: false });
  assert.equal(result.counts.shares.changed, 2);
  assert.equal(db.rows('linggan_shares').length, 3);
  assert.equal(db.rows('linggan_shares')[0].snapshot, null);
  assert.equal(db.rows('linggan_shares')[0].tokenCiphertext, null);
  assert.equal(db.rows('linggan_shares')[2].snapshot.body, 'private');
  assert.equal(db.rows('linggan_feedback').length, 1);
  assert.equal(db.rows('linggan_rate_limits').length, 1);
  assert.equal((await service.run({ dryRun: false })).counts.shares.changed, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('保留期清理：扫描后状态变化不误删，失败记录下次可重试', async () => {
  const db = memoryCloudDatabase();
  db.seed('linggan_feedback', [{ _id: 'f', status: 'submitted', createdAt: at - 400 * DAY }]);
  const adapter = createCloudRetentionDb(db);
  const clean = adapter.clean;
  adapter.clean = async (...args) => {
    await db.collection('linggan_feedback').where({ _id: 'f' }).update({ data: { status: 'closed', closedAt: at } });
    return clean(...args);
  };
  const service = createRetentionService({ db: adapter, now: () => at });
  assert.equal((await service.run({ dryRun: false })).counts.feedback.changed, 0);
  assert.equal(db.rows('linggan_feedback').length, 1);
  db.seed('linggan_shares', [Object.assign(share('old'), { expiresAt: at - 90 * DAY })]);
  adapter.clean = async () => { throw Error('FAIL'); };
  assert.equal((await service.run({ dryRun: false })).counts.shares.failed, 1);
  adapter.clean = clean;
  assert.equal((await service.run({ dryRun: false })).counts.shares.changed, 1);
});

test('清理入口：客户端伪造事件被拒，默认演练且必须显式开启执行', async () => {
  const token = 'x'.repeat(48);
  const env = { LINGGAN_MAINTENANCE_TOKEN: token };
  let identity = {};
  const calls = [];
  const handler = createMaintenanceHandler({ run: async (options) => { calls.push(options); return options; }, context: () => identity, env });
  assert.equal((await handler({ Type: 'Timer', token: 'bad', dryRun: false })).code, 'FORBIDDEN');
  identity = { OPENID: 'trusted-caller' };
  assert.equal((await handler({ Type: 'Timer', token, dryRun: false })).code, 'FORBIDDEN');
  identity = {};
  assert.equal((await handler({ token, dryRun: false })).data.dryRun, true);
  env.LINGGAN_MAINTENANCE_ENABLED = 'true';
  assert.equal((await handler({ token })).data.dryRun, true);
  assert.equal((await handler({ token, dryRun: false })).data.dryRun, false);
  assert.equal(calls.length, 3);
});
