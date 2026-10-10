'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPosters } = require('../miniprogram/services/share-poster');
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

test('分享预览先确认才创建；聊天卡片只携令牌，不带私有内容', async () => {
  const app = appFixture();
  const calls = [];
  const wxMock = { cloud: { callFunction: async ({ data }) => {
    calls.push(data);
    return { result: { ok: true, data: { token: 'A'.repeat(28), shareId: 'one',
      preview: { title: '一段想法', body: '一段想法\n\n后来补充' } } } };
  } } };
  await withPage('share-preview', app, wxMock, async (page) => {
    await page.onLoad({ id: 'idea_1' });
    assert.equal(calls.length, 0);
    assert.equal(page.data.preview, '一段想法');
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.options[0].selected, false);
    assert.equal(page.onShareAppMessage().path, '/pages/welcome/index');
    page.onToggle({ currentTarget: { dataset: { id: 's1' } } });
    assert.equal(page.data.preview, '一段想法\n\n后来补充');
    await page.onPrepareChat();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload.selectedSupplementIds, ['s1']);
    assert.equal(calls[0].payload.baseVersion, 2);
    assert.equal(page.onShareAppMessage().path, '/pages/shared/index?t=' + 'A'.repeat(28));
    assert.equal(page.onShareAppMessage().path.includes('一段想法'), false);
  });
});

test('内容状态未确认时不能创建分享，选择变化会清除已备分享状态', async () => {
  let calls = 0;
  const app = appFixture({ state: 'pending', pendingCount: 1 });
  const wxMock = { cloud: { callFunction: async () => { calls += 1; return {}; } } };
  await withPage('share-preview', app, wxMock, async (page) => {
    await page.onLoad({ id: 'idea_1' });
    await page.onPrepareChat();
    assert.equal(calls, 0);
    assert.match(page.data.error, /无法确认内容状态/);
    page.setData({ chatPrepared: true });
    page.preparedToken = 'A'.repeat(28);
    page.onToggle({ currentTarget: { dataset: { id: 's1' } } });
    assert.equal(page.data.chatPrepared, false);
    assert.equal(page.onShareAppMessage().path, '/pages/welcome/index');
  });
});

test('分享接收页只读调用并渲染服务端白名单；错误不渲染旧正文', async () => {
  const app = appFixture();
  let outcome = { ok: true, data: { title: '可读标题', body: '可读正文', createdAt: Date.now() } };
  let copied = false;
  const wxMock = { cloud: { callFunction: async ({ data }) => {
    assert.equal(data.action, 'share.get');
    assert.equal(data.payload.token, 'A'.repeat(28));
    return { result: outcome };
  } }, setClipboardData: () => { copied = true; } };
  await withPage('shared', app, wxMock, async (page) => {
    await page.onLoad({ scene: 's=' + 'A'.repeat(28) });
    assert.equal(page.data.body, '可读正文');
    assert.equal(page.data.title, '可读标题');
    outcome = { ok: false, code: 'SHARE_UNAVAILABLE' };
    await page.load();
    assert.equal(page.data.unavailable, true);
    assert.equal(page.data.body, '');
    page.onCopy();
    assert.equal(copied, false);
  });
});

test('分享接收只准备公共连接，私人快照失败仍可只读且不调用 pull', async () => {
  const app = appFixture();
  app.globalData.store = null;
  let prepared = 0;
  app.ensureReady = async () => { prepared += 1; throw Error('PRIVATE_PULL_FAILED'); };
  const actions = [];
  await withPage('shared', app, { cloud: { callFunction: async ({ data }) => {
    actions.push(data.action);
    assert.deepEqual(data.payload, { token: 'A'.repeat(28) });
    return { result: { ok: true, data: { title: '讨论提纲', body: '公开文字', templateId: 'work', createdAt: 1000 } } };
  } } }, async (page) => {
    await page.onLoad({ t: 'A'.repeat(28) });
    assert.equal(page.data.body, '公开文字');
    assert.equal(page.data.templateName, '工作提纲');
    assert.equal(page.data.startLabel, '用这个结构写自己的');
    assert.equal(prepared, 0);
    assert.deepEqual(actions, ['share.get']);
    assert.equal(app.globalData.store, null);
  });
});

test('公开分享读取跨页面账户和公共连接代次均丢弃迟到正文', async () => {
  for (const change of ['page', 'account', 'connection']) {
    const app = appFixture();
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const wxMock = { cloud: { callFunction: async () => pending } };
    await withPage('shared', app, wxMock, async (page) => {
      const loading = page.onLoad({ t: 'A'.repeat(28) });
      await new Promise(setImmediate);
      if (change === 'page') page.onHide();
      if (change === 'account') app.globalData.sessionEpoch += 1;
      if (change === 'connection') wxMock.cloud = sharedCloud({ callFunction: async () => ({ result: { ok: true, data: {} } }) });
      page.setData({ title: '当前标题', body: '', error: '当前状态' });
      resolve({ result: { ok: true, data: { title: '旧标题', body: '旧正文', createdAt: 1000 } } });
      await loading;
      assert.equal(page.data.title, '当前标题');
      assert.equal(page.data.body, '');
      assert.equal(page.data.error, '当前状态');
    });
  }
});

test('公开分享冷热切换按最新 token 渲染，初次 onShow 不重复读取', async () => {
  const app = appFixture();
  let resolve;
  const previousRead = new Promise((done) => { resolve = done; });
  const tokens = [];
  await withPage('shared', app, { cloud: { callFunction: async ({ data }) => {
    tokens.push(data.payload.token);
    if (data.payload.token === 'A'.repeat(28)) return previousRead;
    return { result: { ok: true, data: { title: '当前分享', body: 'B正文', createdAt: 1000 } } };
  } } }, async (page) => {
    const first = page.onLoad({ t: 'A'.repeat(28) });
    await page.onShow();
    await new Promise(setImmediate);
    assert.deepEqual(tokens, ['A'.repeat(28)]);
    page.token = 'B'.repeat(28);
    await page.load();
    resolve({ result: { ok: true, data: { title: '迟到分享', body: 'A正文', createdAt: 1000 } } });
    await first;
    assert.deepEqual(tokens, ['A'.repeat(28), 'B'.repeat(28)]);
    assert.equal(page.data.title, '当前分享');
    assert.equal(page.data.body, 'B正文');
  });
});

test('分享用途承接只传合法模板且缺少上下文回到通用入口', async () => {
  for (const templateId of ['social', 'video', 'work', 'action', 'free', undefined, 'other']) {
    const app = appFixture();
    let route;
    await withPage('shared', app, { cloud: { callFunction: async () => ({ result: { ok: true,
      data: { title: '作者标题', body: '作者正文不能复制进接收者输入', templateId, createdAt: 1000 } } }) },
    switchTab: (options) => { route = options.url; } }, async (page) => {
      await page.onLoad({ t: 'A'.repeat(28) });
      page.onStart();
      assert.equal(route, '/pages/capture/index');
      const intent = app.globalData.sharedTemplateIntent;
      if (['social', 'video', 'work', 'action'].includes(templateId)) {
        assert.deepEqual(Object.keys(intent).sort(), ['epoch', 'expiresAt', 'templateId']);
        assert.equal(intent.templateId, templateId);
        assert.equal(intent.epoch, app.globalData.sessionEpoch);
        assert.ok(intent.expiresAt > Date.now() && intent.expiresAt <= Date.now() + 5 * 60 * 1000);
        assert.equal(page.data.startLabel, '用这个结构写自己的');
      } else {
        assert.equal(intent, undefined);
        assert.equal(page.data.startLabel, '也整理我的想法');
      }
      assert.doesNotMatch(JSON.stringify(intent || {}), /作者正文|owner|accountKey|token|AAAA/);
    });
  }
});

test('公开页复制回执和用途承接不会跨入新账户或云连接', async () => {
  const app = appFixture();
  let clipboard, copiedToast = 0, route;
  const wxMock = { cloud: { callFunction: async () => ({ result: { ok: true,
    data: { title: '文字', body: '公开正文', templateId: 'action', createdAt: 1000 } } }) },
    setClipboardData: (options) => { clipboard = options; },
    showToast: () => { copiedToast += 1; }, switchTab: (options) => { route = options.url; } };
  await withPage('shared', app, wxMock, async (page) => {
    await page.onLoad({ t: 'A'.repeat(28) });
    page.onCopy();
    app.globalData.sessionEpoch += 1;
    clipboard.success();
    assert.equal(copiedToast, 0);
    page.onStart();
    assert.equal(route, '/pages/capture/index');
    assert.equal(app.globalData.sharedTemplateIntent, undefined);
    await page.onShow();
    page.onCopy();
    wxMock.cloud = sharedCloud({ callFunction: async () => ({ result: { ok: false } }) });
    clipboard.fail();
    assert.equal(copiedToast, 0);
  });
});

test('公开连接失败可重试，过期分享没有重新读取入口行为', async () => {
  const app = appFixture();
  let attempts = 0, reads = 0;
  const wxMock = { cloud: {
    Cloud: class {
      async init() { if (++attempts === 1) throw Error('DENIED'); }
      async callFunction() { reads += 1; return { result: { ok: false, code: 'SHARE_UNAVAILABLE' } }; }
    }
  } };
  // withPage 会包装普通底层方法，独立安装 SDK 才能模拟 init 拒绝。
  await withPage('shared', app, {}, async (page) => {
    global.wx.cloud = wxMock.cloud;
    await page.onLoad({ t: 'A'.repeat(28) });
    assert.equal(page.data.loading, false);
    assert.match(page.data.error, /检查网络/);
    assert.equal(reads, 0);
    await page.onRetry();
    assert.equal(page.data.unavailable, true);
    assert.equal(reads, 1);
    await page.onRetry();
    assert.equal(reads, 1);
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

test('分页海报逐页绘制同一文字与小程序码，不调用发布朋友圈', async () => {
  const previous = global.wx;
  let written = 0;
  let drawn = 0;
  try {
    global.wx = {
      getFileSystemManager: () => ({ writeFile({ success }) { written += 1; success(); } }),
      createCanvasContext: () => ({
        setFillStyle() {}, fillRect() {}, setFontSize() {}, fillText() {},
        setStrokeStyle() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        drawImage() { drawn += 1; }, draw(_reserve, callback) { callback(); }
      }),
      canvasToTempFilePath: ({ success }) => success({ tempFilePath: '/tmp/poster-' + drawn + '.png' })
    };
    const paths = await renderPosters({}, '示例文字'.repeat(180), '示例', Buffer.from('qr').toString('base64'), '/tmp/code.png');
    assert.ok(paths.length >= 2);
    assert.equal(written, 1);
    assert.equal(drawn, paths.length);
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});

test('公共入口与私人页面的索引、文案和入口分开', () => {
  const sitemap = JSON.parse(read('miniprogram/sitemap.json'));
  for (const page of ['share-preview', 'shared', 'my-shares', 'feedback']) {
    assert.ok(sitemap.rules.some((rule) => rule.page === 'pages/' + page + '/index' && rule.action === 'disallow'));
  }
  const welcome = read('miniprogram/pages/welcome/index.js');
  assert.match(welcome, /onShareTimeline/);
  assert.match(welcome, /pages\/welcome\/index/);
  assert.doesNotMatch(welcome, /accountKey|openid|inspirationId/);
  const mine = read('miniprogram/pages/mine/index.wxml');
  assert.match(mine, /分享小程序/);
  assert.match(mine, /我的分享/);
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
      assert.equal(payload.title, '灵感拾光簿｜让想法慢慢成形');
      assert.equal(payload.imageUrl, '/assets/brand-mark.png');
      assert.doesNotMatch(JSON.stringify(payload), /accountKey|openid|inspirationId|idea_1|一段想法/);
    }
  });
});
