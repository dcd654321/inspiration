'use strict';
// 灵感级汇总编排的单元测试。
// 对应 ai-summarize/spec.md 的「把多个灵感汇总成一个」与「覆盖与另存由用户选择」两节。
//
// 这一节此前在覆盖率表里是**一条真实缺口**——领域层只有 markMerged / unmerge 两个原语，
// 没有编排函数。这些用例是补上它之后写的。

const test = require('node:test');
const assert = require('node:assert');

const { mergeInspirations } = require('../miniprogram/core/merge');
const inspiration = require('../miniprogram/core/inspiration');
const { LIMITS } = require('../miniprogram/core/limits');
const { ERROR_CODES, ValidationError } = require('../miniprogram/core/errors');

const NOW = 1758500000000;

function hasCode(code) {
  return (err) => err instanceof ValidationError && err.code === code;
}

function threeInspirations() {
  return [
    inspiration.createInspiration({ text: '做一个记账小程序', id: 'insp_a', now: NOW }),
    inspiration.createInspiration({ text: '记账要能导出 CSV', id: 'insp_b', now: NOW + 1000 }),
    inspiration.createInspiration({ text: '界面一屏能看完一个月', id: 'insp_c', now: NOW + 2000 })
  ];
}

function byId(list, id) {
  return list.filter((item) => item.id === id)[0];
}

// ---------------------------------------------------------------- 覆盖

test('覆盖：汇总结果成为目标的原文，旧原文进历史', () => {
  const merged = mergeInspirations(threeInspirations(), {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'overwrite',
    targetId: 'insp_a',
    historyId: 'tex_1',
    summaryText: '做一个能导出 CSV 的记账小程序',
    now: NOW + 3000
  });

  const target = byId(merged, 'insp_a');
  assert.strictEqual(target.text, '做一个能导出 CSV 的记账小程序');
  assert.strictEqual(target.textHistory.length, 1, '旧原文必须进历史，不能悄悄抹掉');
  assert.strictEqual(target.textHistory[0].text, '做一个记账小程序');
  assert.strictEqual(target.textHistory[0].id, 'tex_1');
});

test('覆盖：其余来源被标记为已合并，指向目标', () => {
  const merged = mergeInspirations(threeInspirations(), {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'overwrite',
    targetId: 'insp_a',
    historyId: 'tex_1',
    summaryText: '汇总结果',
    now: NOW + 3000
  });

  assert.strictEqual(byId(merged, 'insp_b').mergedInto, 'insp_a');
  assert.strictEqual(byId(merged, 'insp_a').mergedInto, null, '目标不该被标为合并进自己');
});

test('覆盖：目标必须是被勾选的之一', () => {
  assert.throws(
    () => mergeInspirations(threeInspirations(), {
      sourceIds: ['insp_a', 'insp_b'],
      mode: 'overwrite',
      targetId: 'insp_c',            // 没被勾选
      historyId: 'tex_1',
      summaryText: '汇总结果',
      now: NOW + 3000
    }),
    hasCode(ERROR_CODES.MERGE_SELF)
  );
});

// ---------------------------------------------------------------- 另存

test('另存：汇总结果成为一条新灵感，来源全部收起', () => {
  const merged = mergeInspirations(threeInspirations(), {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'append',
    newId: 'insp_new',
    summaryText: '做一个能导出 CSV 的记账小程序',
    now: NOW + 3000
  });

  const created = byId(merged, 'insp_new');
  assert.strictEqual(created.text, '做一个能导出 CSV 的记账小程序');
  assert.strictEqual(created.textHistory.length, 0);

  assert.strictEqual(byId(merged, 'insp_a').mergedInto, 'insp_new');
  assert.strictEqual(byId(merged, 'insp_b').mergedInto, 'insp_new');
  assert.strictEqual(byId(merged, 'insp_a').text, '做一个记账小程序', '另存不该改动原文');
});

test('另存：新 id 不能和来源撞', () => {
  assert.throws(
    () => mergeInspirations(threeInspirations(), {
      sourceIds: ['insp_a', 'insp_b'],
      mode: 'append',
      newId: 'insp_a',
      summaryText: '汇总结果',
      now: NOW + 3000
    }),
    hasCode(ERROR_CODES.MERGE_SELF)
  );
});

// ---------------------------------------------------------------- 共同约束

test('未勾选的灵感完全不受影响', () => {
  const before = threeInspirations();
  const merged = mergeInspirations(before, {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'overwrite',
    targetId: 'insp_a',
    historyId: 'tex_1',
    summaryText: '汇总结果',
    now: NOW + 3000
  });

  assert.deepStrictEqual(byId(merged, 'insp_c'), byId(before, 'insp_c'));
});

test('少于两个来源被拒绝', () => {
  assert.throws(
    () => mergeInspirations(threeInspirations(), {
      sourceIds: ['insp_a'],
      mode: 'append',
      newId: 'insp_new',
      summaryText: '汇总结果',
      now: NOW + 3000
    }),
    hasCode(ERROR_CODES.LIMIT_EXCEEDED)
  );
});

test('写入方式必须显式给出，没有默认值', () => {
  const payload = {
    sourceIds: ['insp_a', 'insp_b'],
    newId: 'insp_new',
    summaryText: '汇总结果',
    now: NOW + 3000
  };

  assert.throws(() => mergeInspirations(threeInspirations(), payload), hasCode(ERROR_CODES.INVALID_MERGE_MODE));
  assert.throws(
    () => mergeInspirations(threeInspirations(), Object.assign({}, payload, { mode: 'replace' })),
    hasCode(ERROR_CODES.INVALID_MERGE_MODE)
  );
});

test('来源里有不存在或被合并过的，整批拒绝', () => {
  const merged = mergeInspirations(threeInspirations(), {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'append',
    newId: 'insp_new',
    summaryText: '汇总结果',
    now: NOW + 3000
  });

  assert.throws(
    () => mergeInspirations(merged, {
      sourceIds: ['insp_a', 'insp_c'],
      mode: 'append',
      newId: 'insp_new2',
      summaryText: '再汇总一次',
      now: NOW + 4000
    }),
    hasCode(ERROR_CODES.ALREADY_MERGED)
  );

  assert.throws(
    () => mergeInspirations(threeInspirations(), {
      sourceIds: ['insp_a', 'insp_nope'],
      mode: 'append',
      newId: 'insp_new',
      summaryText: '汇总结果',
      now: NOW + 3000
    }),
    hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND)
  );
});

test('汇总结果为空或超长被拒绝', () => {
  const payload = { sourceIds: ['insp_a', 'insp_b'], mode: 'append', newId: 'insp_new', now: NOW + 3000 };

  assert.throws(
    () => mergeInspirations(threeInspirations(), Object.assign({}, payload, { summaryText: '  ' })),
    hasCode(ERROR_CODES.EMPTY_TEXT)
  );
  assert.throws(
    () => mergeInspirations(threeInspirations(), Object.assign({}, payload, {
      summaryText: '啊'.repeat(LIMITS.textMaxLength + 1)
    })),
    hasCode(ERROR_CODES.TEXT_TOO_LONG)
  );
});

test('失败不留痕：被拒绝时原数组一个字节都没变', () => {
  const before = threeInspirations();
  const snapshot = JSON.parse(JSON.stringify(before));

  assert.throws(
    () => mergeInspirations(before, {
      sourceIds: ['insp_a', 'insp_nope'],
      mode: 'append',
      newId: 'insp_new',
      summaryText: '汇总结果',
      now: NOW + 3000
    })
  );

  assert.deepStrictEqual(JSON.parse(JSON.stringify(before)), snapshot, '失败却改动了输入数组');
});

test('返回的数组按更新时间倒序', () => {
  const merged = mergeInspirations(threeInspirations(), {
    sourceIds: ['insp_a', 'insp_b'],
    mode: 'overwrite',
    targetId: 'insp_a',
    historyId: 'tex_1',
    summaryText: '汇总结果',
    now: NOW + 3000
  });

  assert.strictEqual(merged[0].id, 'insp_a', '刚改过的那条应排在最前');
});

test('覆盖时缺 historyId 被拒绝——改写原文必须留历史', () => {
  assert.throws(
    () => mergeInspirations(threeInspirations(), {
      sourceIds: ['insp_a', 'insp_b'],
      mode: 'overwrite',
      targetId: 'insp_a',
      summaryText: '汇总结果',
      now: NOW + 3000
    }),
    hasCode(ERROR_CODES.EMPTY_HISTORY_ID)
  );
});

test('非数组输入不抛错，按空列表处理', () => {
  assert.throws(
    () => mergeInspirations(null, {
      sourceIds: ['insp_a', 'insp_b'], mode: 'append', newId: 'insp_new', summaryText: 'x', now: NOW
    }),
    hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND)
  );
});
