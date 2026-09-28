'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUsageMetrics } = require('../miniprogram/services/usage-metrics');
test('使用统计默认关闭，白名单聚合不含内容，关闭清空且账户隔离', () => {
  const data = new Map(); let time = 1790416800000;
  const storage = { get: (key) => data.get(key), set: (key, value) => data.set(key, structuredClone(value)) };
  const a = createUsageMetrics({ storage, cacheScope: 'a'.repeat(32), now: () => time });
  const b = createUsageMetrics({ storage, cacheScope: 'b'.repeat(32), now: () => time });
  assert.equal(a.track('record_saved'), false); assert.equal(data.size, 0);
  a.setEnabled(true); assert.equal(a.track('record_saved', { text: 'private', id: 'secret' }), true);
  assert.equal(a.track('private'), false); assert.equal(b.read().enabled, false);
  const report = a.report(); assert.match(report, /record_saved/); assert.doesNotMatch(report, /private|secret|aaaaaaaa/);
  time += 30 * 86400000; assert.deepEqual(a.read().days, {});
  a.track('output_copied'); a.setEnabled(false); assert.deepEqual(a.read().days, {});
  a.setEnabled(true); assert.deepEqual(a.read().days, {});
  storage.set = () => { throw Error('FULL'); }; assert.equal(a.track('record_saved'), false); assert.throws(() => a.setEnabled(false));
});
