'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { validRecord } = require('../server/record-validation');
const item = () => core.createInspiration({ id: 'record_a', text: '一条普通记录', now: 1 });

test('服务端记录结构拒绝超长、重复标签、非法阶段及合并环', () => {
  const original = item();
  assert.equal(validRecord(original), true);
  for (const patch of [{ text: '字'.repeat(2001) }, { updatedAt: -1 }, { stage: 'unknown' }, { tags: ['同名', '同名'] }, { summarySources: ['a', 'a'] }, { textHistory: [{ id: 'h', text: '', replacedAt: 1 }] }]) {
    assert.equal(validRecord(Object.assign({}, original, patch)), false);
  }
  let withSupplements = core.appendSupplement(original, { id: 'sa', content: '补充甲', now: 2 });
  withSupplements = core.appendSupplement(withSupplements, { id: 'sb', content: '补充乙', now: 3 });
  const invalid = structuredClone(withSupplements);
  invalid.supplements[0].mergedInto = 'sb'; invalid.supplements[1].mergedInto = 'sa';
  assert.equal(validRecord(invalid), false);
  invalid.supplements[1].mergedInto = null;
  assert.equal(validRecord(invalid), true);
  invalid.supplements[0].mergedInto = 'missing';
  assert.equal(validRecord(invalid), false);
});
