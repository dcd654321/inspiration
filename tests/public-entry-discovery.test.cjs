'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const presentation = require('../miniprogram/services/product-presentation');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function withPage(name, environment, run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const filename = require.resolve('../miniprogram/pages/' + name + '/index.js');
  let page;
  try {
    global.Page = definition => { page = definition; };
    global.wx = environment.wx;
    global.getApp = environment.getApp;
    delete require.cache[filename];
    require(filename);
    return run(page);
  } finally {
    delete require.cache[filename];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('公开介绍直接打开：账户不可用仍能读取用途、步骤、帮助与入口', () => {
  const unavailable = () => { assert.fail('公开介绍不应读取账户或调用平台服务'); };
  const wx = new Proxy({}, { get: unavailable });
  withPage('welcome', { wx, getApp: unavailable }, page => {
    for (const method of ['onLoad', 'onShow', 'onReady']) {
      if (typeof page[method] === 'function') page[method]({ id: 'untrusted_record', query: 'untrusted_query' });
    }
    assert.equal(typeof page.onStart, 'function');
  });
  const wxml = read('miniprogram/pages/welcome/index.wxml');
  assert.doesNotMatch(wxml, /\{\{|wx:if|wx:for|web-view|rich-text/,
    '公开正文与帮助直接使用原生固定文本，不等待账户或脚本填充');
  for (const text of ['灵感拾光簿', '随手记录灵感', '手动整理成稿', '记录想法', '继续补充', '选材整理', '常见问题', '搜索', '复制', 'TXT']) {
    assert.ok(wxml.includes(text), '公开介绍缺少 ' + text);
  }
  assert.match(wxml, /bindtap="onStart">开始记录<\/button>/);
  assert.doesNotMatch(wxml, /照片|AI|草稿|记录标识/);
  const config = JSON.parse(read('miniprogram/pages/welcome/index.json'));
  assert.equal(config.navigationBarTitleText, '灵感拾光簿｜灵感记录与整理');
});

test('固定产品转发：两页分享内容一致且对象互不污染', () => {
  const cover = fs.readFileSync(path.join(root, 'miniprogram/assets/product-share.png'));
  assert.equal(cover.subarray(1, 4).toString('ascii'), 'PNG', '固定封面必须随发布包提供');
  assert.equal(cover.readUInt32BE(16), 1000);
  assert.equal(cover.readUInt32BE(20), 800);
  const expectedChat = { title: '灵感拾光簿｜随手记录灵感，手动整理成稿',
    path: '/pages/welcome/index', imageUrl: '/assets/product-share.png' };
  const expectedTimeline = { title: expectedChat.title, query: '', imageUrl: expectedChat.imageUrl };
  const privateContext = new Proxy({}, { get() { assert.fail('转发不应读取页面或账户内容'); } });
  for (const name of ['welcome', 'mine']) {
    withPage(name, {}, page => {
      const chat = page.onShareAppMessage.call(privateContext, { target: { dataset: { id: 'private_id' } } });
      const timeline = page.onShareTimeline.call(privateContext, { query: 'private_query' });
      assert.deepEqual(chat, expectedChat, name);
      assert.deepEqual(timeline, expectedTimeline, name);
      chat.title = '被修改的分享'; chat.path = '/pages/detail/index?id=private_id';
      timeline.query = 'private_query'; timeline.imageUrl = '/private.png';
      assert.deepEqual(page.onShareAppMessage.call(privateContext), expectedChat);
      assert.deepEqual(page.onShareTimeline.call(privateContext), expectedTimeline);
    });
  }
  assert.notStrictEqual(presentation.createAppShare(), presentation.createAppShare());
  assert.notStrictEqual(presentation.createTimelineShare(), presentation.createTimelineShare());
});

test('开始记录沿用会话意图且不接触未提交输入', () => {
  const draft = { text: '还没保存的想法', status: 'unknown', requestId: 'existing_request' };
  const app = { globalData: { sessionEpoch: 7, sessionDrafts: draft },
    ensureReady() { assert.fail('开始入口由记录页准备账户'); } };
  const calls = [];
  const startedAt = Date.now();
  withPage('welcome', { getApp: () => app, wx: { switchTab: options => calls.push(options) } }, page => {
    page.onStart();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/pages/capture/index');
    assert.equal(app.globalData.captureStartIntent.epoch, 7);
    assert.ok(app.globalData.captureStartIntent.expiresAt >= startedAt);
    assert.strictEqual(app.globalData.sessionDrafts, draft);
    assert.deepEqual(draft, { text: '还没保存的想法', status: 'unknown', requestId: 'existing_request' });
  });
});

test('搜索白名单只允许欢迎页并默认拒绝未知页面', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const sitemap = JSON.parse(read('miniprogram/sitemap.json'));
  assert.deepEqual(sitemap.rules.filter(rule => rule.action === 'allow'),
    [{ action: 'allow', page: 'pages/welcome/index' }]);
  for (const page of [...app.pages, 'pages/unregistered/index']) {
    const rule = sitemap.rules.find(entry => entry.page === page || entry.page === '*');
    assert.equal(rule && rule.action, page === 'pages/welcome/index' ? 'allow' : 'disallow', page);
  }
});
