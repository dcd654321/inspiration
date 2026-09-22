'use strict';
// wx 传输层适配器的单元测试。
//
// 这一层很薄，但它跨在 wx 边界上——Node 里跑不了真实调用，所以 `callFunction`
// 从外面注入，好把「云函数返回了畸形结果」这类路径也测到。

const test = require('node:test');
const assert = require('node:assert');

const { createWxTransport, createRequestId, REQUEST_ID_PREFIX } = require('../miniprogram/services/wx-transport');

function fakeCall(result) {
  const calls = [];
  return {
    calls,
    callFunction(input) {
      calls.push(input);
      return Promise.resolve(result);
    }
  };
}

function transport(fake, overrides) {
  return createWxTransport(Object.assign({
    functionName: 'linggan_api',
    callFunction: (input) => fake.callFunction(input),
    newRequestId: () => 'req_fixed'
  }, overrides || {}));
}

test('拼出协议要求的信封', async () => {
  const fake = fakeCall({ result: { ok: true, data: { version: 1 } } });

  const result = await transport(fake).send('snapshot.push', { upserts: [] });

  assert.deepStrictEqual(fake.calls[0], {
    name: 'linggan_api',
    data: { action: 'snapshot.push', payload: { upserts: [] }, requestId: 'req_fixed' }
  });
  assert.deepStrictEqual(result, { ok: true, data: { version: 1 } });
});

test('调用方给了 requestId 就用它——重试必须复用同一个', async () => {
  const fake = fakeCall({ result: { ok: true } });

  await transport(fake).send('snapshot.push', {}, { requestId: 'req_from_caller' });
  await transport(fake).send('snapshot.push', {}, { requestId: 'req_from_caller' });

  assert.strictEqual(fake.calls[0].data.requestId, 'req_from_caller');
  assert.strictEqual(fake.calls[1].data.requestId, 'req_from_caller');
});

test('失败信封原样带回，不在这一层解释错误码', async () => {
  const fake = fakeCall({ result: { ok: false, code: 'CONFLICT', message: '版本冲突' } });

  const result = await transport(fake).send('snapshot.push', {});

  assert.deepStrictEqual(result, { ok: false, code: 'CONFLICT', message: '版本冲突' });
});

test('云函数返回畸形结果时收敛成 INTERNAL，不把 errMsg 透出去', async () => {
  const broken = fakeCall({ errMsg: 'cloud.callFunction:fail 内部路径 /var/secret' });

  const result = await transport(broken).send('snapshot.pull', {});

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'INTERNAL');
  assert.strictEqual(result.message, '服务返回了无法识别的内容', '不该把内部错误原文透给调用方');
});

test('云函数返回空结果同样收敛成 INTERNAL', async () => {
  const result = await transport(fakeCall(undefined)).send('snapshot.pull', {});

  assert.strictEqual(result.code, 'INTERNAL');
});

test('缺少 functionName 时直接抛错，不等到调用时才炸', () => {
  assert.throws(() => createWxTransport({ functionName: '' }));
  assert.throws(() => createWxTransport({}));
});

test('默认的 requestId 每次都不重复且带前缀', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(createRequestId());

  assert.strictEqual(seen.size, 200, 'requestId 出现重复会让服务端把两次操作当成一次');
  assert.ok(createRequestId().indexOf(REQUEST_ID_PREFIX) === 0);
});

test('不传 newRequestId 时也能工作，用的是默认生成器', async () => {
  const fake = fakeCall({ result: { ok: true } });
  const t = createWxTransport({ functionName: 'linggan_api', callFunction: (i) => fake.callFunction(i) });

  await t.send('snapshot.pull', {});

  assert.ok(fake.calls[0].data.requestId.indexOf(REQUEST_ID_PREFIX) === 0);
});
