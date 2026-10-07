'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { createCaptureDrafts } = require('../miniprogram/services/capture-drafts');

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const input = (value) => ({ detail: { value } });
const template = (value) => ({ currentTarget: { dataset: { template: value } } });
async function withPage(name, run) {
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  const old = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const state = { items: [core.appendSupplement(core.createInspiration({ id: 'ins_refine', text: '最初的正文', now: 1000 }), { id: 'sup_refine', content: '最初的补充', now: 2000 })], saves: [], modals: [], alerts: [], copies: [], routes: [] };
  const store = { getInspiration: (id) => state.items.find((x) => x.id === id), listInspirations: () => state.items,
    async saveInspiration(next) {
      state.saves.push(next);
      const result = state.save ? await state.save(next) : { ok: true, synced: true };
      if (result && result.ok && result.synced) state.items = state.items.filter((x) => x.id !== next.id).concat([next]);
      return result;
    } };
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: 'a'.repeat(32), drafts: createCaptureDrafts() }, ensureReady: async () => app.globalData.store };
  let definition;
  try {
    global.Page = (value) => { definition = value; }; global.getApp = () => app;
    global.wx = { enableAlertBeforeUnload: (opts) => state.alerts.push(opts.message), disableAlertBeforeUnload() {},
      showModal: (opts) => state.modals.push(opts), showToast() {}, pageScrollTo() {},
      navigateTo: (opts) => state.routes.push(opts.url),
      setClipboardData: (opts) => { state.copies.push(opts.data); opts.success(); } };
    delete require.cache[file]; require(file);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(next, done) { Object.assign(this.data, next); if (done) done(); } });
    if (name === 'capture') await page.onShow(); else await page.onLoad({ id: 'ins_refine' });
    await run({ page, state, app, store });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}
function startEdit(page, kind, value) {
  if (kind === 'text') { page.onStartEdit(); page.onEditInput(input(value)); }
  else { page.openSupplementActions('sup_refine'); page.onSheetEdit(); page.onSupplementEditInput(input(value)); }
}
function saveEdit(page, kind) { return kind === 'text' ? page.onSaveEdit() : page.onSupplementEditSave(); }
function editValue(page, kind) { return kind === 'text' ? page.data.editDraft : page.data.supplementEditDraft; }

test('体验优化：正文与补充修改冻结快照失败保留并可重试', async () => {
  for (const kind of ['text', 'supplement']) await withPage('detail', async ({ page, state }) => {
    const wait = deferred(); state.save = () => wait.promise;
    startEdit(page, kind, '修改 A'); const saving = saveEdit(page, kind);
    if (kind === 'text') page.onEditInput(input('修改 B')); else page.onSupplementEditInput(input('修改 B'));
    await saveEdit(page, kind); page.onOpenOutput(); page.onOpenMore(); page.onLocateCompose();
    assert.equal(editValue(page, kind), '修改 A'); assert.equal(state.saves.length, 1); assert.equal(state.routes.length, 0); assert.equal(page.data.moreVisible, false);
    wait.resolve({ ok: false, code: 'NETWORK' }); await saving;
    assert.equal(page.data.pending, ''); assert.equal(editValue(page, kind), '修改 A');
    const error = kind === 'text' ? page.data.editError : page.data.supplementEditError;
    assert.match(error, /尚未确认保存/);
    state.save = async () => ({ ok: true, synced: true }); await saveEdit(page, kind);
    assert.equal(kind === 'text' ? state.items[0].text : state.items[0].supplements[0].content, '修改 A');
    assert.equal(page.data.editing, false); assert.equal(page.data.editingSupplementId, '');
  });
});

test('体验优化：修改旧页面及账户回执不改变新输入', async () => {
  for (const kind of ['text', 'supplement']) for (const stale of ['hidden', 'returned', 'account']) await withPage('detail', async ({ page, state, app }) => {
    const wait = deferred(); state.save = () => wait.promise;
    startEdit(page, kind, '提交旧修改'); const saving = saveEdit(page, kind);
    if (stale === 'account') { app.globalData.store = {}; app.globalData.sessionEpoch++; }
    else { page.onHide(); if (stale === 'returned') { page.visible = true; page.viewVersion++; } }
    page.setData({ editing: true, editingSupplementId: 'new', editDraft: '当前正文输入', supplementEditDraft: '当前补充输入', pending: '' });
    wait.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.editDraft, '当前正文输入'); assert.equal(page.data.supplementEditDraft, '当前补充输入');
    assert.equal(page.data.editing, true); assert.equal(page.data.editingSupplementId, 'new'); assert.equal(page.data.pending, '');
  });
});

test('体验优化：未确认和明确拒绝区分且复制当前输入不报保存', async () => {
  for (const kind of ['text', 'supplement']) await withPage('detail', async ({ page, state }) => {
    startEdit(page, kind, '需要保留的修改'); assert.equal(state.alerts.length, 1);
    state.save = async () => null; await saveEdit(page, kind);
    assert.match(kind === 'text' ? page.data.editError : page.data.supplementEditError, /尚未确认保存/);
    page.onCopyUnsaved({ currentTarget: { dataset: { kind: kind === 'text' ? 'text' : 'editSupplement' } } });
    assert.deepEqual(state.copies, ['需要保留的修改']); assert.equal(editValue(page, kind), '需要保留的修改');
    state.save = async () => ({ ok: false, code: 'INVALID_PAYLOAD' }); await saveEdit(page, kind);
    const error = kind === 'text' ? page.data.editError : page.data.supplementEditError;
    assert.match(error, /未能保存修改/); assert.doesNotMatch(error, /空间|尚未确认/);
    assert.equal(state.items[0].text, '最初的正文'); assert.equal(state.items[0].supplements[0].content, '最初的补充');
  });
});

test('体验优化：修改重试复用历史标识回读确认后不重复历史', async () => {
  for (const kind of ['text', 'supplement']) await withPage('detail', async ({ page, state }) => {
    startEdit(page, kind, '同一次修改'); state.save = async () => ({ ok: false, code: 'NETWORK' });
    await saveEdit(page, kind); await saveEdit(page, kind);
    const history = (item) => kind === 'text' ? item.textHistory : item.supplements[0].contentHistory;
    assert.deepEqual(history(state.saves[0]), history(state.saves[1]));
    state.items = [state.saves[0]]; state.save = async () => ({ ok: true, synced: true }); await saveEdit(page, kind);
    assert.equal(history(state.items[0]).length, 1); assert.equal(page.data.pending, '');
  });
});

test('体验优化：记录账户准备和保存期间只提交一个输入快照', async () => {
  await withPage('capture', async ({ page, state, app, store }) => {
    const ready = deferred(), wait = deferred(); app.ensureReady = () => ready.promise; state.save = () => wait.promise;
    page.onInput(input('记录 A')); const saving = page.onSave();
    page.onInput(input('准备期间 B')); await page.onSave(); assert.equal(page.data.draft, '记录 A');
    ready.resolve(store); await Promise.resolve(); await Promise.resolve();
    page.onInput(input('提交期间 C')); await page.onSave(); assert.equal(state.saves.length, 1);
    wait.resolve({ ok: false, code: 'NETWORK' }); await saving;
    assert.equal(page.data.draft, '记录 A'); assert.equal(page.data.status, 'unknown');
    app.ensureReady = async () => store; state.save = async () => ({ ok: true, synced: true }); await page.onSave();
    assert.equal(state.saves[0].id, state.saves[1].id); assert.equal(page.data.lastSavedExcerpt, '记录 A');
  });
});

test('体验优化：记录首次账户初始化允许确认保存', async () => {
  await withPage('capture', async ({ page, app, store }) => {
    app.globalData.store = null;
    app.ensureReady = async () => { app.globalData.sessionEpoch++; app.globalData.store = store; return store; };
    page.onInput(input('首次想法')); await page.onSave();
    assert.equal(page.data.lastSavedExcerpt, '首次想法'); assert.equal(page.data.saving, false);
  });
});

test('体验优化：记录准备期间身份变化不发送旧输入', async () => {
  await withPage('capture', async ({ page, state, app, store }) => {
    app.globalData.store = null; page.onInput(input('旧账户的未保存内容'));
    const ready = deferred(); app.ensureReady = () => ready.promise; const saving = page.onSave();
    app.globalData.cacheScope = 'b'.repeat(32); app.globalData.sessionEpoch++; app.globalData.store = store;
    ready.resolve(store); await saving;
    assert.equal(state.saves.length, 0); assert.equal(page.data.lastSavedId, ''); assert.equal(page.data.saving, false);
  });
});

test('体验优化：记录离开返回后旧回执不清空新输入', async () => {
  await withPage('capture', async ({ page, state }) => {
    const wait = deferred(); state.save = () => wait.promise;
    page.onInput(input('旧记录')); const saving = page.onSave(); await Promise.resolve(); await Promise.resolve();
    page.onHide(); await page.onShow(); page.onInput(input('返回后的新输入'));
    wait.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, '返回后的新输入'); assert.equal(page.data.lastSavedId, ''); assert.equal(page.data.saving, false);
  });
});

test('体验优化：成稿后切换格式取消保留编辑与选材顺序', async () => {
  await withPage('material-output', async ({ page, state }) => {
    page.onTemplate(template('work')); assert.equal(page.data.templateId, 'free');
    page.onToggle({ currentTarget: { dataset: { key: 'ins_refine:supplement:sup_refine' } } });
    page.onToggle({ currentTarget: { dataset: { key: 'ins_refine:text' } } }); page.onGenerate();
    assert.equal(page.data.draft, '最初的补充\n\n最初的正文');
    page.onInput(input('手动修改稿')); const selected = structuredClone(page.selected);
    page.onTemplate(template('work')); assert.equal(page.data.templateId, 'free'); assert.equal(page.data.draft, '手动修改稿');
    state.modals.pop().success({ confirm: false }); assert.equal(page.data.templateId, 'free'); assert.equal(page.data.draft, '手动修改稿');
    page.onTemplate(template('work')); state.modals.pop().success({ confirm: true });
    assert.equal(page.data.templateId, 'work'); assert.match(page.data.draft, /最初的补充\n\n最初的正文/);
    assert.deepEqual(page.selected, selected); assert.equal(state.saves.length, 0); assert.equal(state.copies.length, 0);
  });
});

test('体验优化：格式替换过期确认不覆盖新编辑或新页面', async () => {
  for (const stale of ['input', 'selection', 'account']) await withPage('material-output', async ({ page, state, app }) => {
    page.onToggle({ currentTarget: { dataset: { key: 'ins_refine:text' } } }); page.onGenerate(); page.onInput(input('编辑稿'));
    page.onTemplate(template('work')); const modal = state.modals.pop();
    if (stale === 'input') page.onInput(input('新编辑稿'));
    else if (stale === 'selection') page.onBackToSelection();
    else { app.globalData.sessionEpoch++; }
    modal.success({ confirm: true });
    if (stale === 'account') { assert.equal(page.data.draft, ''); assert.equal(page.data.options.length, 0); }
    else { assert.equal(page.data.templateId, 'free'); assert.equal(page.data.draft, stale === 'input' ? '新编辑稿' : '编辑稿'); }
  });
});

test('体验优化：保存未知只保留一个主入口且原生编辑器冻结', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.wxml'), 'utf8');
  const capture = read('capture'); assert.equal((capture.match(/bindtap="onSave"/g) || []).length, 1);
  assert.doesNotMatch(capture, /bindtap="onRetrySave"/);
  assert.ok(capture.indexOf('尚未确认保存') < capture.indexOf('bindtap="onSave"'));
  const detail = read('detail');
  for (const editor of ['origin-editor', 'tl-editor']) assert.match(detail, new RegExp('class="' + editor + '"[^>]*disabled="\\{\\{pending !== \'\'\\}\\}"'));
  const material = read('material-output'); assert.ok(material.indexOf('稿件格式') > material.indexOf('返回选材'));
  assert.doesNotMatch(material.slice(material.indexOf("phase === 'select'}}"), material.indexOf('返回选材')), /template-options/);
});
