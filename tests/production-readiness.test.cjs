'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { memoryCloudDatabase } = require('./helpers/cloud-db.cjs');
const { createCloudFeedbackDb } = require('../server/cloud-feedback-db');
const { createCloudRateLimiter } = require('../server/rate-limit');
const { createFeedbackService, dayStart } = require('../server/feedback');
const { createRetentionService, createCloudRetentionDb, createMaintenanceHandler } = require('../server/retention');
const DAY = 86400000;
const at = Date.UTC(2026, 8, 27, 6);

test('全量复核：维护函数入口缺密钥和客户端身份拒绝且默认只演练', async () => {
  const db = memoryCloudDatabase(), token = 'synthetic'.repeat(6), env = {};
  let identity = {}, collections = 0, initialized;
  const originalCollection = db.collection;
  db.collection = function (name) { collections++; return originalCollection.call(this, name); };
  const exports = {}, filename = path.resolve(__dirname, '../cloudfunctions/linggan_maintenance/index.js');
  const cloud = { DYNAMIC_CURRENT_ENV: 'dynamic', init: (options) => { initialized = options.env; },
    database: () => db, getWXContext: () => identity };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports, process: { env }, require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === './server/retention') return require('../server/retention');
      throw Error('Unexpected module ' + name);
    }
  }, { filename });
  assert.equal(initialized, 'dynamic');
  assert.equal((await exports.main({ token, dryRun: false })).code, 'FORBIDDEN');
  assert.equal(collections, 0);
  env.LINGGAN_MAINTENANCE_TOKEN = token;
  identity = { FROM_OPENID: 'synthetic_user' };
  assert.equal((await exports.main({ token, dryRun: false })).code, 'FORBIDDEN');
  assert.equal(collections, 0);
  identity = {};
  const result = await exports.main({ token, dryRun: false });
  assert.equal(result.ok, true); assert.equal(result.data.dryRun, true);
  assert.equal(collections, 5);
});
function share(id, owner = 'owner', createdAt = at) {
  return { _id: id, ownerAccountKey: owner, requestId: id, tokenHash: id, createdAt,
    expiresAt: at + 30 * DAY, revokedAt: null, payloadPurgedAt: null, sourceInspirationId: 'idea',
    snapshot: { body: 'private', title: 'title' }, tokenCiphertext: { data: 'cipher' } };
}
function feedback(id) { return { _id: id, accountKey: 'owner', requestId: id, dedupeKey: id, createdAt: at }; }

test('原子反馈配额：多实例并发提交不超限且失败事务不占额', async () => {
  const db = memoryCloudDatabase();
  const scanned = [], collection = db.collection;
  db.collection = function (name) { scanned.push(name); return collection.call(this, name); };
  const a = createCloudFeedbackDb({ db, now: () => at });
  const b = createCloudFeedbackDb({ db, now: () => at });
  const fbs = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => (i % 2 ? a : b).insertFeedback(feedback('f' + i))));
  assert.equal(fbs.filter((r) => r.status === 'fulfilled').length, 5);
  assert.equal(db.rows('linggan_feedback').length, 5);
  assert.equal(db.rows('linggan_usage')[0].feedbackCount, 5);
  assert.deepEqual(Object.keys(db.rows('linggan_usage')[0]).sort(), ['_id', 'accountKey', 'dayStart', 'feedbackCount', 'updatedAt']);
  assert.equal(scanned.includes('linggan_shares'), false);
});

test('反馈配额事务：重复请求回滚计数，跨日重置且保留历史字段', async () => {
  const db = memoryCloudDatabase();
  const id = crypto.createHash('sha256').update('owner').digest('hex');
  const legacy = { _id: id, accountKey: 'owner', dayStart: dayStart(at), feedbackCount: 0,
    shareCount: 8, activeShares: { historical: 'unvalidated' }, updatedAt: at };
  db.seed('linggan_usage', [legacy]);
  let clock = at;
  const api = createCloudFeedbackDb({ db, now: () => clock });
  await api.insertFeedback(feedback('one'));
  await assert.rejects(api.insertFeedback({ ...feedback('two'), requestId: 'one' }));
  assert.equal(db.rows('linggan_usage')[0].feedbackCount, 1);
  assert.equal(db.rows('linggan_feedback').length, 1);
  clock += DAY;
  await api.insertFeedback({ ...feedback('next'), createdAt: clock });
  const next = db.rows('linggan_usage')[0];
  assert.equal(next.feedbackCount, 1);
  assert.equal(next.dayStart, dayStart(clock));
  assert.equal(next.shareCount, legacy.shareCount);
  assert.deepEqual(next.activeShares, legacy.activeShares);
});

test('反馈配额：从已有反馈初始化日基线并拒绝非法计数', async () => {
  const db = memoryCloudDatabase();
  db.seed('linggan_feedback', Array.from({ length: 5 }, (_, i) => feedback('old' + i)));
  let clock = at;
  const api = createCloudFeedbackDb({ db, now: () => clock });
  await assert.rejects(api.insertFeedback(feedback('new')), { code: 'FEEDBACK_LIMIT' });
  assert.equal(db.rows('linggan_usage')[0].feedbackCount, 5);
  clock += DAY;
  await api.insertFeedback({ ...feedback('tomorrow'), createdAt: clock });
  assert.equal(db.rows('linggan_usage')[0].feedbackCount, 1);
  const usage = db.rows('linggan_usage')[0];
  for (const invalid of [undefined, -1, NaN, '1']) {
    db.seed('linggan_usage', [{ ...usage, feedbackCount: invalid }]);
    await assert.rejects(api.insertFeedback({ ...feedback('bad'), createdAt: clock }), /INVALID_QUOTA/);
  }
  assert.equal(db.rows('linggan_feedback').length, 6);
});

test('访问限流：跨实例固定窗口原子递增并隔离账户和动作', async () => {
  const db = memoryCloudDatabase();
  let clock = at;
  const a = createCloudRateLimiter({ db, now: () => clock });
  const b = createCloudRateLimiter({ db, now: () => clock });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)('owner', 'feedback.create')));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(await a('other', 'feedback.create'), true);
  assert.equal(await a('owner', 'feedback.listMine'), true);
  clock += 60000;
  assert.equal(await a('owner', 'feedback.create'), true);
  await assert.rejects(a('owner', 'share.get'), /INVALID_RATE_SCOPE/);
});

test('反馈访问限流失败关闭，不查询或写入业务内容', async () => {
  let accessed = false;
  const db = new Proxy({}, { get() { accessed = true; assert.fail('限流失败前不得访问反馈'); } });
  const denied = createFeedbackService({ db, rateLimit: async () => false });
  const payload = { category: 'idea', body: '希望增加搜索和筛选功能' };
  assert.equal((await denied.createFeedback('owner', payload, 'req_denied_01')).code, 'RATE_LIMITED');
  assert.equal((await denied.listFeedback('owner', {})).code, 'RATE_LIMITED');
  const unavailable = createFeedbackService({ db });
  assert.equal((await unavailable.listFeedback('owner', {})).code, 'RATE_LIMIT_UNAVAILABLE');
  const errored = createFeedbackService({ db, rateLimit: async () => { throw Error('DENIED'); } });
  assert.equal((await errored.createFeedback('owner', payload, 'req_denied_01')).code, 'RATE_LIMIT_UNAVAILABLE');
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

test('移除 AI 后维护仅扫描非 AI 集合并保留远端历史配额', async () => {
  const db = memoryCloudDatabase();
  const historicalUsage = { _id: 'legacy_ai_quota', expiresAt: at - DAY, used: 2 };
  db.seed('linggan_ai_usage', [historicalUsage]);
  const scanned = [];
  const collection = db.collection;
  db.collection = function (name) { scanned.push(name); return collection.call(this, name); };
  const result = await createRetentionService({ db: createCloudRetentionDb(db), now: () => at }).run({ dryRun: false });
  assert.deepEqual(Object.keys(result.counts), ['shares', 'feedback', 'rates']);
  assert.deepEqual(new Set(scanned), new Set(['linggan_shares', 'linggan_feedback', 'linggan_rate_limits']));
  assert.deepEqual(db.rows('linggan_ai_usage'), [historicalUsage]);
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
