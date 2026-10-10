'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { createSessionDrafts } = require('../miniprogram/services/session-drafts');

async function withPage(name, query, run, intent) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const file = require.resolve(path.join('..', 'miniprogram/pages', name, 'index.js'));
  let definition;
  const item = core.createInspiration({ id: 'idea', text: '为社区旧物交换准备一份活动提纲。', now: 1000 });
  const state = { items: [item], saves: [], routes: [], modals: [], result: { ok: true, synced: true } };
  const store = { getInspiration: id => state.items.find(row => row.id === id), listInspirations: () => state.items,
    getConfirmedRevision: () => ({ baseVersion: 1, generation: 1 }),
    async saveInspiration(next) { state.saves.push(next); if (state.result.ok) state.items.push(next); return state.result; } };
  const sessionDrafts = createSessionDrafts(); sessionDrafts.bind({ cacheScope: 'a'.repeat(32), generation: 1 });
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: 'a'.repeat(32), sessionDrafts,
    sharedTemplateIntent: intent }, ensureReady: async () => store };
  try {
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { showModal: opts => state.modals.push(opts), navigateTo: opts => state.routes.push(opts.url),
      enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, pageScrollTo() {} };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } };
    if (name === 'capture') await page.onShow(); else await page.onLoad(query);
    await run({ page, app, store, state });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('记录输入：聚焦保持输入，失焦复位且再记一条可重新聚焦', async () => {
  await withPage('capture', {}, async ({ page, state }) => {
    assert.equal(page.data.inputFocus, false, '普通进入不请求键盘');
    page.onFocus();
    assert.equal(page.data.inputFocus, true, '聚焦事件不能撤回原生焦点');
    page.onInput({ detail: { value: '点进输入框后写下的新想法' } });
    assert.equal(page.data.draft, '点进输入框后写下的新想法');
    assert.equal(page.data.canSave, true);
    page.onBlur();
    assert.equal(page.data.inputFocus, false);
    assert.equal(page.data.draft, '点进输入框后写下的新想法');
    assert.equal(page.data.canSave, true);
    await page.onSave();
    assert.equal(state.saves.length, 1);
    assert.ok(page.data.lastSavedId);
    page.setData({ draftRecoveryNotice: '已接续这次已记下的想法。' });
    page.onRecordAnother();
    assert.equal(page.data.inputFocus, true, '再记一条直接请求焦点');
    assert.equal(page.data.draftRecoveryNotice, '', '开始下一条时清除上一条恢复提示');
    page.onFocus();
    assert.equal(page.data.inputFocus, true);
    assert.equal(page.data.lastSavedId, '');
    page.onInput({ detail: { value: '第二条想法' } });
    page.onHide();
    assert.equal(page.data.inputFocus, false, '隐藏时撤回焦点请求');
    await page.onShow();
    assert.equal(page.data.draft, '第二条想法');
    assert.equal(page.data.inputFocus, false, '返回仅恢复文字，不自动弹键盘');
    page.setData({ saving: true });
    page.onFocus();
    assert.equal(page.data.inputFocus, false, '提交期间不请求焦点');
    page.onInput({ detail: { value: '提交时不能改写' } });
    assert.equal(page.data.draft, '第二条想法');
  });
});

test('连续记录：确认保存后可直接输入下一条，各次正文与记录标识独立', async () => {
  await withPage('capture', {}, async ({ page, state }) => {
    const firstText = '散步时想到的第一条想法';
    const secondText = '下一条：为周末准备一份采购清单';
    page.onFocus();
    page.onInput({ detail: { value: firstText } });
    await page.onSave();
    const firstId = page.data.lastSavedId;
    assert.ok(firstId);
    assert.equal(page.data.draft, '');
    assert.equal(page.data.canSave, false);
    assert.equal(page.data.inputFocus, false, '确认后释放本次输入焦点');
    assert.equal(page.data.lastSavedExcerpt, firstText);

    // 连续记录直接使用仍在页面中的输入框，不依赖“再记一条”先清理确认卡。
    page.onFocus();
    page.onInput({ detail: { value: secondText } });
    assert.equal(page.data.draft, secondText);
    assert.equal(page.data.canSave, true);
    assert.equal(page.data.lastSavedId, '');
    assert.equal(page.data.lastSavedExcerpt, '');
    await page.onSave();
    assert.equal(state.saves.length, 2);
    assert.notEqual(state.saves[1].id, firstId);
    assert.equal(state.saves[0].id, firstId);
    assert.equal(state.saves[0].text, firstText);
    assert.equal(state.saves[1].text, secondText);
    assert.equal(page.data.lastSavedId, state.saves[1].id);
    assert.equal(page.data.lastSavedExcerpt, secondText);
    assert.equal(page.data.draft, '');
    assert.equal(page.data.inputFocus, false);
    assert.equal(page.pendingSave, null);
    assert.equal(state.routes.length, 0, '连续记录不自动离开首页');
  });
});

test('连续记录：再记一条不改写提交中、隐藏页、未知请求或未保存输入', async () => {
  const pending = { text: '尚未确认的想法', scope: 'a'.repeat(32), generation: 1,
    item: core.createInspiration({ id: 'pending_capture', text: '尚未确认的想法', now: 2000 }) };
  const cases = [
    { label: '提交中', data: { saving: true }, visible: true },
    { label: '页面隐藏', data: {}, visible: false },
    { label: '未知请求', data: { lastSavedId: '', status: 'unknown', draft: pending.text, canSave: true }, visible: true, pending },
    { label: '未保存输入', data: { draft: '第二条尚未提交的文字', canSave: true }, visible: true },
    { label: '待确认标识', data: {}, visible: true, pending },
    { label: '没有已确认记录', data: { lastSavedId: '' }, visible: true }
  ];
  for (const scenario of cases) await withPage('capture', {}, async ({ page, state }) => {
    page.setData(Object.assign({ lastSavedId: 'saved-first', lastSavedExcerpt: '第一条已确认的内容',
      lastSavedTemplateId: 'work', draftRecoveryNotice: '已接续这次已记下的想法。', inputFocus: false }, scenario.data));
    page.visible = scenario.visible;
    page.pendingSave = scenario.pending || null;
    const before = structuredClone(page.data);
    const pendingBefore = page.pendingSave;
    page.onRecordAnother();
    assert.deepEqual(page.data, before, scenario.label + '不应改变输入、反馈或焦点');
    assert.equal(page.pendingSave, pendingBefore, scenario.label + '不应替换待确认标识');
    assert.equal(state.saves.length, 0, scenario.label + '不应提交记录');
  });
});

test('连续记录：长正文完整保留，提交中的连续点击只产生一次写入', async () => {
  await withPage('capture', {}, async ({ page, store, state }) => {
    const fullText = '长正文与换行全部保留。\n'.repeat(200).slice(0, page.data.maxLength);
    page.onInput({ detail: { value: fullText + '多' } });
    assert.equal(page.data.draft, fullText + '多');
    assert.equal(page.data.overBy, 1);
    assert.equal(page.data.canSave, false);
    await page.onSave(); assert.equal(state.saves.length, 0);
    page.onInput({ detail: { value: fullText } });
    let confirm;
    const pending = new Promise(resolve => { confirm = resolve; });
    store.saveInspiration = item => { state.saves.push(item); return pending; };
    const saving = page.onSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.saving, true);
    await page.onSave(); page.onRecordAnother();
    page.onInput({ detail: { value: '重复操作不能替换提交正文' } });
    assert.equal(state.saves.length, 1);
    assert.equal(state.saves[0].text, fullText);
    assert.equal(page.data.draft, fullText);
    confirm({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, '');
    assert.equal(page.data.lastSavedExcerpt, fullText);
    assert.equal(page.data.lastSavedId, state.saves[0].id);
    page.onRecordAnother();
    assert.equal(page.data.inputFocus, true);
    assert.equal(page.data.lastSavedId, '');
  });
});

test('连续记录：切页后迟到的确认不清空返回时的新输入', async () => {
  await withPage('capture', {}, async ({ page, store, state }) => {
    const originalSave = store.saveInspiration;
    let confirm;
    const pending = new Promise(resolve => { confirm = resolve; });
    store.saveInspiration = item => {
      state.saves.push(item);
      return pending.then(result => { if (result.ok) state.items.push(item); return result; });
    };
    page.onInput({ detail: { value: '离页前已提交的想法' } });
    const saving = page.onSave(); await new Promise(resolve => setImmediate(resolve));
    const oldId = state.saves[0].id;
    page.onHide(); await page.onShow();
    assert.equal(page.data.status, 'unknown');
    assert.equal(page.data.draft, '离页前已提交的想法');
    page.onInput({ detail: { value: '返回后正在写的下一条' } });
    assert.equal(page.pendingSave, null);
    confirm({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, '返回后正在写的下一条');
    assert.equal(page.data.lastSavedId, '');
    assert.equal(page.data.saving, false);
    assert.equal(page.data.canSave, true);
    assert.ok(store.getInspiration(oldId), '已发送并确认的旧记录仍存在');
    store.saveInspiration = originalSave;
    await page.onSave();
    assert.equal(state.saves.length, 2);
    assert.notEqual(state.saves[1].id, oldId);
    assert.equal(state.saves[1].text, '返回后正在写的下一条');
    assert.equal(page.data.lastSavedId, state.saves[1].id);
  });
});

test('连续记录：未知保存确认后复用标识，下一条使用新的标识', async () => {
  await withPage('capture', {}, async ({ page, state }) => {
    state.result = { ok: false, code: 'NETWORK' };
    page.onInput({ detail: { value: '结果未知后重试的同一条' } });
    await page.onSave();
    const firstId = state.saves[0].id;
    assert.equal(page.data.status, 'unknown');
    assert.equal(page.data.draft, '结果未知后重试的同一条');
    assert.equal(page.data.lastSavedId, '');
    state.result = { ok: true, synced: true }; await page.onRetrySave();
    assert.equal(state.saves[1].id, firstId);
    assert.equal(page.data.lastSavedId, firstId);
    assert.equal(state.items.filter(item => item.id === firstId).length, 1);
    page.onRecordAnother(); page.onInput({ detail: { value: '确认后新写的下一条' } });
    await page.onSave();
    assert.equal(state.saves.length, 3);
    assert.notEqual(state.saves[2].id, firstId);
    assert.equal(state.saves[2].text, '确认后新写的下一条');
    assert.equal(page.data.lastSavedId, state.saves[2].id);
  });
});

test('成稿传播：单多结果显式确认另存后直达预览，同稿不重复写入', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, { id: 'idea', template: 'work' }, async ({ page, state }) => {
    if (name === 'material-output') { page.onToggle({ currentTarget: { dataset: { key: page.data.options[0].key } } }); page.onGenerate('work'); }
    assert.match(page.data.draft, /【背景与材料】/);
    page.onShareDraft(); page.onShareDraft();
    assert.equal(state.modals.length, 1); assert.equal(state.saves.length, 0);
    assert.ok(state.modals[0].confirmText.length <= 4); assert.ok(state.modals[0].cancelText.length <= 4);
    await state.modals[0].success({ confirm: false }); assert.equal(state.saves.length, 0);
    page.onShareDraft(); await state.modals[1].success({ confirm: true });
    assert.equal(state.saves.length, 1); assert.equal(state.saves[0].templateId, 'work');
    assert.equal(state.routes[0], '/pages/share-preview/index?id=' + state.saves[0].id);
    page.onShareDraft(); assert.equal(state.saves.length, 1); assert.equal(state.routes.length, 2);
  });
});

test('成稿传播：未知保存和过期确认不跳转，保留稿件及稳定另存标识', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, { id: 'idea' }, async ({ page, state }) => {
    if (name === 'material-output') { page.onToggle({ currentTarget: { dataset: { key: page.data.options[0].key } } }); page.onGenerate(); }
    const text = page.data.draft; state.result = { ok: false, code: 'NETWORK' };
    page.onShareDraft(); await state.modals[0].success({ confirm: true });
    assert.equal(state.routes.length, 0); assert.equal(page.data.draft, text); assert.equal(page.data.saveUnknown, true);
    page.onShareDraft(); assert.equal(state.modals.length, 1);
    state.result = { ok: true, synced: true };
    await (name === 'output' ? page.onSaveAsNew() : page.onSave());
    assert.equal(state.saves[0].id, state.saves[1].id);
    page.onShareDraft(); assert.equal(state.routes.length, 1);
    if (name === 'output') page.onDraftInput({ detail: { value: text + '新的编辑' } }); else page.onInput({ detail: { value: text + '新的编辑' } });
    page.onShareDraft(); const prompt = state.modals.at(-1); page.onHide();
    await prompt.success({ confirm: true }); assert.equal(state.saves.length, 2); assert.equal(state.routes.length, 1);
  });
});

test('成稿用途：接收意图只消费一次并保持空正文，确认首记后带入自己的结构', async () => {
  await withPage('capture', {}, async ({ page, app, state }) => {
    assert.equal(page.data.draft, ''); assert.equal(page.data.templateIntentLabel, '工作提纲');
    assert.equal(app.globalData.sharedTemplateIntent, undefined); assert.equal(state.saves.length, 0);
    page.onInput({ detail: { value: '我的社区活动计划' } }); await page.onSave(); page.onOrganizeSaved();
    assert.equal(state.saves[0].templateId, undefined);
    assert.equal(state.routes[0], '/pages/output/index?id=' + state.saves[0].id + '&template=work');
    page.onClearTemplateIntent(); assert.equal(page.data.templateIntentId, '');
  }, { templateId: 'work', epoch: 1, expiresAt: Date.now() + 300000, body: '不得复制的作者原文' });
});

test('成稿用途：非法过期和旧账户意图丢弃，慢账户准备保留输入且复核用途代次', async () => {
  for (const intent of [{ templateId: 'bad', epoch: 1, expiresAt: Date.now() + 300000 },
    { templateId: 'work', epoch: 0, expiresAt: Date.now() + 300000 }, { templateId: 'work', epoch: 1, expiresAt: 1 }]) {
    await withPage('capture', {}, async ({ page, app }) => {
      assert.equal(page.data.templateIntentId, ''); assert.equal(app.globalData.sharedTemplateIntent, undefined);
    }, intent);
  }
  await withPage('capture', {}, async ({ page, app, store }) => {
    page.onInput({ detail: { value: '我已经写了一半' } });
    app.globalData.sharedTemplateIntent = { templateId: 'video', epoch: 1, expiresAt: Date.now() + 300000 };
    app.ensureReady = async () => { app.globalData.sessionEpoch++; return store; };
    await page.onShow(); assert.equal(page.data.draft, '我已经写了一半'); assert.equal(page.data.templateIntentId, '');
    page.onClearTemplateIntent(); assert.equal(page.data.draft, '我已经写了一半');
  });
  await withPage('output', { id: 'idea', template: 'bad' }, async ({ page }) => {
    assert.equal(page.data.templateId, 'free'); assert.doesNotMatch(page.data.draft, /【背景与材料】/);
  });
});

test('选材恢复：空搜索一键返回全部素材并保留已选顺序', async () => {
  await withPage('material-output', {}, async ({ page }) => {
    const key = page.data.options[0].key; page.onToggle({ currentTarget: { dataset: { key } } });
    page.onSearch({ detail: { value: '不存在的查询' } }); page.onSelectedOnly(); assert.equal(page.data.options.length, 0);
    page.onClearSearch(); assert.equal(page.data.query, ''); assert.equal(page.data.selectedOnly, false);
    assert.equal(page.data.options[0].key, key); assert.equal(page.data.options[0].order, 1);
  });
});

test('成稿用途：空记录页不提示未完成，已保存卡片不挡接收者自己的新输入', async () => {
  await withPage('capture', {}, async ({ page, app }) => {
    page.onHide(); await page.onShow(); assert.equal(page.data.draftRecoveryNotice, '');
    page.onInput({ detail: { value: '已经保存的想法' } }); await page.onSave();
    page.onHide(); await page.onShow(); assert.ok(page.data.lastSavedId); assert.match(page.data.draftRecoveryNotice, /已记下/);
    app.globalData.sharedTemplateIntent = { templateId: 'work', epoch: 1, expiresAt: Date.now() + 300000 };
    await page.onShow(); assert.equal(page.data.lastSavedId, ''); assert.equal(page.data.draft, '');
    assert.equal(page.data.draftRecoveryNotice, ''); assert.equal(page.data.templateIntentId, 'work');
  });
});

test('成稿传播：分享返回保留已确认编辑稿，已存来源变化时清除旧确认而保留文字', async () => {
  for (const name of ['output', 'material-output']) await withPage(name, { id: 'idea' }, async ({ page, state }) => {
    if (name === 'material-output') { page.onToggle({ currentTarget: { dataset: { key: page.data.options[0].key } } }); page.onGenerate(); }
    const text = '手工编辑后的最终稿，取消分享后还需要继续使用。';
    if (name === 'output') page.onDraftInput({ detail: { value: text } }); else page.onInput({ detail: { value: text } });
    page.onShareDraft(); await state.modals[0].success({ confirm: true });
    const savedId = page.data.savedId;
    page.onHide(); await page.onShow();
    assert.equal(page.data.draft, text); assert.equal(page.data.savedId, savedId); assert.equal(page.data.phase, 'edit');
    page.onShareDraft(); assert.equal(state.saves.length, 1); assert.equal(state.routes.length, 2);
    page.onHide(); state.items = state.items.filter(row => row.id !== savedId); await page.onShow();
    assert.equal(page.data.draft, text); assert.equal(page.data.savedId, '');
    page.onShareDraft(); assert.equal(state.modals.length, 2); assert.equal(state.routes.length, 2);
  });
});
