'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProtocol, ACTIONS } = require('../server/protocol');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const removedPages = ['share-preview', 'shared', 'my-shares'];
const removedModules = ['sharing', 'result-share', 'share-poster', 'public-reader'];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(js|json|wxml|wxss)$/.test(entry.name) ? [file] : [];
  });
}

test('发布包移除文字分享页面入口与专用模块', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.equal(app.pages.length, 13);
  for (const name of removedPages) {
    assert.ok(!app.pages.includes('pages/' + name + '/index'));
    assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages', name)), false);
  }
  for (const name of removedModules) {
    assert.equal(fs.existsSync(path.join(root, 'miniprogram/services', name + '.js')), false);
  }
  for (const file of sourceFiles(path.join(root, 'miniprogram'))) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /pages\/(share-preview|shared|my-shares)\/index|share\.(create|get|listMine|revoke|qr)|feedback\.reportShare|shareFileMessage|onShareDraft|onMoreShare|sharedTemplateIntent/, file);
  }
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/assets/share-card.png')), false);
  assert.doesNotMatch(read('deployment/product/manifest.json'), /LINGGAN_SHARE_|linggan_shares|msgSecCheck|wxacode/);
  assert.doesNotMatch(read('cloudfunctions/linggan_api/index.js'), /LINGGAN_SHARE_|createSharing|msgSecCheck|wxacode/);
});

test('旧文字分享动作被拒绝且不访问业务数据', async () => {
  const untouched = new Proxy({}, { get() { throw Error('旧分享动作不得访问业务数据'); } });
  const protocol = createProtocol({ repository: untouched, feedback: untouched, now: () => 1000 });
  assert.deepEqual(ACTIONS, ['snapshot.pull', 'snapshot.push', 'inspiration.delete', 'photo.delete', 'feedback.create', 'feedback.listMine']);
  for (const action of ['share.create', 'share.get', 'share.listMine', 'share.revoke', 'share.qr', 'feedback.reportShare']) {
    const response = await protocol.handle({ accountKey: 'confirmed_owner' }, {
      action, payload: { token: 'A'.repeat(28), body: '不得公开的用户文字' }, requestId: 'old_share_request'
    });
    assert.deepEqual(response, { ok: false, code: 'INVALID_ACTION', message: '未知的操作' }, action);
  }
});

test('普通小程序转发仅使用固定欢迎页', () => {
  const previous = global.Page;
  try {
    for (const name of ['welcome', 'mine']) {
      const filename = require.resolve('../miniprogram/pages/' + name + '/index.js');
      let page;
      global.Page = (definition) => { page = definition; };
      delete require.cache[filename];
      require(filename);
      const context = { data: { draft: '用户未保存的文字', token: 'A'.repeat(28), id: 'personal_item' } };
      assert.deepEqual(page.onShareAppMessage.call(context), {
        title: '灵感拾光簿｜随手记录灵感，手动整理成稿', path: '/pages/welcome/index', imageUrl: '/assets/product-share.png'
      });
      assert.deepEqual(page.onShareTimeline.call(context), {
        title: '灵感拾光簿｜随手记录灵感，手动整理成稿', query: '', imageUrl: '/assets/product-share.png'
      });
      delete require.cache[filename];
    }
  } finally {
    if (previous === undefined) delete global.Page;
    else global.Page = previous;
  }
});

test('页面文案不添加私密性与整改说明', () => {
  for (const file of sourceFiles(path.join(root, 'miniprogram/pages'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /仅本人可见|仅你可见|只有你可见|审核整改|社交[—-]笔记/, file);
  }
});
