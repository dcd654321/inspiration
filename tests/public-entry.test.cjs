'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cloudConfig = require('../miniprogram/config/cloud');
const { createInspiration } = require('../miniprogram/core/inspiration');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const snapshot = () => ({ ok: true, data: {
  cacheScope: A, generation: 1, version: 1,
  inspirations: [{ id: 'idea', text: '已确认的灵感', updatedAt: 1, deletedAt: null, mergedInto: null }]
} });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function drive(readSnapshot = snapshot) {
  const appPath = require.resolve('../miniprogram/app');
  const previous = { App: global.App, wx: global.wx, Page: global.Page, getApp: global.getApp };
  const loadedPages = new Set();
  const state = { cloudInstances: 0, cloudInits: 0, calls: [], pulls: 0, localReads: 0, tabs: [] };
  let definition, networkListener;
  global.App = value => { definition = value; };
  global.wx = {
    cloud: {
      init() { throw Error('不得初始化默认云实例'); },
      callFunction() { throw Error('不得使用默认云实例'); },
      Cloud: class {
        constructor(options) {
          state.cloudInstances += 1;
          assert.deepEqual(options, { resourceAppid: cloudConfig.resourceAppid, resourceEnv: cloudConfig.envId });
        }
        async init() { state.cloudInits += 1; }
        async callFunction({ name, data }) {
          state.calls.push({ name, action: data.action });
          if (name === 'linggan_api') {
            assert.equal(data.action, 'snapshot.pull');
            state.pulls += 1;
            return { result: await readSnapshot(state.pulls) };
          }
          assert.equal(name, 'monitorApi');
          return { result: { success: true, data: {} } };
        }
      }
    },
    onNetworkStatusChange(listener) { networkListener = listener; },
    switchTab(options) { state.tabs.push(options); },
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    getStorageSync() { state.localReads += 1; throw Error('公开入口不得读取旧缓存'); },
    getStorageInfoSync() { state.localReads += 1; throw Error('公开入口不得扫描旧缓存'); },
    setStorageSync() { throw Error('不得写入持久快照'); }
  };
  delete require.cache[appPath];
  require(appPath);
  const app = { ...definition, globalData: { ...definition.globalData } };
  global.getApp = () => app;
  function mount(name) {
    const pagePath = require.resolve('../miniprogram/pages/' + name + '/index');
    let pageDefinition;
    global.Page = value => { pageDefinition = value; };
    delete require.cache[pagePath]; require(pagePath); loadedPages.add(pagePath);
    return { ...pageDefinition, data: structuredClone(pageDefinition.data || {}),
      setData(next) { Object.assign(this.data, next); } };
  }
  return { app, state, mount, network(status) { networkListener(status); }, async done() {
    app.onHide();
    await flush();
    for (const pagePath of loadedPages) delete require.cache[pagePath];
    delete require.cache[appPath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  } };
}

test('公开入口：冷启动、联网恢复与前台恢复均不初始化云或读取个人快照', async () => {
  const ctx = drive();
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    ctx.network({ isConnected: true });
    await flush();
    assert.equal(ctx.app.globalData.accountRequested, false);
    assert.equal(ctx.app.globalData.store, null);
    ctx.app.onHide(); ctx.app.onShow();
    ctx.network({ isConnected: true });
    await flush();
    assert.equal(ctx.state.cloudInstances, 0);
    assert.equal(ctx.state.cloudInits, 0);
    assert.equal(ctx.state.pulls, 0);
    assert.deepEqual(ctx.state.calls, []);
    assert.equal(ctx.state.localReads, 0);
  } finally { await ctx.done(); }
});

test('公开入口：进入业务页才准备可信账户，并发 ensureReady 共用一次拉取', async () => {
  const ctx = drive();
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    const first = ctx.app.ensureReady(), concurrent = ctx.app.ensureReady();
    assert.equal(first, concurrent);
    assert.equal(ctx.app.globalData.accountRequested, true);
    const store = await first;
    assert.equal(store, ctx.app.globalData.store);
    assert.equal(store.listInspirations()[0].text, '已确认的灵感');
    assert.equal(await ctx.app.ensureReady(), store);
    assert.equal(ctx.state.cloudInstances, 1);
    assert.equal(ctx.state.cloudInits, 1);
    assert.equal(ctx.state.pulls, 1);
    assert.equal(ctx.state.localReads, 0);
  } finally { await ctx.done(); }
});

test('公开入口：业务读取失败可在前台联网重试，公开恢复不自动重试', async () => {
  const ctx = drive(attempt => {
    if (attempt === 1) throw Error('NETWORK_FAILED');
    return snapshot();
  });
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    assert.equal(await ctx.app.ensureReady(), null);
    assert.equal(ctx.app.globalData.accountError, '暂时无法确认账户，请联网后重试。');
    ctx.network({ isConnected: false });
    assert.equal(ctx.state.pulls, 1);
    ctx.network({ isConnected: true });
    assert.ok(await ctx.app.globalData.readyPromise);
    assert.equal(ctx.state.pulls, 2);
    assert.equal(ctx.app.globalData.accountError, '');
    ctx.app.onHide();
    ctx.network({ isConnected: true });
    assert.equal(ctx.state.pulls, 2, '后台禁止触发账户重试');
    ctx.app.onShow(); ctx.network({ isConnected: true });
    await flush();
    assert.equal(ctx.state.pulls, 2, '回到公开页不延续上一次前台的账户请求');
    assert.equal(ctx.app.globalData.accountRequested, false);
    assert.equal(ctx.app.globalData.store, null);
    assert.ok(await ctx.app.ensureReady());
    assert.equal(ctx.state.pulls, 3, '再次进入业务页才重新确认账户');
  } finally { await ctx.done(); }
});

test('公开入口：后台前发出的旧快照返回后不绑定账户或触发公开页续读', async () => {
  const wait = deferred();
  const ctx = drive(() => wait.promise);
  try {
    const boundAccounts = [];
    ctx.app.operationsMonitor = { start() {}, end() {}, bindAccount(scope) { boundAccounts.push(scope); }, requestFinished() {} };
    ctx.app.onLaunch(); ctx.app.onShow();
    const pending = ctx.app.ensureReady();
    await flush();
    assert.equal(ctx.state.pulls, 1);
    ctx.app.onHide(); ctx.app.onShow();
    ctx.network({ isConnected: true });
    wait.resolve(snapshot());
    assert.equal(await pending, null);
    await flush();
    assert.equal(ctx.state.pulls, 1);
    assert.equal(ctx.app.globalData.accountRequested, false);
    assert.equal(ctx.app.globalData.store, null);
    assert.equal(ctx.app.globalData.readyPromise, null);
    assert.equal(ctx.app.globalData.cacheScope, '');
    assert.deepEqual(boundAccounts, []);
  } finally { wait.resolve(snapshot()); await ctx.done(); }
});

test('公开入口：真实 App 后台恢复后开始记录清除旧成功卡', async () => {
  const ctx = drive();
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    const page = ctx.mount('capture');
    await page.onShow();
    page.setData({ lastSavedId: 'idea', lastSavedExcerpt: '已确认的灵感' });
    page.onHide(); ctx.app.onHide(); ctx.app.onShow();
    const entryEpoch = ctx.app.globalData.sessionEpoch;
    ctx.mount('welcome').onStart();
    assert.equal(ctx.app.globalData.captureStartIntent.epoch, entryEpoch);
    await page.onShow();
    assert.equal(ctx.app.globalData.sessionEpoch, entryEpoch + 1, '业务页按需确认账户产生新 epoch');
    assert.equal(page.data.lastSavedId, '');
    assert.equal(page.data.lastSavedExcerpt, '');
    assert.equal(page.data.draftRecoveryNotice, '');
    assert.equal(page.data.draft, '');
    assert.equal(ctx.app.globalData.captureStartIntent, undefined);
    assert.equal(ctx.state.tabs[0].url, '/pages/capture/index');
  } finally { await ctx.done(); }
});

test('公开入口：真实 App 后台恢复后开始记录接续未提交与未知结果输入', async () => {
  for (const unknown of [false, true]) {
    const ctx = drive();
    try {
      ctx.app.onLaunch(); ctx.app.onShow();
      const page = ctx.mount('capture'); await page.onShow();
      const text = unknown ? '上一次保存结果尚未确认' : '写到一半的灵感';
      page.onInput({ detail: { value: text } });
      if (unknown) {
        page.pendingSave = { text, scope: A, generation: 1,
          item: createInspiration({ id: 'pending', text, now: 10 }) };
        page.setData({ status: 'unknown' });
      }
      page.onHide(); ctx.app.onHide(); ctx.app.onShow();
      ctx.mount('welcome').onStart();
      await page.onShow();
      assert.equal(page.data.draft, text);
      assert.equal(page.data.canSave, true);
      assert.equal(page.data.status, unknown ? 'unknown' : '');
      assert.equal(page.pendingSave && page.pendingSave.item.id, unknown ? 'pending' : undefined);
      assert.equal(ctx.state.pulls, 2);
      assert.equal(ctx.app.globalData.captureStartIntent, undefined);
    } finally { await ctx.done(); }
  }
});

test('公开入口：真实 App 后台前或已过期的记录意图不清除成功卡', async () => {
  const ctx = drive();
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    const page = ctx.mount('capture'); await page.onShow();
    page.setData({ lastSavedId: 'idea', lastSavedExcerpt: '已确认的灵感' });
    page.onHide(); ctx.mount('welcome').onStart();
    ctx.app.onHide(); ctx.app.onShow();
    await page.onShow();
    assert.equal(page.data.lastSavedId, 'idea', '后台前发出的意图不能跨 epoch 清除成功卡');
    ctx.app.globalData.captureStartIntent = { epoch: ctx.app.globalData.sessionEpoch, expiresAt: 0 };
    await page.onShow();
    assert.equal(page.data.lastSavedId, 'idea', '过期意图不改变成功卡');
  } finally { await ctx.done(); }
});

test('公开入口：真实 App 的迟到账户读取不使用旧意图改写新会话界面', async () => {
  const wait = deferred();
  const ctx = drive(attempt => attempt === 2 ? wait.promise : snapshot());
  try {
    ctx.app.onLaunch(); ctx.app.onShow();
    const page = ctx.mount('capture'); await page.onShow();
    page.setData({ lastSavedId: 'idea', lastSavedExcerpt: '已确认的灵感' });
    page.onHide(); ctx.app.onHide(); ctx.app.onShow();
    ctx.mount('welcome').onStart();
    const showing = page.onShow();
    await flush();
    assert.equal(ctx.state.pulls, 2);
    ctx.app.onHide(); ctx.app.onShow();
    assert.ok(await ctx.app.ensureReady());
    page.setData({ lastSavedId: 'new-session', lastSavedExcerpt: '新会话的已保存记录' });
    wait.resolve(snapshot()); await showing;
    assert.equal(page.data.lastSavedId, 'new-session');
    assert.equal(page.data.lastSavedExcerpt, '新会话的已保存记录');
    assert.equal(ctx.state.pulls, 3);
  } finally { wait.resolve(snapshot()); await ctx.done(); }
});
