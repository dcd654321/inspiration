'use strict';
// 未提交补充的会话内草稿。
//
// 对应 openspec/changes/add-inspiration-mvp/specs/inspiration-capture/spec.md
// 的「未提交的补充不因切页丢失」一节。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { createCaptureDrafts } = require('../miniprogram/services/capture-drafts');

test('切页后草稿仍在——同一会话内共用一个实例', () => {
  const drafts = createCaptureDrafts();
  drafts.set('insp_a', '写到一半的想法');

  // 「离开详情页再回来」在实现上就是拿到同一个 drafts 实例，中间没有任何持久化往返
  assert.strictEqual(drafts.get('insp_a'), '写到一半的想法');
});

test('提交后草稿清除', () => {
  const drafts = createCaptureDrafts();
  drafts.set('insp_a', '内容');

  drafts.clear('insp_a');

  assert.strictEqual(drafts.get('insp_a'), '');
  assert.strictEqual(drafts.has('insp_a'), false);
});

test('会话结束后不承诺保留——新实例读不到旧草稿', () => {
  const first = createCaptureDrafts();
  first.set('insp_a', '上个会话留下的内容');

  const second = createCaptureDrafts();   // 模拟小程序被关闭后重新打开

  assert.strictEqual(second.get('insp_a'), '', '草稿不该跨会话存在——规范没有承诺，也不该被误当成内容');
  assert.strictEqual(second.has('insp_a'), false);
});

test('不同灵感的草稿互不干扰', () => {
  const drafts = createCaptureDrafts();
  drafts.set('insp_a', '甲的想法');
  drafts.set('insp_b', '乙的想法');

  assert.strictEqual(drafts.get('insp_a'), '甲的想法');
  assert.strictEqual(drafts.get('insp_b'), '乙的想法');

  drafts.clear('insp_a');
  assert.strictEqual(drafts.get('insp_a'), '');
  assert.strictEqual(drafts.get('insp_b'), '乙的想法', '清一条不该影响另一条');
});

test('空输入等同没有草稿', () => {
  const drafts = createCaptureDrafts();
  drafts.set('insp_a', '写了点东西');

  drafts.set('insp_a', '');
  assert.strictEqual(drafts.has('insp_a'), false, '清空输入后不该留下一条空草稿');

  drafts.set('insp_a', '再写点');
  drafts.set('insp_a', '   ');
  assert.strictEqual(drafts.has('insp_a'), true, '纯空白是用户真的敲了东西，不应被当成清空');
});

test('读一条从没写过的草稿返回空串，不是 undefined', () => {
  const drafts = createCaptureDrafts();
  assert.strictEqual(drafts.get('insp_never'), '');
});

test('草稿模块不接触任何持久化存储', () => {
  const src = fs.readFileSync(require.resolve('../miniprogram/services/capture-drafts'), 'utf8');

  // 规范写明：未提交的内容不是数据，只是草稿。一旦有人给它加上持久化，
  // 「会话结束后不承诺保留」这条就不再成立——那会让草稿悄悄变成内容。
  for (const forbidden of ['set' + 'Storage', 'wx.', 'localStorage']) {
    assert.strictEqual(src.indexOf(forbidden), -1, `草稿模块不该碰存储，却出现了「${forbidden}」`);
  }
});
