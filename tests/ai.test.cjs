'use strict';
// AI 调用与降级的单元测试。
// 对应 ai-expansion/spec.md「输出校验与内容安全」「AI 不可用时的降级」与
// ai-summarize/spec.md「汇总失败与 AI 不可用时的降级」，以及 tasks.md 5.2—5.4。
//
// 四条降级路径（未启用、超时、额度耗尽、校验失败）全部在这里断言——
// 它们在真机上很难稳定复现，而 AI 不可用时**基础功能必须完全可用**是规范硬要求。

const test = require('node:test');
const assert = require('node:assert');

const { createAiService, CODE } = require('../miniprogram/services/ai');
const { LIMITS } = require('../miniprogram/core/limits');

const GOOD_DRAFT = {
  points: ['用微信云开发存数据'],
  nextSteps: ['先画数据模型'],
  risks: ['云函数冷启动可能变慢']
};

function createFakeQuota(initial) {
  return {
    remaining: initial === undefined ? 3 : initial,
    refunds: 0,
    tryConsume() {
      if (this.remaining <= 0) return false;
      this.remaining -= 1;
      return true;
    },
    refund() {
      this.remaining += 1;
      this.refunds += 1;
    }
  };
}

function service(overrides) {
  const opts = Object.assign({
    enabled: true,
    callModel: async () => GOOD_DRAFT,
    quota: createFakeQuota(),
    timeoutMs: 50
  }, overrides || {});
  return { ai: createAiService(opts), quota: opts.quota };
}

// ---------------------------------------------------------------- 扩展

test('扩展成功返回通过契约校验的草案', async () => {
  const { ai } = service();
  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value.points, ['用微信云开发存数据']);
});

test('AI 未启用时明确说明，不伪造任何结果', async () => {
  const { ai } = service({ enabled: false });
  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.disabled);
  assert.ok(result.message.indexOf('还没开放') !== -1);
});

test('正文过短不请求扩展，也不消耗额度', async () => {
  let called = 0;
  const { ai, quota } = service({ callModel: async () => { called += 1; return GOOD_DRAFT; } });
  const before = quota.remaining;

  const result = await ai.expand({ text: '记账' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.tooShort);
  assert.strictEqual(called, 0, '过短时不该调用模型');
  assert.strictEqual(quota.remaining, before, '过短时不该消耗额度');
});

test('超时返回明确状态，且不影响后续调用', async () => {
  const { ai } = service({
    timeoutMs: 20,
    callModel: () => new Promise((resolve) => setTimeout(() => resolve(GOOD_DRAFT), 200))
  });

  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.timeout);
});

test('模型抛错时退额度并返回失败', async () => {
  const { ai, quota } = service({ callModel: async () => { throw new Error('模型挂了'); } });
  const before = quota.remaining;

  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.failed);
  assert.strictEqual(quota.remaining, before, '生成失败应把额度退回来');
});

test('额度耗尽返回明确状态，并说明是额度限制', async () => {
  const { ai } = service({ quota: createFakeQuota(0) });
  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.quotaExceeded);
  // 文案只说额度的事。规范要求的是「基础功能继续可用」这个**行为**，
  // 不是让界面去念一遍功能矩阵——那属于「把规范条款抄成界面文案」。
  assert.ok(result.message.indexOf('额度') !== -1);
  assert.strictEqual(result.message.indexOf('不受影响'), -1, '不该把功能矩阵念给用户听');
});

test('额度在调用之前扣，超额的那次不会真的调出去', async () => {
  let called = 0;
  const { ai } = service({
    quota: createFakeQuota(0),
    callModel: async () => { called += 1; return GOOD_DRAFT; }
  });

  await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(called, 0, '额度已耗尽却仍然调用了模型——成本已经产生');
});

// ---------------------------------------------------------------- 契约与安全

test('输出结构不符合契约时拒绝，并退还额度', async () => {
  const { ai, quota } = service({ callModel: async () => ({ points: ['只有一段'] }) });
  const before = quota.remaining;

  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.contractInvalid);
  assert.strictEqual(quota.remaining, before);
});

test('模型返回越界建议时按失败处理', async () => {
  const { ai } = service({
    callModel: async () => ({
      points: ['按处方调整用药剂量'],
      nextSteps: ['先画数据模型'],
      risks: ['注意风险']
    })
  });

  const result = await ai.expand({ text: '做一个记账小程序' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.unsafeContent);
});

test('命中内容安全与结构不合法返回不同的错误码', async () => {
  const unsafe = service({
    callModel: async () => ({ points: ['参考 https://example.com'], nextSteps: ['x'], risks: ['y'] })
  });
  const malformed = service({ callModel: async () => ({ points: [] }) });

  assert.strictEqual((await unsafe.ai.expand({ text: '做一个记账小程序' })).code, CODE.unsafeContent);
  assert.strictEqual((await malformed.ai.expand({ text: '做一个记账小程序' })).code, CODE.contractInvalid);
});

// ---------------------------------------------------------------- 汇总

test('汇总成功返回单段文本', async () => {
  const { ai } = service({ callModel: async () => ({ text: '两条说的是一件事。' }) });
  const result = await ai.summarize({
    scope: 'supplements',
    items: [{ id: 'sup_1', content: '甲' }, { id: 'sup_2', content: '乙' }]
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.text, '两条说的是一件事。');
});

test('只选一条不发起汇总，也不消耗额度', async () => {
  let called = 0;
  const { ai, quota } = service({ callModel: async () => { called += 1; return { text: 'x' }; } });
  const before = quota.remaining;

  const result = await ai.summarize({ scope: 'supplements', items: [{ id: 'sup_1', content: '甲' }] });

  assert.strictEqual(result.code, CODE.tooFew);
  assert.strictEqual(called, 0);
  assert.strictEqual(quota.remaining, before);
});

test('来源条数超出上限时拒绝——不卡住会打出超大请求', async () => {
  const items = [];
  for (let i = 0; i <= LIMITS.summaryMaxSourceItems; i += 1) items.push({ id: 'sup_' + i, content: 'x' });

  const { ai } = service({ callModel: async () => ({ text: 'x' }) });
  const result = await ai.summarize({ scope: 'inspirations', items });

  assert.strictEqual(result.code, CODE.tooLarge);
});

test('来源拼接总长超出上限时拒绝', async () => {
  const big = '啊'.repeat(LIMITS.summaryMaxSourceChars);
  const { ai } = service({ callModel: async () => ({ text: 'x' }) });
  const result = await ai.summarize({
    scope: 'inspirations',
    items: [{ id: 'insp_a', content: big }, { id: 'insp_b', content: '啊' }]
  });

  assert.strictEqual(result.code, CODE.tooLarge);
});

test('未知 scope 直接失败，不去调用模型', async () => {
  let called = 0;
  const { ai } = service({ callModel: async () => { called += 1; return { text: 'x' }; } });

  const result = await ai.summarize({
    scope: 'everything',
    items: [{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }]
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(called, 0);
});

test('汇总输出为空时按契约失败处理', async () => {
  const { ai } = service({ callModel: async () => ({ text: '   ' }) });
  const result = await ai.summarize({
    scope: 'supplements',
    items: [{ id: 'sup_1', content: '甲' }, { id: 'sup_2', content: '乙' }]
  });

  assert.strictEqual(result.code, CODE.contractInvalid);
});

test('AI 未启用时汇总也不可用', async () => {
  const { ai } = service({ enabled: false });
  const result = await ai.summarize({
    scope: 'supplements',
    items: [{ id: 'sup_1', content: '甲' }, { id: 'sup_2', content: '乙' }]
  });

  assert.strictEqual(result.code, CODE.disabled);
});

// ---------------------------------------------------------------- 契约

test('两种动作共用同一套降级：每种失败都带可直接展示的说明', async () => {
  const cases = [
    service({ enabled: false }),
    service({ quota: createFakeQuota(0) }),
    service({ callModel: async () => { throw new Error('x'); } }),
    service({ callModel: async () => ({ points: [] }) })
  ];

  for (const s of cases) {
    const result = await s.ai.expand({ text: '做一个记账小程序' });
    assert.strictEqual(result.ok, false);
    assert.ok(typeof result.message === 'string' && result.message.length > 0, '失败必须带说明，不能只有一个码');
  }
});
