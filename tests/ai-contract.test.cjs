'use strict';
// AI 输出契约的单元测试。
// 对应用 openspec/changes/add-inspiration-mvp/specs/ai-expansion/spec.md
// 的「输出校验与内容安全」一节：四类非法输入都必须被拒绝。

const test = require('node:test');
const assert = require('node:assert');

const {
  validateDraft,
  parseDraft,
  checkSafety,
  isTooShortToExpand,
  SAFETY_RULES
} = require('../miniprogram/core/ai-contract');
const { LIMITS } = require('../miniprogram/core/limits');
const { ERROR_CODES, ValidationError } = require('../miniprogram/core/errors');

function draft(overrides) {
  return Object.assign({
    points: ['用微信云开发存数据'],
    nextSteps: ['先画数据模型'],
    risks: ['云函数冷启动可能变慢']
  }, overrides || {});
}

// ---------------------------------------------------------------- 合法草案

test('合法草案通过校验并返回规范化结果', () => {
  const result = validateDraft(draft());

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value.points, ['用微信云开发存数据']);
  assert.deepStrictEqual(result.value.nextSteps, ['先画数据模型']);
  assert.deepStrictEqual(result.value.risks, ['云函数冷启动可能变慢']);
  assert.ok(Object.isFrozen(result.value));
});

test('条目首尾空白被规范化，不是改写内容', () => {
  const result = validateDraft(draft({ points: ['  前后有空格  '] }));

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.points[0], '前后有空格');
});

test('恰好达到条目数与长度上限时通过', () => {
  const many = [];
  for (let i = 0; i < LIMITS.draftSectionMaxItems; i += 1) many.push('要点 ' + i);
  assert.strictEqual(validateDraft(draft({ points: many })).ok, true);

  const atLimit = '啊'.repeat(LIMITS.draftItemMaxLength);
  assert.strictEqual(validateDraft(draft({ points: [atLimit] })).ok, true);
});

// ---------------------------------------------------------------- 结构非法

test('缺少任一必需分区即拒绝', () => {
  for (const key of ['points', 'nextSteps', 'risks']) {
    const incomplete = draft();
    delete incomplete[key];
    const result = validateDraft(incomplete);

    assert.strictEqual(result.ok, false, `缺少 ${key} 时应拒绝`);
    assert.strictEqual(result.code, ERROR_CODES.MISSING_SECTION);
    assert.strictEqual(result.field, key);
  }
});

test('分区不是数组即拒绝', () => {
  const result = validateDraft(draft({ points: '这是一句话而不是数组' }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.INVALID_TYPE);
  assert.strictEqual(result.field, 'points');
});

test('分区内混入非字符串即拒绝', () => {
  const result = validateDraft(draft({ nextSteps: ['正常一项', { text: '对象' }] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.INVALID_TYPE);
  assert.strictEqual(result.field, 'nextSteps[1]');
});

test('输入根本不是对象即拒绝', () => {
  for (const bad of [null, undefined, '字符串', 42, ['数组']]) {
    const result = validateDraft(bad);
    assert.strictEqual(result.ok, false, `${JSON.stringify(bad)} 应被拒绝`);
  }
});

// ---------------------------------------------------------------- 边界非法

test('条目数少于下限即拒绝', () => {
  const result = validateDraft(draft({ risks: [] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.TOO_FEW_ITEMS);
  assert.strictEqual(result.field, 'risks');
});

test('条目数超出上限即拒绝', () => {
  const tooMany = [];
  for (let i = 0; i <= LIMITS.draftSectionMaxItems; i += 1) tooMany.push('要点 ' + i);
  const result = validateDraft(draft({ points: tooMany }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.TOO_MANY_ITEMS);
  assert.strictEqual(result.field, 'points');
});

test('空白条目即拒绝', () => {
  const result = validateDraft(draft({ points: ['有内容', '   '] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.EMPTY_ITEM);
  assert.strictEqual(result.field, 'points[1]');
});

test('条目超长即拒绝', () => {
  const tooLong = '啊'.repeat(LIMITS.draftItemMaxLength + 1);
  const result = validateDraft(draft({ nextSteps: [tooLong] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.ITEM_TOO_LONG);
  assert.strictEqual(result.field, 'nextSteps[0]');
});

// ---------------------------------------------------------------- 内容安全

test('命中医疗用药规则即拒绝', () => {
  const result = validateDraft(draft({ nextSteps: ['按处方调整用药剂量'] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.UNSAFE_CONTENT);
  assert.strictEqual(result.rule, 'MEDICAL');
  assert.strictEqual(result.field, 'nextSteps[0]');
});

test('命中极端行为规则即拒绝', () => {
  const result = validateDraft(draft({ risks: ['可能让人产生轻生念头'] }));

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, ERROR_CODES.UNSAFE_CONTENT);
  assert.strictEqual(result.rule, 'EXTREME_BEHAVIOR');
});

test('命中外部链接规则即拒绝', () => {
  const cases = ['参考 https://example.com/doc', '去看 www.example.com', '源码在 github.com'];
  for (const item of cases) {
    const result = validateDraft(draft({ points: [item] }));
    assert.strictEqual(result.ok, false, `${item} 应被拒绝`);
    assert.strictEqual(result.rule, 'EXTERNAL_LINK');
  }
});

test('安全规则不误伤含「链接」等词但无链接的普通内容', () => {
  const benign = [
    '把页面里的链接逻辑抽成单独模块',
    '入口页的跳转关系需要梳理',
    '首页的标签栏要能记住上次位置',
    '做一个记账小程序，支持导出 CSV'
  ];
  for (const item of benign) {
    const result = validateDraft(draft({ points: [item] }));
    assert.strictEqual(result.ok, true, `「${item}」被误伤了：${result.rule || result.code}`);
  }
});

test('内容安全可单独调用，返回命中的规则名', () => {
  assert.deepStrictEqual(checkSafety('正常的一句话'), { ok: true });
  assert.deepStrictEqual(checkSafety('按处方吃药'), { ok: false, rule: 'MEDICAL' });
  assert.deepStrictEqual(checkSafety(''), { ok: true });
  assert.deepStrictEqual(checkSafety(null), { ok: true });
});

test('安全规则清单可被审阅，每条都有名称与正则', () => {
  assert.ok(SAFETY_RULES.length > 0);
  for (const rule of SAFETY_RULES) {
    assert.strictEqual(typeof rule.name, 'string');
    assert.ok(rule.pattern instanceof RegExp, `${rule.name} 缺少正则`);
  }
});

// ---------------------------------------------------------------- 抛错版与短文判定

test('抛错版在非法输入时抛 ValidationError', () => {
  assert.deepStrictEqual(parseDraft(draft()).points, ['用微信云开发存数据']);
  assert.throws(
    () => parseDraft(draft({ risks: [] })),
    (err) => err instanceof ValidationError && err.code === ERROR_CODES.TOO_FEW_ITEMS
  );
});

test('正文过短时不请求扩展', () => {
  assert.strictEqual(isTooShortToExpand('记账'), true);
  assert.strictEqual(isTooShortToExpand('   '), true);
  assert.strictEqual(isTooShortToExpand(''), true);
  assert.strictEqual(isTooShortToExpand(null), true);
  assert.strictEqual(isTooShortToExpand('做一个能导出的记账小程序'), false);
});
