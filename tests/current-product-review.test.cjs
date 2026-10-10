'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { createSessionDrafts } = require('../miniprogram/services/session-drafts');
const { startCapture } = require('../miniprogram/services/capture-entry');

async function fixture(run) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const items = []; const routes = []; const tabs = [];
  const store = { listInspirations: () => items, getInspiration: id => items.find(item => item.id === id),
    getConfirmedRevision: () => ({ generation: 1, baseVersion: 1 }),
    saveInspiration: async item => { items.push(item); return { ok: true, synced: true }; } };
  const sessionDrafts = createSessionDrafts(); sessionDrafts.bind({ cacheScope: 'a'.repeat(32), generation: 1 });
  const app = { globalData: { store, cacheScope: 'a'.repeat(32), sessionEpoch: 1, sessionDrafts }, ensureReady: async () => store };
  const loaded = [];
  function mount(name) {
    const file = require.resolve('../miniprogram/pages/' + name + '/index.js'); loaded.push(file);
    let definition; global.Page = page => { definition = page; }; delete require.cache[file]; require(file);
    return { ...definition, data: structuredClone(definition.data), setData(data, done) { Object.assign(this.data, data); if (done) done(); } };
  }
  try {
    global.getApp = () => app;
    global.wx = { switchTab: options => tabs.push(options), navigateTo: options => routes.push(options.url),
      enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} };
    await run({ mount, app, store, items, routes, tabs });
  } finally {
    loaded.forEach(file => delete require.cache[file]);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('全量审查：明确记录入口清除旧成功卡，普通返回和未提交输入继续接续', async () => {
  await fixture(async ({ mount, app }) => {
    const page = mount('capture'); await page.onShow();
    page.onInput({ detail: { value: '已经确认保存的一条记录' } }); await page.onSave();
    const saved = page.data.lastSavedId; assert.ok(saved);
    page.onHide(); await page.onShow(); assert.equal(page.data.lastSavedId, saved, '普通 Tab 返回保留确认卡');
    for (const [name, method] of [['list', 'onAdd'], ['welcome', 'onStart'], ['shared', 'onStart']]) {
      page.setData({ lastSavedId: saved, draft: '' }); page.onHide();
      mount(name)[method](); await page.onShow();
      assert.equal(page.data.lastSavedId, '', name + ' 的记录入口应展开输入');
      assert.equal(page.data.draft, ''); assert.equal(app.globalData.captureStartIntent, undefined);
    }
    page.onInput({ detail: { value: '尚未提交的新想法' } }); page.onHide();
    mount('list').onAdd(); await page.onShow(); assert.equal(page.data.draft, '尚未提交的新想法');
    page.pendingSave = { text: page.data.draft, item: core.createInspiration({ id: 'pending', text: page.data.draft, now: 10 }), generation: 1 };
    page.setData({ status: 'unknown' }); page.onHide(); mount('welcome').onStart(); await page.onShow();
    assert.equal(page.pendingSave.item.id, 'pending'); assert.equal(page.data.status, 'unknown');
  });
});

test('全量审查：入口失效不覆盖稿件，旧跳转失败不清除新意图', async () => {
  await fixture(async ({ mount, app, tabs }) => {
    const page = mount('capture'); await page.onShow(); page.setData({ lastSavedId: 'saved' });
    for (const intent of [{ epoch: 0, expiresAt: Date.now() + 10000 }, { epoch: 1, expiresAt: 0 }]) {
      app.globalData.captureStartIntent = intent; await page.onShow(); assert.equal(page.data.lastSavedId, 'saved');
    }
    startCapture(); startCapture(); const latest = app.globalData.captureStartIntent;
    tabs[0].fail(); assert.equal(app.globalData.captureStartIntent, latest);
    tabs[1].fail(); assert.equal(app.globalData.captureStartIntent, undefined);
    let finish; app.ensureReady = () => new Promise(resolve => { finish = resolve; });
    app.globalData.sharedTemplateIntent = { epoch: 1, expiresAt: Date.now() + 10000, templateId: 'work' };
    const showing = page.onShow(); app.globalData.sessionEpoch = 2; finish(null); await showing;
    assert.equal(page.data.templateIntentId, '', '等待期间变化的账户不能消费旧用途');
  });
});

test('全量审查：回顾继续补充定位输入，普通阅读不请求聚焦', async () => {
  await fixture(async ({ mount, routes }) => {
    const page = mount('list');
    page.onOpen({ currentTarget: { dataset: { id: 'a/b', review: true } } });
    page.onOpen({ currentTarget: { dataset: { id: 'a/b' } } });
    assert.deepEqual(routes, ['/pages/detail/index?id=a%2Fb&focus=supplement', '/pages/detail/index?id=a%2Fb']);
  });
});

test('全量审查：反馈历史失败可重试，保留输入与分页且不误报空记录', async () => {
  await fixture(async ({ mount }) => {
    const page = mount('feedback'); page.onLoad({}); let result = { ok: false }, calls = [];
    page.client.send = async (action, payload) => { calls.push({ action, payload }); return result; };
    await page.onShow(); assert.match(page.data.historyError, /无法加载/); assert.equal(page.data.error, '');
    page.onInput({ detail: { value: '反馈历史失败时仍然保留这段输入' } });
    result = { ok: true, data: { items: [{ feedbackId: 'a', body: '已有反馈', createdAt: 10, category: 'idea' }], nextBefore: 'cursor' } };
    await page.onRetryHistory(); assert.equal(page.data.historyError, ''); assert.equal(page.data.items.length, 1);
    assert.equal(page.data.body, '反馈历史失败时仍然保留这段输入');
    result = { ok: false }; await page.onMore(); assert.equal(page.data.items.length, 1); assert.ok(page.data.historyError);
    result = { ok: true, data: { items: [{ feedbackId: 'b', body: '下一页', createdAt: 1, category: 'bug' }], nextBefore: null } };
    await page.onRetryHistory(); assert.deepEqual(calls.at(-1).payload, { before: 'cursor' });
    assert.deepEqual(page.data.items.map(item => item.feedbackId), ['a', 'b']);
    assert.equal(page.data.body, '反馈历史失败时仍然保留这段输入');
    const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/feedback/index.wxml'), 'utf8');
    assert.ok(wxml.indexOf('wx:elif="{{historyError}}"') < wxml.indexOf('还没有反馈记录。'));
    assert.ok(wxml.includes('bindtap="onRetryHistory"'));
  });
});

test('全量审查：成稿重新读取前清理旧 TXT，迟到写入只清理自身文件', async () => {
  await fixture(async ({ mount, app, items }) => {
    items.push(core.createInspiration({ id: 'idea', text: '需要留档的记录', now: 10 }));
    app.refreshAccount = async () => app.globalData.store;
    const removed = [], writes = [];
    global.wx.env = { USER_DATA_PATH: '/mock' };
    global.wx.getFileSystemManager = () => ({ writeFile: options => writes.push(options), unlink: options => removed.push(options.filePath) });
    const page = mount('output'); await page.onLoad({ id: 'idea' });
    page.onCreateTxt(); writes[0].success(); const oldFile = page.data.txtPath; assert.ok(oldFile);
    await page.readAccount(true); assert.deepEqual(removed, [oldFile]); assert.equal(page.data.txtPath, '');
    page.onCreateTxt(); const staleWrite = writes[1];
    await page.readAccount(true); page.onCreateTxt(); writes[2].success();
    const currentFile = page.data.txtPath; staleWrite.success();
    assert.equal(removed.at(-1), staleWrite.filePath);
    assert.notEqual(currentFile, staleWrite.filePath); assert.equal(page.data.txtPath, currentFile);
    page.onHide(); assert.equal(removed.at(-1), currentFile);
  });
});
