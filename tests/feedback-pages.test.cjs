'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFeedbackClient } = require('../miniprogram/services/feedback');
const sharedCloud = require('./helpers/shared-cloud.cjs');

const root = path.resolve(__dirname, '..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

function withPage(relative, app, wxMock, callback) {
  if (wxMock.cloud) wxMock.cloud = sharedCloud(wxMock.cloud);
  const file = require.resolve(path.join(root, 'miniprogram/pages', relative, 'index.js'));
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  global.Page = (page) => { definition = page; };
  global.getApp = () => app;
  global.wx = wxMock;
  delete require.cache[file];
  require(file);
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(next) { Object.assign(this.data, next); }
  });
  return Promise.resolve().then(() => callback(page)).finally(() => {
    delete require.cache[file];
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete global[name]; else global[name] = value;
    }
  });
}

function appFixture(state) {
  const item = { id: 'idea_1', text: '一段想法', deletedAt: null,
    supplements: [{ id: 's1', content: '后来补充', createdAt: 1, mergedInto: null, foldedAt: null,
      source: 'user', contentHistory: [] }], photos: [{ fileId: 'private' }], textHistory: [{ text: 'old' }] };
  const store = { getInspiration: () => item,
    getConfirmedRevision: () => state && state.state !== 'synced' ? null : { baseVersion: 2, generation: 1 } };
  return { globalData: { store, sessionEpoch: 1, accountError: '' }, ensureReady: async () => store };
}

test('反馈客户端保留注入传输与幂等请求标识', async () => {
  const calls = [];
  const client = createFeedbackClient({
    transport: { send: async (...input) => { calls.push(input); return { ok: true }; } },
    newRequestId: () => 'feedback_request'
  });
  const payload = { category: 'idea', body: '希望搜索筛选可以更方便找到旧记录' };
  await client.send('feedback.create', payload, client.newRequestId());
  await client.send('feedback.listMine', {});
  assert.deepEqual(calls, [
    ['feedback.create', payload, { requestId: 'feedback_request' }],
    ['feedback.listMine', {}, undefined]
  ]);
});

test('反馈页忽略旧分享参数且只提交普通意见，历史举报仍可读取', async () => {
  const app = appFixture();
  const calls = [];
  const wxMock = { cloud: { callFunction: async ({ data }) => {
    calls.push(data);
    return { result: data.action === 'feedback.create'
      ? { ok: true, data: { feedbackId: 'new_feedback' } }
      : { ok: true, data: { items: [{ feedbackId: 'historical_report', category: 'share_report',
        body: '历史内容举报', createdAt: 1000, status: 'submitted' }], nextBefore: null } } };
  } } };
  await withPage('feedback', app, wxMock, async (page) => {
    page.onLoad({ t: 'A'.repeat(28) });
    page.onInput({ detail: { value: '希望增加记录整理操作的使用帮助' } });
    await page.onSubmit();
    assert.deepEqual(calls.map(call => call.action), ['feedback.create', 'feedback.listMine']);
    assert.deepEqual(calls[0].payload, { category: 'idea', body: '希望增加记录整理操作的使用帮助' });
    assert.equal(page.data.items[0].categoryText, '内容举报');
    assert.equal(page.data.reporting, undefined);
  });
});

test('反馈提交失败保留原文；成功后才清空并显示已收到', async () => {
  const app = appFixture();
  let success = false;
  const wxMock = { cloud: { callFunction: async ({ data }) => ({ result: data.action === 'feedback.create'
    ? success ? { ok: true, data: { feedbackId: 'f1' } } : { ok: false, code: 'INTERNAL', message: '暂不可用' }
    : { ok: true, data: { items: [], nextBefore: null } } }) } };
  await withPage('feedback', app, wxMock, async (page) => {
    page.onLoad({});
    page.onInput({ detail: { value: '我希望增加筛选功能，方便找到旧想法' } });
    await page.onSubmit();
    assert.match(page.data.error, /暂不可用/);
    assert.match(page.data.body, /我希望/);
    success = true;
    await page.onSubmit();
    assert.equal(page.data.body, '');
    assert.equal(page.data.notice, '反馈已收到。');
  });
});

test('公共入口与私人页面的索引、文案和入口分开', () => {
  const sitemap = JSON.parse(read('miniprogram/sitemap.json'));
  for (const page of ['feedback']) {
    assert.ok(sitemap.rules.some((rule) => rule.page === 'pages/' + page + '/index' && rule.action === 'disallow'));
  }
  const welcome = read('miniprogram/pages/welcome/index.js');
  assert.match(welcome, /onShareTimeline/);
  const presentation = require('../miniprogram/services/product-presentation');
  assert.equal(presentation.createAppShare().path, '/pages/welcome/index');
  assert.doesNotMatch(welcome, /accountKey|openid|inspirationId/);
  const mine = read('miniprogram/pages/mine/index.wxml');
  assert.match(mine, /分享小程序/);
  assert.doesNotMatch(mine, /我的分享/);
  assert.match(mine, /意见与问题反馈/);
});

test('我的页直接分享公共入口，不把账户或记录放进聊天卡片与朋友圈', async () => {
  const mine = read('miniprogram/pages/mine/index.wxml');
  assert.match(mine, /open-type="share"[^>]*>[\s\S]*?<text class="menu-label">分享小程序<\/text>/);
  assert.doesNotMatch(mine, /bindtap="onOpenWelcome"/);
  await withPage('mine', appFixture(), {}, (page) => {
    const chat = page.onShareAppMessage();
    const timeline = page.onShareTimeline();
    assert.equal(chat.path, '/pages/welcome/index');
    assert.equal(timeline.query, '');
    for (const payload of [chat, timeline]) {
      assert.equal(payload.title, '灵感拾光簿｜随手记录灵感，手动整理成稿');
      assert.equal(payload.imageUrl, '/assets/product-share.png');
      assert.doesNotMatch(JSON.stringify(payload), /accountKey|openid|inspirationId|idea_1|一段想法/);
    }
  });
});
