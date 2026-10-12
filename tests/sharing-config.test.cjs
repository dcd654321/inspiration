'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('云入口仅接入独立反馈，不读取文字分享开关密钥或调用公开审核与小程序码', () => {
  let feedbackOptions, protocolOptions, repositoryOptions;
  const filename = path.resolve(__dirname, '../cloudfunctions/linggan_api/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Buffer, process: { env: new Proxy({}, { get(target, key) {
      assert.equal(String(key).startsWith('LINGGAN_SHARE_'), false, '不得再读取分享配置');
      return undefined;
    } }) }, exports: {},
    require(name) {
      if (name === 'node:crypto') return require(name);
      if (name === './server/wx-identity') return require('../server/wx-identity');
      if (name === 'wx-server-sdk') return { init() {}, database: () => ({}), openapi() { assert.fail('不再调用分享 OpenAPI'); } };
      if (name === './server/repository') return { createRepository(value) { repositoryOptions = value; return {}; } };
      if (name === './server/protocol') return { createProtocol(value) { protocolOptions = value; return {}; } };
      if (name === './server/cloud-feedback-db') return { createCloudFeedbackDb: () => ({}) };
      if (name === './server/rate-limit') return { createCloudRateLimiter: () => async () => true };
      if (name === './server/photo-lifecycle') return { createPhotoValidator: () => () => false };
      if (name === './server/operations-monitor') return require('../server/operations-monitor');
      if (name === './server/feedback') return {
        createFeedbackService(value) { feedbackOptions = value; return { kind: 'feedback' }; }
      };
      throw new Error('Unexpected dependency: ' + name);
    }
  }, { filename });
  assert.deepEqual(Object.keys(feedbackOptions).sort(), ['db', 'now', 'rateLimit']);
  assert.equal(protocolOptions.feedback.kind, 'feedback');
  assert.equal('sharing' in protocolOptions, false);
  assert.equal('beforeRemove' in repositoryOptions, false);
  assert.equal(typeof repositoryOptions.onCommitted, 'function', '保留既有运营确认事件');
  const permissions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../cloudfunctions/linggan_api/config.json'), 'utf8'));
  assert.deepEqual(permissions, {});
});
