'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createRepository, CODE } = require('../server/repository');
const { createProtocol } = require('../server/protocol');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { buildArchiveText } = require('../miniprogram/services/content-output');
const scope = 'a'.repeat(32);
const input = value => ({ detail: { value } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function sample() {
  let item = core.createInspiration({ id: 'idea', text: '正文初稿\n第二行', now: 1000 });
  item = core.appendSupplement(item, { id: 'sup_a', content: '补充初稿\n第二行', now: 2000 });
  return core.appendSupplement(item, { id: 'sup_b', content: '另一条补充', now: 3000 });
}
async function withHarness(run, seed = sample()) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const docs = new Map(), files = new Set(), state = { routes: [], writes: [], failWrite: false };
  const db = {
    get: async key => docs.has(key) ? structuredClone(docs.get(key)) : null,
    put: async (key, value) => docs.set(key, structuredClone(value)),
    compareAndSwap: async (key, version, value) => {
      if ((docs.get(key)?.version || 0) !== version) return false;
      docs.set(key, structuredClone(value)); return true;
    }
  };
  const repo = createRepository({ db, now: () => 10000 });
  const protocol = createProtocol({ repository: repo, now: () => 10000 });
  let seq = 0;
  const transport = { send(action, payload, meta) {
    if (action === 'snapshot.push') {
      state.writes.push(structuredClone(payload));
      if (state.failWrite) return Promise.resolve({ ok: false, code: 'NETWORK' });
    }
    return protocol.handle({ accountKey: scope }, { action, payload, requestId: meta?.requestId || 'read_' + (++seq) });
  } };
  async function freshStore() {
    const pulled = await transport.send('snapshot.pull', {});
    assert.equal(pulled.ok, true);
    return createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: pulled.data, transport });
  }
  const store = await freshStore();
  assert.deepEqual(await store.saveInspiration(seed), { ok: true, synced: true });
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: scope }, ensureReady: async () => app.globalData.store };
  try {
    global.getApp = () => app;
    global.wx = { navigateTo: options => state.routes.push(options.url), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} };
    async function createPage(name, query = { id: 'idea' }) {
      let definition; global.Page = value => { definition = value; };
      const file = require.resolve('../miniprogram/pages/' + name + '/index'); files.add(file);
      delete require.cache[file]; require(file);
      const page = { ...definition, data: structuredClone(definition.data),
        setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } };
      await page.onLoad(query); await flush(); return page;
    }
    await run({ createPage, app, store, freshStore, repo, state });
  } finally {
    for (const file of files) delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('修改记录：正文补充确认保存后重读完整，服务端拒绝删减历史', async () => {
  await withHarness(async ({ createPage, app, store, freshStore, repo }) => {
    const detail = await createPage('detail');
    for (const text of ['正文第二版', '正文第三版']) {
      detail.onStartEdit(); detail.onEditInput(input(text)); await detail.onSaveEdit(); await flush();
    }
    detail.openSupplementActions('sup_a'); detail.onSheetEdit();
    detail.onSupplementEditInput(input('补充第二版')); await detail.onSupplementEditSave(); await flush();
    assert.equal(detail.data.historyCount, 3);
    const reopened = await freshStore(); app.globalData.store = reopened;
    const item = reopened.getInspiration('idea');
    assert.deepEqual(item.textHistory.map(version => version.text), ['正文初稿\n第二行', '正文第二版']);
    assert.equal(item.supplements[0].contentHistory[0].content, '补充初稿\n第二行');
    const history = await createPage('history');
    assert.equal(history.data.versionCount, 3);
    assert.deepEqual(history.data.versions.map(version => version.text), ['正文第二版', '正文初稿\n第二行']);
    assert.equal(history.data.supplementHistories[0].versions[0].text, '补充初稿\n第二行');
    for (const changed of [{ ...item, textHistory: [] }, { ...item, supplements: item.supplements.map(supplement => ({ ...supplement, contentHistory: [] })) }]) {
      const result = await repo.push(scope, { ...reopened.getConfirmedRevision(), upserts: [changed] });
      assert.equal(result.ok, false); assert.equal(result.code, CODE.immutableViolation);
    }
    assert.deepEqual((await repo.pull(scope)).data.inspirations[0], item);
    assert.equal(store.getInspiration('idea').textHistory.length, 2);
  });
});

test('修改记录：仅补充修改也有总入口，单条与收起补充可定位', async () => {
  const seed = core.editSupplement(sample(), { supplementId: 'sup_a', content: '新补充', historyId: 'chg_a', now: 4000 });
  await withHarness(async ({ createPage, store, state }) => {
    const detail = await createPage('detail');
    assert.equal(detail.data.historyCount, 1);
    detail.onMoreHistory(); assert.equal(state.routes.pop(), '/pages/history/index?id=idea');
    detail.openSupplementActions('sup_a'); assert.equal(detail.data.sheetHistoryCount, 1);
    detail.onSheetHistory(); assert.equal(state.routes.pop(), '/pages/history/index?id=idea&supplementId=sup_a');
    const all = await createPage('history');
    assert.equal(all.data.versionCount, 1); assert.deepEqual(all.data.versions, []);
    assert.equal(all.data.supplementHistories[0].current, '新补充');
    const folded = core.foldIntoText(store.getInspiration('idea'), { supplementId: 'sup_a', historyId: 'fold_a', now: 5000 });
    await store.saveInspiration(folded); detail.load();
    detail.openSupplementActions('sup_a'); assert.equal(detail.data.sheetIsHidden, true);
    detail.onSheetHistory(); assert.match(state.routes.pop(), /supplementId=sup_a$/);
    const one = await createPage('history', { id: 'idea', supplementId: 'sup_a' });
    assert.equal(one.data.currentLabel, '当前补充'); assert.equal(one.data.current, '新补充');
    assert.equal(one.data.versionCount, 1); assert.equal(one.data.versions[0].text, '补充初稿\n第二行');
    assert.deepEqual(one.data.supplementHistories, []);
  }, seed);
});

test('修改记录：指定补充缺失与空历史明确，读取失败可重试', async () => {
  await withHarness(async ({ createPage, app, store }) => {
    const missing = await createPage('history', { id: 'idea', supplementId: 'gone' });
    assert.equal(missing.data.missingTitle, '找不到这条补充'); assert.equal(missing.data.current, '');
    assert.equal(missing.data.versionCount, 0); assert.deepEqual(missing.data.supplementHistories, []);
    const empty = await createPage('history', { id: 'idea', supplementId: 'sup_a' });
    assert.equal(empty.data.current, '补充初稿\n第二行'); assert.equal(empty.data.versionCount, 0);
    assert.match(empty.data.emptyHint, /这条补充还没有改过/);
    app.ensureReady = async () => { throw Error('read failed'); };
    await empty.load(); assert.equal(empty.data.readError, true); assert.equal(empty.data.missing, false);
    assert.equal(empty.data.current, ''); assert.deepEqual(empty.data.versions, []);
    app.ensureReady = async () => store; await empty.onRetryLoad();
    assert.equal(empty.data.readError, false); assert.equal(empty.data.current, '补充初稿\n第二行');
  });
});

test('修改记录：未知保存不增加历史数量，重试只保留一个旧版本', async () => {
  await withHarness(async ({ createPage, store, state }) => {
    const detail = await createPage('detail');
    detail.openSupplementActions('sup_a'); detail.onSheetEdit(); detail.onSupplementEditInput(input('待确认补充'));
    state.failWrite = true; await detail.onSupplementEditSave();
    assert.equal(detail.data.supplementEditUnknown, true); assert.equal(detail.data.historyCount, 0);
    assert.equal(detail.data.supplementEditDraft, '待确认补充');
    assert.equal(store.getInspiration('idea').supplements[0].contentHistory.length, 0);
    const attempted = state.writes.at(-1).upserts[0].supplements[0].contentHistory[0];
    state.failWrite = false; await detail.onSupplementEditSave(); await flush();
    assert.equal(detail.data.historyCount, 1);
    assert.deepEqual(store.getInspiration('idea').supplements[0].contentHistory, [attempted]);
  });
});

test('修改记录：隐藏账户变化及更新读取丢弃迟到正文和补充', async () => {
  const seed = core.editSupplement(sample(), { supplementId: 'sup_a', content: '私有新补充', historyId: 'chg_private', now: 4000 });
  for (const stale of ['hidden', 'account', 'newer']) await withHarness(async ({ createPage, app, store }) => {
    const page = await createPage('history'); assert.equal(page.data.supplementHistories.length, 1);
    const wait = deferred(); app.ensureReady = () => wait.promise;
    const loading = page.load();
    if (stale === 'hidden') page.onHide();
    if (stale === 'account') { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    if (stale === 'newer') {
      app.ensureReady = async () => store; page.supplementId = 'sup_b'; await page.load();
    }
    wait.resolve(store); await loading;
    assert.deepEqual(page.data.supplementHistories, []); assert.deepEqual(page.data.versions, []);
    assert.equal(page.data.versionCount, 0);
    assert.equal(page.data.current, stale === 'newer' ? '另一条补充' : '');
  }, seed);
});

test('修改记录留档：正常收起补充旧文字与换行完整，来源不变', () => {
  let item = core.updateText(sample(), { text: '正文新版', historyId: 'tex_old', now: 4000 });
  item = core.editSupplement(item, { supplementId: 'sup_a', content: '补充新版', historyId: 'chg_old', now: 5000 });
  item = core.editSupplement(item, { supplementId: 'sup_b', content: '收起补充新版', historyId: 'chg_hidden', now: 6000 });
  item = core.foldIntoText(item, { supplementId: 'sup_b', historyId: 'tex_fold', now: 7000 });
  const before = JSON.stringify(item), archive = buildArchiveText(item, 8000);
  for (const content of ['正文初稿\n第二行', '补充初稿\n第二行', '另一条补充', '收起补充新版', '修改于', '已并入正文']) assert.ok(archive.includes(content), content);
  assert.ok(!archive.includes('undefined')); assert.equal(JSON.stringify(item), before);
});
