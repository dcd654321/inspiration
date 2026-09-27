'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadShareOptions(flag) {
  const env = {};
  if (flag !== undefined) env.LINGGAN_SHARE_CREATE_ENABLED = flag;
  let options;
  const filename = path.resolve(__dirname, '../cloudfunctions/linggan_api/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Buffer, process: { env }, exports: {},
    require(name) {
      if (name === 'node:crypto') return require(name);
      if (name === 'wx-server-sdk') return { init() {}, database: () => ({}) };
      if (name === './server/repository') return { createRepository: () => ({}) };
      if (name === './server/protocol') return { createProtocol: () => ({}) };
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
