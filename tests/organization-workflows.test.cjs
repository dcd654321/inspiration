'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createStore } = require('../qa/legacy/store');
const { organize } = require('../miniprogram/services/organization');
const { searchInspirations } = require('../miniprogram/services/discovery');
const accountKey = 'a'.repeat(32), NOW = 1790416800000;
const item = (id = 'a') => core.createInspiration({ text: '记录工具的一个想法', id, now: NOW });

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
