'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('AI 云函数声明文本审核权限且审核分块不拆 Unicode 字符', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../cloudfunctions/linggan_ai/config.json'), 'utf8'));
  assert.deepEqual(config.permissions.openapi, ['security.msgSecCheck']);
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/linggan_ai/index.js'), 'utf8');
  assert.match(source, /Array\.from\(text\)/);
  assert.match(source, /offset \+= 600/);
  const chars = Array.from('文😀'.repeat(1000));
  for (let offset = 0; offset < chars.length; offset += 600) {
    const chunk = chars.slice(offset, offset + 600).join('');
    assert.ok(Buffer.byteLength(chunk, 'utf8') <= 2400);
    assert.equal(chunk.includes('\ufffd'), false);
  }
});
