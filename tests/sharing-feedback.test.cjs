'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createFeedbackService, dayStart } = require('../server/feedback');
const { createCloudFeedbackDb } = require('../server/cloud-feedback-db');
const { createProtocol } = require('../server/protocol');
const { createRepository } = require('../server/repository');
const { memoryCloudDatabase } = require('./helpers/cloud-db.cjs');

function fixture() {
  let clock = Date.UTC(2026, 8, 24, 6, 0, 0);
  const db = memoryCloudDatabase();
  const service = createFeedbackService({ db: createCloudFeedbackDb({ db, now: () => clock }),
    now: () => clock, rateLimit: async () => true });
  return { db, service, setClock: (value) => { clock = value; }, now: () => clock };
}

test('反馈只归提交者，重复请求幂等且类别/状态不能由客户端越权指定', async () => {
  const f = fixture();
  const first = await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能' }, 'req_feedback_01');
  assert.equal(first.ok, true);
  assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能' }, 'req_feedback_01')).data.feedbackId, first.data.feedbackId);
  assert.equal((await f.service.createFeedback('owner', { category: 'bug', body: '使用时遇到了一个具体问题' }, 'req_feedback_01')).code, 'REQUEST_ID_REUSED');
  for (const field of ['status', 'accountKey', 'relatedShareId', 'reportDayKey']) {
    assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能', [field]: 'forged' }, 'req_feedback_02')).code, 'INVALID_PAYLOAD');
  }
  assert.equal((await f.service.createFeedback('owner', { category: 'share_report', body: '希望增加搜索和筛选功能' }, 'req_feedback_03')).code, 'INVALID_PAYLOAD');
  assert.equal((await f.service.listFeedback('reader', {})).data.items.length, 0);
  const owned = (await f.service.listFeedback('owner', {})).data.items[0];
  assert.equal(owned.status, 'submitted');
  assert.deepEqual(Object.keys(owned).sort(), ['body', 'category', 'createdAt', 'feedbackId', 'status', 'updatedAt']);
  const feedback = f.db.rows('linggan_feedback');
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].relatedShareId, null);
  assert.equal(feedback[0].reportDayKey, null);
});

test('反馈重试兼容旧普通反馈摘要，历史举报只读列出', async () => {
  const f = fixture();
  const body = '希望增加搜索和筛选功能';
  const historical = { _id: 'old_feedback', accountKey: 'owner', requestId: 'req_old_feedback',
    requestDigest: crypto.createHash('sha256').update(JSON.stringify(['idea', body, null])).digest('hex'),
    dedupeKey: 'f_old', category: 'idea', body, relatedShareId: null, reportDayKey: null,
    status: 'submitted', createdAt: f.now(), updatedAt: f.now(), closedAt: null };
  const report = { ...historical, _id: 'old_report', requestId: 'req_old_report', dedupeKey: 'r_old',
    category: 'share_report', relatedShareId: 'historical_share', reportDayKey: '2026-09-24', status: 'closed' };
  f.db.seed('linggan_feedback', [historical, report]);
  const replay = await f.service.createFeedback('owner', { category: 'idea', body: '  ' + body + '  ' }, historical.requestId);
  assert.equal(replay.data.feedbackId, historical._id);
  assert.equal(f.db.rows('linggan_feedback').length, 2);
  const listed = (await f.service.listFeedback('owner', {})).data.items;
  assert.equal(listed.find((x) => x.feedbackId === report._id).category, 'share_report');
  assert.equal(JSON.stringify(listed).includes('historical_share'), false);
  assert.deepEqual(f.db.rows('linggan_feedback'), [historical, report]);
});

test('反馈保存失败不伪报成功，重复到达恢复同一结果', async () => {
  const f = fixture();
  const db = createCloudFeedbackDb({ db: f.db, now: f.now });
  const broken = createFeedbackService({ db: { ...db, insertFeedback: async () => { throw Error('WRITE_FAILED'); } },
    now: f.now, rateLimit: async () => true });
  const payload = { category: 'idea', body: '希望增加搜索和筛选功能' };
  assert.equal((await broken.createFeedback('owner', payload, 'req_failure_01')).code, 'INTERNAL');
  assert.equal(f.db.rows('linggan_feedback').length, 0);
  const services = [f.service, createFeedbackService({ db, now: f.now, rateLimit: async () => true })];
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => services[i % 2].createFeedback('owner', payload, 'req_raced_001')));
  assert.ok(results.every((x) => x.ok));
  assert.equal(new Set(results.map((x) => x.data.feedbackId)).size, 1);
  assert.equal(f.db.rows('linggan_feedback').length, 1);
  assert.equal(f.db.rows('linggan_usage')[0].feedbackCount, 1);
});

test('反馈按北京时间日界限计数，账户间隔离', async () => {
  const f = fixture();
  const at = Date.UTC(2026, 8, 24, 15, 59, 59);
  f.setClock(at);
  const payload = { category: 'other', body: '希望增加搜索和筛选功能' };
  for (let i = 0; i < 5; i++) assert.equal((await f.service.createFeedback('owner', payload, 'req_daily_00' + i)).ok, true);
  assert.equal((await f.service.createFeedback('owner', payload, 'req_daily_max')).code, 'FEEDBACK_LIMIT');
  assert.equal((await f.service.createFeedback('other', payload, 'req_other_001')).ok, true);
  f.setClock(at + 1000);
  assert.equal(dayStart(f.now()), Date.UTC(2026, 8, 24, 16));
  assert.equal((await f.service.createFeedback('owner', payload, 'req_next_day')).ok, true);
});

test('反馈列表稳定分页且拒绝越权或非法参数', async () => {
  const f = fixture();
  f.db.seed('linggan_feedback', Array.from({ length: 21 }, (_, i) => ({ _id: 'f_' + String(i).padStart(2, '0'),
    accountKey: 'owner', category: 'idea', body: '历史反馈正文', status: 'submitted', createdAt: i, updatedAt: i })));
  const first = await f.service.listFeedback('owner', {});
  assert.equal(first.data.items.length, 20);
  assert.equal(first.data.nextBefore, 'f_01');
  const second = await f.service.listFeedback('owner', { before: first.data.nextBefore });
  assert.deepEqual(second.data.items.map((x) => x.feedbackId), ['f_00']);
  assert.equal(second.data.nextBefore, null);
  for (const payload of [null, [], { before: 1 }, { before: 'x'.repeat(81) }, { accountKey: 'other' }]) {
    assert.equal((await f.service.listFeedback('owner', payload)).code, 'INVALID_PAYLOAD');
  }
  for (const [body, requestId] of [['短意见', 'req_valid_id'], ['字'.repeat(1001), 'req_valid_id'], ['字'.repeat(10), 'bad']]) {
    assert.equal((await f.service.createFeedback('owner', { category: 'idea', body }, requestId)).code, 'INVALID_PAYLOAD');
  }
});

test('反馈协议保持可信身份且列表不会命中旧请求缓存', async () => {
  const f = fixture();
  const cache = new Map();
  const protocol = createProtocol({ repository: {}, feedback: f.service, now: f.now,
    requestCache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) } });
  const event = { action: 'feedback.create', payload: { category: 'idea', body: '希望增加搜索和筛选功能' }, requestId: 'req_protocol_01' };
  assert.equal((await protocol.handle(null, { ...event, accountKey: 'owner' })).code, 'UNAUTHENTICATED');
  assert.equal((await protocol.handle({ accountKey: 'owner', sourceAllowed: false }, event)).code, 'FORBIDDEN_SOURCE');
  const saved = await protocol.handle({ accountKey: 'owner' }, event);
  assert.equal(saved.ok, true);
  const list = { action: 'feedback.listMine', payload: {}, requestId: 'req_list_001' };
  assert.equal((await protocol.handle({ accountKey: 'owner' }, list)).data.items[0].status, 'submitted');
  await f.db.collection('linggan_feedback').where({ _id: saved.data.feedbackId }).update({ data: { status: 'closed' } });
  assert.equal((await protocol.handle({ accountKey: 'owner' }, list)).data.items[0].status, 'closed');
  assert.equal(cache.size, 0);
});

test('旧文字分享和举报接口统一拒绝且不访问反馈或账户', async () => {
  const protocol = createProtocol({ repository: new Proxy({}, { get() { assert.fail('不得访问账户'); } }),
    feedback: new Proxy({}, { get() { assert.fail('不得访问反馈'); } }), now: Date.now });
  for (const action of ['share.create', 'share.get', 'share.listMine', 'share.revoke', 'share.qr', 'feedback.reportShare']) {
    assert.equal((await protocol.handle({ accountKey: 'owner' }, { action, payload: {}, requestId: 'req_removed_01' })).code, 'INVALID_ACTION');
  }
  assert.deepEqual(protocol.ACTIONS, ['snapshot.pull', 'snapshot.push', 'inspiration.delete', 'photo.delete', 'feedback.create', 'feedback.listMine']);
});

test('源删除不依赖已移除分享服务，账户写入仍按版本确认', async () => {
  let written;
  const doc = { accountKey: 'owner', generation: 1, version: 2,
    inspirations: [{ id: 'idea_1', text: '文字', photos: [] }] };
  const repository = createRepository({ db: { get: async () => doc,
    compareAndSwap: async (key, version, next) => { assert.equal(key, 'owner'); assert.equal(version, 2); written = next; return true; } },
    now: () => 123, beforeRemove: () => { assert.fail('不再调用历史分享钩子'); } });
  assert.equal((await repository.remove('owner', { inspirationId: 'idea_1', generation: 1, baseVersion: 2 })).ok, true);
  assert.deepEqual(written.inspirations, []);
  assert.equal(written.version, 3);
});
