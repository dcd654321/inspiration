'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('小程序启用组件按需注入', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.equal(app.lazyCodeLoading, 'requiredComponents');
});
