'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { renderPosters } = require('../miniprogram/services/share-poster');
const sharedCloud = require('./helpers/shared-cloud.cjs');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(setImmediate);
const input = (value) => ({ detail: { value } });
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const list = (items = [], nextBefore = null) => ({ ok: true, data: { items, nextBefore } });
const share = () => ({ ok: true, data: { token: 'A'.repeat(28), preview: { title: '合成标题', body: '合成正文' } } });

async function withPage(name, run, { initialize = true } = {}) {
  const old = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const file = require.resolve(path.join('..', 'miniprogram', 'pages', name, 'index.js'));
  let definition;
  let item = core.createInspiration({ id: 'idea', text: '合成正文，供异步回执验证使用', now: 1000 });
  item = core.appendSupplement(item, { id: 's1', content: '合成补充', now: 1100 });
  const state = { calls: [], modals: [], album: [], removed: [], written: [], routes: [], toasts: [], sheets: [], copies: [], deletes: [] };
  state.send = async (action) => action.endsWith('listMine') ? list() :
    action === 'share.get' ? { ok: true, data: { title: '合成标题', body: '合成正文', createdAt: 1000 } } : share();
  const store = { getInspiration: () => item, getConfirmedRevision: () => ({ baseVersion: 1, generation: 1 }),
    async deleteInspiration(id) { state.deletes.push(id); return state.delete ? state.delete() : { ok: true, synced: true }; },
    async deletePhoto(id, photo) { state.deletes.push([id, photo]); return state.delete ? state.delete() : { ok: true, synced: true }; } };
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: 'a'.repeat(32) }, ensureReady: async () => store };
  try {
    global.Page = (p) => { definition = p; }; global.getApp = () => app;
    global.wx = {
      cloud: sharedCloud({ callFunction: async ({ data }) => {
        state.calls.push(data); return { result: await state.send(data.action, data.payload, data.requestId) };
      } }),
      env: { USER_DATA_PATH: '/tmp' },
      showModal: (o) => state.modals.push(o),
      showActionSheet: (o) => state.sheets.push(o),
      setClipboardData: (o) => state.copies.push(o),
      showToast: (o) => state.toasts.push(o.title),
      navigateTo: (o) => state.routes.push(o.url),
      navigateBack: () => state.routes.push('back'),
      getFileSystemManager: () => ({
        writeFile: (o) => { state.written.push(o.filePath); o.success(); },
        unlink: (o) => state.removed.push(o.filePath)
      }),
      saveImageToPhotosAlbum: (o) => state.album.push(o)
    };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(d) { Object.assign(this.data, d); } };
    if (initialize) {
      if (name === 'my-shares' || name === 'capture') await page.onShow();
      else {
        await page.onLoad({ id: 'idea', t: 'A'.repeat(28) });
        if (name === 'feedback') await page.onShow();
      }
    }
    state.calls = [];
    await run({ page, app, store, state });
  } finally {
    delete require.cache[file];
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete global[k]; else global[k] = v; }
  }
}

test('全量复核：反馈账户准备期间只提交冻结快照且失败复用请求', async () => {
  await withPage('feedback', async ({ page, app, store, state }) => {
    page.data.reporting = false; page.onInput(input('这是完整的反馈建议，至少十字'));
    const ready = deferred(); app.ensureReady = () => ready.promise;
    state.send = async (action) => action.endsWith('listMine') ? list() : { ok: false, message: '稍后重试' };
    const sending = page.onSubmit();
    assert.equal(page.data.busy, true);
    page.onInput(input('等待期间不应替换已提交内容')); page.onCategory(event('value', 'bug'));
    await page.onSubmit(); ready.resolve(store); await sending;
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].payload.body, '这是完整的反馈建议，至少十字');
    assert.equal(state.calls[0].payload.category, 'idea');
    assert.equal(page.data.category, 'idea');
    const request = state.calls[0].requestId;
    app.ensureReady = async () => store;
    state.send = async (action) => action.endsWith('listMine') ? list() : { ok: true, data: {} };
    await page.onSubmit();
    assert.equal(state.calls[1].requestId, request);
    assert.equal(page.data.body, ''); assert.equal(page.data.notice, '反馈已收到。');
  });
});

test('全量复核：反馈迟到回执不清空新页面或账户输入', async () => {
  for (const change of ['page', 'account']) await withPage('feedback', async ({ page, app, state }) => {
    page.onInput(input('这是旧页面的反馈内容，需要保留'));
    const pending = deferred(); state.send = () => pending.promise;
    const sending = page.onSubmit(); await flush();
    if (change === 'page') {
      page.onHide(); state.send = async () => list(); await page.onShow();
    } else { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    page.setData({ body: '新账户或页面输入', notice: '新状态' });
    pending.resolve({ ok: true, data: {} }); await sending;
    assert.equal(page.data.body, '新账户或页面输入'); assert.equal(page.data.notice, '新状态');
  });
});

test('全量复核：反馈隐藏后新账户清空原账户输入和记录', async () => {
  await withPage('feedback', async ({ page, app, store }) => {
    page.onInput(input('原账户反馈输入不应出现在新账户'));
    page.submitRequestId = 'old'; page.onHide();
    const nextStore = { ...store }; app.globalData.store = nextStore; app.globalData.sessionEpoch++;
    app.ensureReady = async () => nextStore; await page.onShow();
    assert.equal(page.data.body, ''); assert.equal(page.submitRequestId, ''); assert.deepEqual(page.data.items, []);
  });
});

test('全量复核：分享准备等待锁定选择重复操作只创建一次', async () => {
  await withPage('share-preview', async ({ page, app, store, state }) => {
    const pending = deferred(); app.ensureReady = () => pending.promise;
    const preparing = page.onPrepareChat(); assert.equal(page.data.busy, true);
    page.onToggle(event('id', 's1')); await page.onPrepareChat();
    assert.equal(page.data.options[0].selected, true);
    pending.resolve(store); await preparing;
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0].action, 'share.create');
    assert.deepEqual(state.calls[0].payload.selectedSupplementIds, ['s1']);
    assert.equal(page.data.chatPrepared, true);
  });
});

test('全量复核：分享准备回执跨页面和账户不能复活令牌', async () => {
  for (const change of ['page', 'account']) await withPage('share-preview', async ({ page, app, state }) => {
    const pending = deferred(); state.send = () => pending.promise;
    const preparing = page.onPrepareChat(); await flush();
    if (change === 'page') { page.onHide(); await page.onShow(); }
    else { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    page.setData({ notice: '新状态' }); pending.resolve(share()); await preparing;
    assert.equal(page.data.chatPrepared, false); assert.equal(page.preparedToken, '');
    assert.equal(page.data.notice, '新状态'); assert.equal(page.onShareAppMessage().path, '/pages/welcome/index');
  });
});

test('全量复核：已准备聊天令牌在会话变化后不能发送', async () => {
  await withPage('share-preview', async ({ page, app }) => {
    await page.onPrepareChat(); assert.match(page.onShareAppMessage().path, /shared/);
    app.globalData.sessionEpoch++;
    assert.equal(page.onShareAppMessage().path, '/pages/welcome/index');
  });
});

test('全量复核：分页重复操作只读取一次并消除重叠条目', async () => {
  for (const name of ['feedback', 'my-shares']) await withPage(name, async ({ page, state }) => {
    const id = name === 'feedback' ? 'feedbackId' : 'shareId';
    page.setData({ items: [{ [id]: 'one' }], nextBefore: 'cursor' });
    const pending = deferred(); state.send = () => pending.promise;
    const loading = page.onMore(); await page.onMore(); await flush();
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0].payload.before, 'cursor');
    pending.resolve(list([{ [id]: 'one', createdAt: 1000 }, { [id]: 'two', createdAt: 1001 }]));
    await loading; assert.deepEqual(page.data.items.map((x) => x[id]), ['one', 'two']);
  });
});

test('全量复核：列表旧读取不覆盖返回页面的新记录', async () => {
  for (const name of ['feedback', 'my-shares']) await withPage(name, async ({ page, state }) => {
    const id = name === 'feedback' ? 'feedbackId' : 'shareId', pending = deferred();
    state.send = () => pending.promise; const old = page.load(true); await flush();
    page.onHide(); state.send = async () => list([{ [id]: 'new', createdAt: 1000 }]); await page.onShow();
    pending.resolve(list([{ [id]: 'old', createdAt: 1000 }])); await old;
    assert.deepEqual(page.data.items.map((x) => x[id]), ['new']);
  });
});

test('全量复核：撤销确认离开或换账户不发送且重复确认被锁定', async () => {
  for (const change of ['page', 'account', 'cancel']) await withPage('my-shares', async ({ page, app, state }) => {
    page.onRevoke(event('id', 'old')); page.onRevoke(event('id', 'old'));
    assert.equal(state.modals.length, 1); assert.equal(page.data.busy, true);
    if (change === 'page') page.onHide();
    if (change === 'account') { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    await state.modals[0].success({ confirm: change !== 'cancel' });
    assert.equal(state.calls.length, 0);
    if (change === 'cancel') assert.equal(page.data.busy, false);
  });
});

test('全量复核：撤销迟到回执不刷新新页面', async () => {
  await withPage('my-shares', async ({ page, state }) => {
    const pending = deferred(); state.send = () => pending.promise;
    page.onRevoke(event('id', 'old')); const revoking = state.modals[0].success({ confirm: true }); await flush();
    page.onHide(); state.send = async () => list([{ shareId: 'new', createdAt: 1000 }]); await page.onShow();
    const count = state.calls.length; pending.resolve({ ok: true }); await revoking;
    assert.equal(state.calls.length, count); assert.equal(page.data.items[0].shareId, 'new');
  });
});

test('全量复核：接收分享迟到读取不覆盖新令牌页面', async () => {
  await withPage('shared', async ({ page, state }) => {
    const pending = deferred(); state.send = () => pending.promise; const old = page.load(); await flush();
    page.onHide(); state.send = async () => ({ ok: true, data: { title: '新标题', body: '新正文', createdAt: 1000 } });
    page.token = 'B'.repeat(28); await page.onShow();
    pending.resolve({ ok: true, data: { title: '旧标题', body: '旧正文', createdAt: 1000 } }); await old;
    assert.equal(page.data.body, '新正文');
  });
});

test('全量复核：私人读取账户准备过期不展示或下载旧内容', async () => {
  for (const name of ['history', 'photo-viewer', 'share-preview']) await withPage(name, async ({ page, app, store }) => {
    const pending = deferred(); app.ensureReady = () => pending.promise;
    const loading = page.onLoad({ id: 'idea' });
    app.globalData.sessionEpoch++; app.globalData.store = { ...store };
    pending.resolve(store); await loading;
    if (name === 'history') { assert.equal(page.data.current, ''); assert.deepEqual(page.data.versions, []); }
    if (name === 'photo-viewer') assert.deepEqual(page.data.photos, []);
    if (name === 'share-preview') { assert.equal(page.data.preview, ''); assert.deepEqual(page.data.options, []); }
  });
});

test('全量复核：私人读取失败有重试入口返回后读取新会话', async () => {
  for (const name of ['history', 'photo-viewer', 'share-preview']) await withPage(name, async ({ page, app, store }) => {
    app.ensureReady = async () => { throw Error('OFFLINE'); }; await page.onLoad({ id: 'idea' });
    if (name === 'history') assert.equal(page.data.readError, true);
    if (name === 'photo-viewer') assert.equal(page.data.loading, false);
    if (name === 'share-preview') assert.equal(page.data.missing, true);
    page.onHide(); app.ensureReady = async () => store; await page.onShow();
    if (name === 'history') assert.equal(page.data.current, store.getInspiration().text);
    if (name === 'photo-viewer') assert.equal(page.data.error, '没有可查看的照片。');
    if (name === 'share-preview') assert.match(page.data.preview, /合成正文/);
  });
});

test('全量复核：海报二维码迟到不创建文件或覆盖新页面', async () => {
  await withPage('share-preview', async ({ page, state }) => {
    const pending = deferred(); state.send = () => pending.promise;
    const making = page.makePoster('A'.repeat(28), { body: '合成正文', title: '合成标题' }); await flush();
    page.onHide(); await page.onShow(); page.setData({ notice: '新状态' });
    pending.resolve({ ok: true, data: { pngBase64: 'cXI=' } }); await making;
    assert.deepEqual(state.written, []); assert.equal(page.data.posterReady, false); assert.equal(page.data.notice, '新状态');
  });
});

test('全量复核：相册保存冻结来源离开后停止剩余图片', async () => {
  await withPage('share-preview', async ({ page, state }) => {
    page.setData({ posterReady: true, posterFiles: ['/tmp/one', '/tmp/two'] });
    const saving = page.onSavePosters();
    page.onToggle(event('id', 's1')); await page.onMakePoster();
    assert.equal(page.data.options[0].selected, true); assert.equal(state.calls.length, 0);
    assert.equal(state.album.length, 1);
    page.onHide(); await page.onShow(); page.setData({ notice: '新状态' });
    state.album[0].success(); await saving;
    assert.equal(state.album.length, 1); assert.equal(page.savedPosterCount, 0); assert.equal(page.data.notice, '新状态');
  });
});

test('全量复核：相册失败续传只保存未完成的图片', async () => {
  await withPage('share-preview', async ({ page, state }) => {
    page.setData({ posterReady: true, posterFiles: ['/tmp/one', '/tmp/two'] });
    const first = page.onSavePosters(); state.album[0].success(); await flush();
    state.album[1].fail({}); await first;
    assert.equal(page.savedPosterCount, 1); assert.equal(page.data.allSaved, false);
    const retry = page.onSavePosters(); assert.equal(state.album[2].filePath, '/tmp/two');
    state.album[2].success(); await retry;
    assert.equal(page.data.allSaved, true); assert.equal(page.savedPosterCount, 2);
  });
});

test('全量复核：海报绘制过期停止后续页并清理自身临时文件', async () => {
  const old = global.wx; let current = true, drawn = 0; const removed = [];
  try {
    global.wx = {
      getFileSystemManager: () => ({ writeFile: (o) => o.success(), unlink: (o) => removed.push(o.filePath) }),
      createCanvasContext: () => ({
        setFillStyle() {}, fillRect() {}, setFontSize() {}, fillText() {}, setStrokeStyle() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, draw(_r, cb) { drawn++; cb(); }
      }),
      canvasToTempFilePath: (o) => { current = false; o.success({ tempFilePath: '/tmp/old-one' }); }
    };
    await assert.rejects(renderPosters({}, '正文'.repeat(400), '标题', 'cXI=', '/tmp/old-code', () => current), /STALE_PAGE/);
    assert.equal(drawn, 1); assert.deepEqual(removed.sort(), ['/tmp/old-code', '/tmp/old-one']);
  } finally { global.wx = old; }
});

test('全量复核：详情删除迟到回执不返回新页面且重复删除被锁定', async () => {
  for (const change of ['page', 'account']) await withPage('detail', async ({ page, app, state }) => {
    const pending = deferred(); state.delete = () => pending.promise;
    const deleting = page.performDelete(); await page.performDelete();
    assert.deepEqual(state.deletes, ['idea']);
    if (change === 'page') { page.onHide(); await page.onShow(); }
    else { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    page.setData({ error: '新页面状态' }); pending.resolve({ ok: true, synced: true }); await deleting;
    assert.equal(state.routes.length, 0); assert.equal(page.data.error, '新页面状态');
  });
});

test('全量复核：详情删除异常和未确认不宣称记录仍在', async () => {
  await withPage('detail', async ({ page, state }) => {
    state.delete = async () => { throw Error('NETWORK'); }; await page.performDelete();
    assert.equal(page.data.pending, ''); assert.match(page.data.error, /尚未确认删除/);
    assert.doesNotMatch(page.data.error, /记录仍在/); assert.equal(state.routes.length, 0);
    state.delete = async () => ({ ok: true, synced: true }); await page.performDelete();
    assert.deepEqual(state.routes, ['back']);
  });
});

test('全量复核：详情照片确认重复操作锁定过期确认不删除', async () => {
  for (const change of ['page', 'account', 'cancel']) await withPage('detail', async ({ page, app, state }) => {
    page.onDeletePhoto(event('id', 'photo')); page.onDeletePhoto(event('id', 'photo'));
    assert.equal(state.modals.length, 1);
    if (change === 'page') { page.onHide(); await page.onShow(); }
    if (change === 'account') { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    await state.modals[0].success({ confirm: change !== 'cancel' }); assert.deepEqual(state.deletes, []);
    if (change === 'cancel') assert.equal(page.data.photoBusy, false);
  });
});

test('全量复核：旧账户详情操作安全停止且旧复制菜单不取内容', async () => {
  await withPage('detail', async ({ page, app, state }) => {
    page.onCopyContent(); assert.equal(state.sheets.length, 1);
    app.globalData.sessionEpoch++; app.globalData.store = null;
    state.sheets[0].success({ tapIndex: 0 });
    assert.equal(state.copies.length, 0);
    await page.onSaveOrganization(); await page.onRestoreInspiration();
    await page.onSheetFold(); await page.onSheetRestore(); await page.performDelete();
    page.onOpenSource(event('id', 'idea')); assert.equal(state.deletes.length, 0);
  });
});

test('全量复核：复制迟到反馈不污染重新进入的记录页或详情页', async () => {
  for (const name of ['capture', 'detail']) await withPage(name, async ({ page, state }) => {
    if (name === 'capture') { page.onInput(input('未保存的合成正文')); page.onCopyDraft(); }
    else page.copyText('合成正文');
    assert.equal(state.copies.length, 1);
    page.onHide(); await page.onShow(); page.setData({ copyNotice: '新提示' });
    state.copies[0].success();
    assert.equal(page.data.copyNotice, '新提示'); assert.deepEqual(state.toasts, []);
  });
});

test('全量复核：私人读取初次等待时账户切换可重新加载', async () => {
  for (const name of ['history', 'photo-viewer', 'share-preview', 'shared']) await withPage(name, async ({ page, app, store, state }) => {
    const pending = deferred(); app.ensureReady = () => pending.promise;
    const loading = page.onLoad({ id: 'idea', t: 'A'.repeat(28) });
    app.globalData.sessionEpoch++; const fresh = { ...store }; app.globalData.store = fresh;
    app.ensureReady = async () => fresh; await page.onShow(); pending.resolve(store); await loading;
    if (name === 'history') assert.equal(page.data.current, store.getInspiration().text);
    if (name === 'photo-viewer') assert.equal(page.data.loading, false);
    if (name === 'share-preview') assert.match(page.data.preview, /合成正文/);
    if (name === 'shared') assert.equal(page.data.body, '合成正文');
  });
});

test('全量复核：修改记录数量和空态随当前记录更新', async () => {
  await withPage('history', async ({ page, store }) => {
    assert.equal(page.data.versionCount, 0); assert.deepEqual(page.data.versions, []);
    let item = { ...store.getInspiration(), textHistory: [
      { id: 'oldest', text: '最早的正文', replacedAt: 1000 },
      { id: 'latest', text: '最近的旧正文', replacedAt: 2000 }
    ] };
    store.getInspiration = () => item;
    await page.load();
    assert.equal(page.data.versionCount, 2);
    assert.deepEqual(page.data.versions.map((x) => x.id), ['latest', 'oldest']);
    item = { ...item, textHistory: [] }; await page.load();
    assert.equal(page.data.versionCount, 0); assert.deepEqual(page.data.versions, []);
    page.onHide(); assert.equal(page.data.versionCount, 0);
  });
});
