'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../miniprogram/core/inspiration');
const { createSessionDrafts, draftContext, sourceVersion } = require('../miniprogram/services/session-drafts');
const A = 'a'.repeat(32), B = 'b'.repeat(32);
const context = { cacheScope: A, generation: 1 };
const input = (value) => ({ detail: { value } });
const toggle = (key) => ({ currentTarget: { dataset: { key } } });
function deferred() { let resolve; return { promise: new Promise((done) => { resolve = done; }), resolve: (value) => resolve(value) }; }

async function withPage(name, run) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  const state = { items: [core.createInspiration({ id: 'a', text: '写一份城市周末散步指南', now: 1000 }), core.createInspiration({ id: 'b', text: '为沿途咖啡馆准备地图', now: 2000 })], saves: [], copies: [], dialogs: [], deleted: [] };
  const memory = createSessionDrafts(); memory.bind(context);
  let app, definition;
  const makeStore = () => ({
    getConfirmedRevision: () => ({ generation: app.globalData.generation, baseVersion: 1 }),
    readSnapshot: () => ({ generation: app.globalData.generation, inspirations: state.items }),
    getInspiration: (id) => state.items.find((item) => item.id === id), listInspirations: () => state.items,
    saveInspiration: async (item) => { state.saves.push(structuredClone(item)); return state.save ? state.save(item) : { ok: true, synced: true }; },
    saveInspirations: async (items) => { state.saves.push(structuredClone(items)); return state.save ? state.save(items) : { ok: true, synced: true }; }
  });
  app = { globalData: { store: null, cacheScope: A, generation: 1, sessionEpoch: 1, sessionDrafts: memory }, ensureReady: async () => app.globalData.store, refreshAccount: async () => app.globalData.store };
  app.globalData.store = makeStore();
  function reconfirm(scope = A, generation = 1) {
    app.globalData.cacheScope = scope; app.globalData.generation = generation; app.globalData.sessionEpoch++;
    app.globalData.store = makeStore(); memory.bind({ cacheScope: scope, generation });
  }
  try {
    global.Page = (value) => { definition = value; }; global.getApp = () => app;
    global.wx = { enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, pageScrollTo() {}, navigateBack() {}, switchTab() {},
      showModal: (options) => state.dialogs.push(options),
      setClipboardData: (options) => { state.copies.push(options.data); options.success(); },
      getFileSystemManager: () => ({ unlink: ({ filePath }) => state.deleted.push(filePath) }) };
    delete require.cache[file]; require(file);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(next, done) { Object.assign(this.data, next); if (done) done(); } });
    if (name === 'capture') await page.onShow(); else await page.onLoad({ id: 'a', scope: 'expand' });
    const prepare = async () => {
      if (name === 'capture') page.onInput(input('未提交的私密记录'));
      else if (name === 'output') page.onDraftInput(input('手工编辑的私密稿件'));
      else if (name === 'material-output') { page.onToggle(toggle('b:text')); page.onToggle(toggle('a:text')); page.onGenerate(); page.onInput(input('跨素材编辑的私密稿件')); }
    };
    await run({ page, state, app, reconfirm, prepare, memory });
  } finally {
    delete require.cache[file]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('会话恢复：容器限定受信账户代际且有容量和期限，进程新实例不恢复', () => {
  let time = 0;
  const drafts = createSessionDrafts({ now: () => time, maxEntries: 2, maxAge: 100 }); drafts.bind(context);
  drafts.put('one', context, { text: '甲' }); drafts.put('two', context, { text: '乙' }); drafts.put('three', context, { text: '丙' });
  assert.equal(drafts.get('one', context), null); assert.equal(drafts.get('two', context).text, '乙');
  const copy = drafts.get('two', context); copy.text = '改动'; assert.equal(drafts.get('two', context).text, '乙');
  assert.equal(drafts.put('foreign', { cacheScope: B, generation: 1 }, { text: '跨账户' }), false);
  time = 100; assert.equal(drafts.get('two', context), null);
  drafts.put('old', context, { text: '旧代际' }); drafts.bind({ cacheScope: A, generation: 2 }); assert.equal(drafts.get('old', context), null);
  const fresh = createSessionDrafts(); fresh.bind(context); assert.equal(fresh.get('old', context), null);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../miniprogram/services/session-drafts'), 'utf8'), /setStorage|saveFile|writeFile|wx\./);
  assert.equal(draftContext({ globalData: { cacheScope: A, store: {} } }, {}), null);
});

test('会话恢复：三类页面同账户恢复全文选材顺序模板，确认前无私人内容', async () => {
  for (const name of ['capture', 'output', 'material-output']) await withPage(name, async ({ page, state, app, reconfirm, prepare }) => {
    await prepare(); if (name === 'output') page.setData({ txtPath: '/private/tmp.txt' });
    const before = structuredClone(page.data), order = page.selected && page.selected.map((part) => part.key);
    page.onHide(); assert.equal(page.data.draft, '');
    reconfirm(); const wait = deferred(); app.ensureReady = () => wait.promise;
    const showing = page.onShow(); assert.equal(page.data.draft, '');
    wait.resolve(app.globalData.store); await showing;
    assert.equal(page.data.draft, before.draft);
    if (order) assert.deepEqual(page.selected.map((part) => part.key), order);
    assert.match(page.data.draftRecoveryNotice, /接续/); assert.equal(state.saves.length, 0);
    if (name === 'output') { assert.deepEqual(state.deleted, ['/private/tmp.txt']); assert.equal(page.data.txtPath, ''); }
  });
});

test('会话恢复：跨账户或代际清稿，读取失败不暴露旧稿', async () => {
  for (const name of ['capture', 'output', 'material-output']) for (const kind of ['account', 'generation', 'failed']) await withPage(name, async ({ page, app, reconfirm, prepare }) => {
    await prepare(); page.onHide(); reconfirm(kind === 'account' ? B : A, kind === 'generation' ? 2 : 1);
    if (kind === 'failed') { app.globalData.store = null; app.ensureReady = async () => null; }
    await page.onShow();
    assert.doesNotMatch(page.data.draft || '', /私密/);
    assert.equal(page.data.draftRecoveryNotice, '');
  });
});

test('会话恢复：来源更新保留复制而拒绝旧来源另存，重新读取须明确替换', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, async ({ page, state, reconfirm, prepare }) => {
    await prepare(); const before = page.data.draft; page.onHide();
    state.items[0] = core.updateText(state.items[0], { text: '来源更新后的文字', historyId: 'h', now: 3000 }); reconfirm(); await page.onShow();
    assert.equal(page.data.sourceStale, true);
    if (name === 'output') { page.onCopyDraft(); await page.onSaveAsNew(); page.onOpenContent(); }
    else { page.onCopy(); await page.onSave(); page.onBackToSelection(); }
    assert.equal(state.saves.length, 0); assert.ok(state.copies[0].includes(before)); assert.equal(state.dialogs.length, 1);
    state.dialogs[0].success({ confirm: false }); assert.equal(page.data.sourceStale, true);
    page.onHide(); reconfirm(); await page.onShow(); assert.equal(page.data.sourceStale, true, '重复后台不能解除来源阻断');
    if (name === 'output') page.onOpenContent();
    else page.onBackToSelection();
    state.dialogs[1].success({ confirm: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.sourceStale, false); assert.equal(page.data.saveUnknown, false);
    if (name === 'output') assert.match(page.data.draft, /来源更新/);
    if (name === 'material-output') { assert.equal(page.data.draft, ''); assert.equal(page.selected.length, 0); }
  });
});

test('会话恢复：未知另存跨后台锁定内容并复用同一产物，旧回执不回填', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, async ({ page, state, reconfirm, prepare }) => {
    await prepare(); const wait = deferred(); state.save = () => wait.promise;
    const save = () => name === 'output' ? page.onSaveAsNew() : page.onSave();
    const first = save(); const firstItem = state.saves[0]; page.onHide(); reconfirm(); await page.onShow();
    assert.equal(page.data.saveUnknown, true);
    if (name === 'output') page.onDraftInput(input('不能改动'));
    if (name === 'material-output') page.onInput(input('不能改动'));
    assert.doesNotMatch(page.data.draft, /不能改动/);
    wait.resolve({ ok: true, synced: true }); await first; assert.equal(page.data.savedId, '');
    state.save = async () => ({ ok: true, synced: true }); await save();
    assert.deepEqual(state.saves[1], firstItem); assert.ok(page.data.savedId);
  });
});

test('可写入口：记录页慢账户读取期间即可输入，确认保存仍等待可信账户', async () => {
  await withPage('capture', async ({ page, app }) => {
    page.onHide(); const wait = deferred(); app.ensureReady = () => wait.promise;
    const showing = page.onShow(); page.onInput(input('读取期间的新想法')); assert.equal(page.data.draft, '读取期间的新想法'); assert.equal(page.data.canSave, true);
    wait.resolve(app.globalData.store); await showing; assert.equal(page.data.draft, '读取期间的新想法');
  });
});

test('会话恢复：旧账户读取失败或空回执不结束新账户页面状态', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, async ({ page, app }) => {
    page.onHide(); const wait = deferred(); app.ensureReady = () => wait.promise;
    const loading = page.onShow(); app.globalData.sessionEpoch++; app.globalData.store = null;
    wait.resolve(null); await loading;
    assert.equal(page.data.ready, false); assert.equal(page.data.error, '');
  });
});

test('会话恢复：回读确认已提交产物结束未知状态，不重复另存', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, async ({ page, state, reconfirm, prepare }) => {
    await prepare(); const wait = deferred(); state.save = () => wait.promise;
    const save = () => name === 'output' ? page.onSaveAsNew() : page.onSave();
    const first = save(); const items = Array.isArray(state.saves[0]) ? state.saves[0] : [state.saves[0]];
    page.onHide(); state.items = state.items.filter((entry) => !items.some((item) => item.id === entry.id)).concat(items);
    reconfirm(); await page.onShow(); assert.equal(page.data.saveUnknown, false); assert.ok(page.data.savedId);
    await save(); assert.equal(state.saves.length, 1);
    wait.resolve({ ok: true, synced: true }); await first;
  });
});
