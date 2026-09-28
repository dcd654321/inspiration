'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryCloudDatabase } = require('./helpers/cloud-db.cjs');
const { createCloudAiQuota } = require('../server/ai-quota');
const { createAiHandler, createCloudModel } = require('../server/ai-service');
const contract = require('../miniprogram/core/ai-contract');
const core = require('../miniprogram/core/inspiration');
const { acceptDraft, acceptSummary } = require('../miniprogram/services/ai-workflow');
const { createStore } = require('../miniprogram/services/store');
const { organize } = require('../miniprogram/services/organization');
const { searchInspirations } = require('../miniprogram/services/discovery');
const accountKey = 'a'.repeat(32), NOW = 1790416800000;
const draft = { points: ['划清内容范围'], nextSteps: ['编写一个草案'], risks: ['需求尚待确认'] };
const event = (id = 'req_a') => ({ action: 'expand', requestId: id, payload: { text: '设计一个简单的记录工具', supplements: [] } });
const item = (id = 'a') => core.createInspiration({ text: '记录工具的一个想法', id, now: NOW });

test('AI 原子配额按账户隔离，去重退款与自然日切换不超发', async () => {
  const db = memoryCloudDatabase(); let now = NOW;
  const quota = createCloudAiQuota({ db, now: () => now, dailyLimit: 2 });
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) => quota.reserve(accountKey, 'r' + i, 'digest')));
  assert.equal(attempts.filter((x) => x.ok).length, 2);
  assert.equal((await quota.reserve(accountKey, 'r0', 'digest')).code, 'AI_REQUEST_REPLAY');
  assert.equal((await quota.reserve(accountKey, 'r0', 'different')).code, 'REQUEST_ID_REUSED');
  await quota.finish(attempts[0], true); await quota.finish(attempts[0], true);
  assert.equal(db.rows('linggan_ai_usage')[0].used, 1);
  assert.equal((await quota.reserve(accountKey, 'new', 'digest')).ok, true);
  assert.equal((await quota.reserve('b'.repeat(32), 'r0', 'digest')).ok, true);
  now += 86400000;
  assert.equal((await quota.reserve(accountKey, 'r0', 'digest')).ok, true);
  assert.equal(JSON.stringify(db.rows('linggan_ai_usage')).includes(accountKey), false);
});

test('AI 服务端拒绝非法输入与身份，模型仅接收白名单文字并双向审核', async () => {
  const db = memoryCloudDatabase(); const calls = [], checks = [];
  const handler = createAiHandler({ enabled: true, contract, quota: createCloudAiQuota({ db }),
    generate: async (action, payload) => { calls.push(payload); return draft; }, moderate: async (text) => { checks.push(text); return true; } });
  assert.equal((await handler({}, event())).code, 'UNAUTHENTICATED');
  assert.equal((await handler({ accountKey }, Object.assign(event(), { accountKey: 'evil' }))).code, 'IDENTITY_FIELD_REJECTED');
  const short = event(); short.payload.text = '短';
  assert.equal((await handler({ accountKey }, short)).code, 'INVALID_PAYLOAD');
  const request = event(); request.payload.photos = ['private']; request.payload.textHistory = ['old'];
  assert.equal((await handler({ accountKey }, request)).ok, true);
  assert.deepEqual(calls, [{ text: request.payload.text, supplements: [] }]);
  assert.equal(checks.length, 2);
  assert.equal((await handler({ accountKey }, request)).code, 'AI_REQUEST_REPLAY');
  assert.equal(calls.length, 1);
});

test('AI 不安全输出与审核故障不展示，明确失败退款而超时仍占额', async () => {
  for (const fault of ['unsafe', 'contract', 'moderation', 'timeout']) {
    const db = memoryCloudDatabase();
    const handler = createAiHandler({ enabled: true, contract, quota: createCloudAiQuota({ db }), timeoutMs: 5,
      moderate: async () => { if (fault === 'moderation') throw Error('DOWN'); return true; },
      generate: async () => fault === 'timeout' ? new Promise(() => {}) : fault === 'unsafe' ? Object.assign({}, draft, { risks: ['用药剂量'] }) : fault === 'contract' ? {} : draft });
    const result = await handler({ accountKey }, event());
    assert.equal(result.ok, false); assert.equal('data' in result, false);
    assert.equal(db.rows('linggan_ai_usage')[0].used, fault === 'timeout' ? 1 : 0);
  }
});

test('CloudBase 适配器使用配置模型且严格解析 JSON，不包含图片和工具调用', async () => {
  let request;
  const app = { ai: () => ({ createModel: (name) => { assert.equal(name, 'cloudbase'); return { generateText: async (data) => { request = data; return { text: JSON.stringify(draft) }; } }; } }) };
  const generate = createCloudModel({ app, modelName: 'configured-model' });
  assert.deepEqual(await generate('expand', event().payload), draft);
  assert.equal(request.model, 'configured-model'); assert.equal(request.messages.length, 2);
  await assert.rejects(createCloudModel({ app, modelName: '' })('expand', {}));
});

test('AI 逐条采纳只写选中内容，汇总另存保留来源并记录可追溯 ID', () => {
  let sequence = 0; const options = { newId: (p) => p + '_' + ++sequence, now: NOW + 1 };
  const original = item();
  const [accepted] = acceptDraft(original, [{ selected: true, content: '采纳内容' }, { selected: false, content: '丢弃内容' }], options);
  assert.equal(original.supplements.length, 0); assert.equal(accepted.supplements.length, 1);
  assert.equal(accepted.supplements[0].source, 'ai'); assert.equal(accepted.text, original.text);
  assert.throws(() => acceptDraft(original, [{ selected: true, content: '' }], options));
  const inputs = [original, item('b')];
  const changes = acceptSummary(inputs, Object.assign({}, options, { scope: 'inspirations', sourceIds: ['a', 'b'], mode: 'append', text: '汇总文字' }));
  assert.equal(changes.length, 1); assert.equal(changes[0].source, 'ai'); assert.deepEqual(changes[0].summarySources, ['a', 'b']);
  assert.equal(original.mergedInto, null);
  let supplemented = core.appendSupplement(original, { content: '补充甲', id: 'sa', now: NOW });
  supplemented = core.appendSupplement(supplemented, { content: '补充乙', id: 'sb', now: NOW });
  const [summary] = acceptSummary([supplemented], Object.assign({}, options, { scope: 'supplements', id: 'a', sourceIds: ['sa', 'sb'], mode: 'append', text: '长'.repeat(1500) }));
  assert.deepEqual(summary.supplements[2].sourceIds, ['sa', 'sb']);
  assert.equal(summary.supplements[0].mergedInto, null);
});

test('批量采纳以一条队列发送，写入失败不留半批快照', async () => {
  let value, fail = false; const calls = [];
  const storage = { get: () => structuredClone(value), set: (_, next) => { if (fail) throw Error('FULL'); value = structuredClone(next); } };
  const store = createStore({ storage, now: () => NOW, cacheScope: accountKey, remoteSnapshot: { cacheScope: accountKey, version: 0, generation: 1, inspirations: [] },
    transport: { send: async (action, payload) => { calls.push(payload); return { ok: true, data: { version: 1 } }; } } });
  fail = true; assert.equal((await store.saveInspirations([item('a'), item('b')])).ok, false);
  assert.equal(store.readSnapshot().inspirations.length, 0); assert.equal(calls.length, 0);
  fail = false; assert.equal((await store.saveInspirations([item('a'), item('b')])).synced, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].upserts.length, 2);
});

test('标签阶段校验与搜索兼容旧记录，已合并入口不混入普通结果', () => {
  const original = item();
  const updated = organize(original, { tags: [' 写作 '], stage: 'ready', now: NOW + 1 });
  assert.deepEqual(updated.tags, ['写作']); assert.deepEqual(original.tags, []);
  assert.equal(searchInspirations([updated], { query: '写作', stage: 'ready' }).length, 1);
  assert.equal(searchInspirations([updated], { stage: 'seed' }).length, 0);
  assert.throws(() => organize(original, { tags: ['重复', '重复'], stage: 'seed', now: NOW }));
  const merged = Object.assign({}, updated, { mergedInto: 'another' });
  assert.equal(searchInspirations([merged], {}).length, 0);
  assert.equal(searchInspirations([merged], { filter: 'merged' }).length, 1);
});

test('AI 页面预览不自动保存，拒绝变化来源且离开后丢弃迟到结果', async () => {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx }; let definition, resolve, saves = 0;
  let current = item();
  const store = { getInspiration: () => current, readSnapshot: () => ({ inspirations: [current] }), saveInspirations: async () => { saves++; return { ok: true, synced: true }; } };
  const app = { globalData: { store, sessionEpoch: 1 }, ensureReady: async () => store };
  const target = require.resolve('../miniprogram/pages/ai-workbench/index');
  try {
    global.Page = (value) => { definition = value; }; global.getApp = () => app; global.wx = {};
    delete require.cache[target]; require(target);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(data) { Object.assign(this.data, data); } });
    await page.onLoad({ id: 'a', scope: 'expand' }); page.data.enabled = true;
    page.ai = { expand: async () => ({ ok: true, value: draft }) };
    await page.onGenerate(); assert.equal(page.data.preview, true); assert.equal(saves, 0);
    current = core.updateText(current, { text: '来源文字发生了变化', historyId: 'h', now: NOW + 1 });
    await page.onAccept(); assert.equal(saves, 0); assert.match(page.data.error, /来源内容已变化/);
    page.onDiscard(); assert.equal(page.data.entries.length, 0);
    page.ai = { expand: () => new Promise((r) => { resolve = r; }) };
    const pending = page.onGenerate(); page.onUnload(); resolve({ ok: true, value: draft }); await pending;
    assert.equal(page.data.entries.length, 0); assert.equal(saves, 0);
  } finally { delete require.cache[target]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});
