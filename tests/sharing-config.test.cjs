'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadShareOptions(flag, cloudOverrides) {
  const env = {};
  if (flag !== undefined) env.LINGGAN_SHARE_CREATE_ENABLED = flag;
  let options;
  const filename = path.resolve(__dirname, '../cloudfunctions/linggan_api/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Buffer, process: { env }, exports: {},
    require(name) {
      if (name === 'node:crypto') return require(name);
      if (name === './server/wx-identity') return require('../server/wx-identity');
      if (name === 'wx-server-sdk') return Object.assign({ init() {}, database: () => ({}) }, cloudOverrides);
      if (name === './server/repository') return { createRepository: () => ({}) };
      if (name === './server/protocol') return { createProtocol: () => ({}) };
      if (name === './server/cloud-sharing-db') return { createCloudSharingDb: () => ({}) };
      if (name === './server/rate-limit') return { createCloudRateLimiter: () => async () => true };
      if (name === './server/photo-lifecycle') return { createPhotoValidator: () => () => false };
      if (name === './server/sharing-feedback') return {
        createSharingFeedbackService(value) { options = value; return {}; }
      };
      throw new Error('Unexpected dependency: ' + name);
    }
  }, { filename });
  return options;
}

test('云函数分享创建默认启用，显式关闭与无效值保持暂停', () => {
  for (const flag of [undefined, '', 'true']) {
    const options = loadShareOptions(flag);
    assert.equal(options.createEnabled, true);
    assert.equal(options.tokenKey, null, '启用开关不能伪造缺失密钥');
    assert.equal(typeof options.checkPublicText, 'function', '启用开关不能移除审核');
  }
  for (const flag of ['false', 'FALSE', '0', 'tru']) {
    assert.equal(loadShareOptions(flag).createEnabled, false);
  }
});

test('公开分享逐块审核使用可信上下文，未知结果与任一块不通过均拒绝', async () => {
  const calls = []; let suggestion = 'pass'; let context = { APPID: 'wx7ad85943fe81e095', OPENID: 'resource_user', FROM_APPID: 'wxed8fdc5d559d973d', FROM_OPENID: 'synthetic_openid' };
  const options = loadShareOptions('true', { getWXContext: () => context,
    openapi(config) {
      assert.equal(config.appid, 'wxed8fdc5d559d973d');
      return { security: { async msgSecCheck(data) { calls.push(data); return { errCode: 0, result: { suggest: suggestion } }; } } };
    } });
  assert.equal(await options.checkPublicText('文😀'.repeat(1000)), true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((x) => x.version === 2 && x.scene === 4 && x.openid === 'synthetic_openid' && Buffer.byteLength(x.content) <= 2400));
  suggestion = 'review'; assert.equal(await options.checkPublicText('不能直接放行'), false);
  suggestion = undefined; assert.equal(await options.checkPublicText('未知结果'), false);
  context = {}; const before = calls.length;
  assert.equal(await options.checkPublicText('无可信身份'), false); assert.equal(calls.length, before);
});
