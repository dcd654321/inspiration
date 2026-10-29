'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionDrafts } = require('../miniprogram/services/session-drafts');
const { startCapture } = require('../miniprogram/services/capture-entry');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { localDate, dateAfter } = require('../miniprogram/core/todo');

const input = value => ({ detail: { value } });
const date = kind => ({ currentTarget: { dataset: { kind } } });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function capture(run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const file = require.resolve('../miniprogram/pages/capture/index');
  const state = { saved: [], records: [], result: { ok: true, synced: true }, onSave: null, tabs: [] };
  const drafts = createSessionDrafts(); drafts.bind({ cacheScope: 'a'.repeat(32), generation: 1 });
  const store = { getConfirmedRevision: () => ({ baseVersion: 1, generation: 1 }),
    getInspiration: id => state.records.find(item => item.id === id),
    async saveInspiration(item) {
      state.saved.push(item);
      const result = state.onSave ? await state.onSave(item) : state.result;
      if (result.ok) state.records.push(item);
      return result;
    } };
  const app = { globalData: { store, cacheScope: 'a'.repeat(32), sessionEpoch: 1, sessionDrafts: drafts },
    ensureReady: async () => app.globalData.store };
  try {
    let definition;
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, switchTab: value => state.tabs.push(value) };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data),
      setData(value) { Object.assign(this.data, value); } };
    await page.onShow();
    await run({ page, app, store, state });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('待办记录：普通记录默认无待办，选择日期与文字一次保存并在确认后复位', async () => {
  await capture(async ({ page, state }) => {
    assert.equal(page.data.todoEnabled, false);
    page.onInput(input('普通灵感')); await page.onSave();
    assert.equal(state.saved[0].todo, null);
    page.onInput(input('周末查一条散步路线')); page.onToggleTodo();
    page.onTodoDateChange(input('2026-10-24'));
    await page.onSave();
    assert.equal(state.saved.length, 2);
    assert.equal(state.saved[1].text, '周末查一条散步路线');
    assert.equal(state.saved[1].todo.dueDate, '2026-10-24');
    assert.equal(state.saved[1].todo.completedAt, null);
    assert.equal(state.saved[1].todo.createdAt, state.saved[1].createdAt);
    assert.equal(page.data.draft, ''); assert.equal(page.data.todoEnabled, false);
    assert.equal(page.data.todoDueDate, '');
  });
});

test('待办记录：未知回执保留文字日期与固定记录，处理中和未知时不能改待办设置', async () => {
  await capture(async ({ page, state }) => {
    page.onInput(input('先核对路线再出门')); page.onToggleTodo(); page.onTodoDate(date('tomorrow'));
    const dueDate = page.data.todoDueDate;
    let finish;
    state.onSave = () => new Promise(resolve => { finish = resolve; });
    const saving = page.onSave(); await tick();
    assert.equal(page.data.saving, true);
    page.onToggleTodo(); page.onTodoDate(date('none'));
    assert.equal(page.data.todoEnabled, true); assert.equal(page.data.todoDueDate, dueDate);
    finish({ ok: false, code: 'NETWORK' }); await saving;
    assert.equal(page.data.status, 'unknown'); assert.equal(page.data.draft, '先核对路线再出门');
    page.onToggleTodo(); page.onTodoDateChange(input('2026-11-01'));
    assert.equal(page.data.todoDueDate, dueDate);
    const target = state.saved[0];
    state.onSave = null; await page.onSave();
    assert.equal(state.saved[1], target, '重试必须复用原ID和计划日期及加入时间');
    assert.equal(page.data.lastSavedId, target.id); assert.equal(page.data.todoEnabled, false);
  });
});

test('待办记录：快速入口预选模式但不覆盖未保存文字和日期', async () => {
  await capture(async ({ page, app, state }) => {
    startCapture({ todo: true }); await page.onShow();
    assert.equal(page.data.todoEnabled, true);
    assert.equal(state.tabs[0].url, '/pages/capture/index');
    assert.equal(app.globalData.captureStartIntent, undefined);
    page.onInput(input('尚未保存的记录')); page.onTodoDateChange(input('2026-11-02'));
    page.setData({ todayDate: '2000-01-01', tomorrowDate: '2000-01-02' });
    page.onHide(); page.setData({ draft: '' }); startCapture({ todo: true }); await page.onShow();
    assert.equal(page.data.draft, '尚未保存的记录'); assert.equal(page.data.todoDueDate, '2026-11-02');
    assert.equal(page.data.todayDate, localDate(), '恢复草稿时按当前日期显示今天，不继承旧展示日期');
    assert.equal(page.data.tomorrowDate, dateAfter(1), '恢复草稿时按当前日期显示明天，保留实际计划日期');
    assert.match(page.data.draftRecoveryNotice, /请先保存或清空/);
    page.onToggleTodo(); assert.equal(page.data.todoEnabled, false);
    page.onHide(); startCapture({ todo: true }); await page.onShow();
    assert.equal(page.data.todoEnabled, false, '入口不能强行把正在写的普通记录改成待办');
    assert.equal(page.data.draft, '尚未保存的记录');
  });
});

test('待办记录：账户准备期间立即输入仍按待办保存，迟到读取不清空新选日期和模式', async () => {
  await capture(async ({ page, app, store, state }) => {
    let ready;
    app.ensureReady = () => new Promise(resolve => { ready = resolve; });
    startCapture({ todo: true });
    const showing = page.onShow();
    assert.equal(page.data.todoEnabled, true, '进入即确定待办模式');
    page.onInput(input('进来就开始写待办')); page.onTodoDateChange(input('2026-11-08'));
    ready(store); await showing;
    assert.equal(page.data.todoEnabled, true); assert.equal(page.data.todoDueDate, '2026-11-08');
    assert.equal(page.data.draftRecoveryNotice, '');
    app.ensureReady = async () => store; await page.onSave();
    assert.equal(state.saved[0].todo.dueDate, '2026-11-08');
    app.ensureReady = () => new Promise(resolve => { ready = resolve; });
    startCapture({ todo: true }); const second = page.onShow();
    page.onTodoDateChange(input('2026-11-09')); ready(store); await second;
    assert.equal(page.data.todoDueDate, '2026-11-09', '尚未写文字也不能清掉日期');
    startCapture({ todo: true }); const third = page.onShow();
    page.onToggleTodo(); ready(store); await third;
    assert.equal(page.data.todoEnabled, false, '等待期间用户改回普通记录必须保留');
  });
});

test('待办记录：非法日期不接受，关闭待办清除日期且下次仍默认无日期', async () => {
  await capture(async ({ page }) => {
    page.onTodoDate(date('today')); assert.equal(page.data.todoDueDate, '');
    page.onToggleTodo(); page.onTodoDateChange(input('2026-02-30'));
    assert.equal(page.data.todoDueDate, '');
    page.onTodoDate(date('today')); assert.match(page.data.todoDueDate, /^\d{4}-\d{2}-\d{2}$/);
    page.onToggleTodo(); page.onToggleTodo();
    assert.equal(page.data.todoDueDate, '');
  });
});

test('待办记录：明确拒绝后调整日期使用新设置，回读失败仍保留固定未知操作', async () => {
  await capture(async ({ page, store, state }) => {
    page.onInput(input('可调整日期的待办')); page.onToggleTodo(); page.onTodoDateChange(input('2026-10-25'));
    state.result = { ok: false, code: 'INVALID_PAYLOAD' }; await page.onSave();
    assert.equal(page.data.status, 'rejected');
    page.onTodoDateChange(input('2026-10-26')); state.result = { ok: true, synced: true };
    await page.onSave(); assert.equal(state.saved[1].todo.dueDate, '2026-10-26');
    page.onInput(input('回读仍未确认的待办')); page.onToggleTodo();
    state.result = { ok: false, code: 'NETWORK' }; await page.onSave();
    const operation = page.pendingSave;
    store.refresh = async () => ({ ok: false, code: 'PULL_FAILED' });
    await page.onSave(); assert.equal(page.data.status, 'unknown');
    page.onToggleTodo(); assert.equal(page.pendingSave, operation); assert.equal(page.data.todoEnabled, true);
  });
});

test('待办记录：账户切换和迟到保存不把输入与待办模式写入新账户页面', async () => {
  await capture(async ({ page, app, store, state }) => {
    page.onInput(input('旧账户待办')); page.onToggleTodo();
    let finish; state.onSave = () => new Promise(resolve => { finish = resolve; });
    const saving = page.onSave(); await tick();
    app.globalData.cacheScope = 'b'.repeat(32); app.globalData.sessionEpoch++;
    app.globalData.store = { ...store }; app.globalData.sessionDrafts.bind({ cacheScope: 'b'.repeat(32), generation: 1 });
    await page.onShow(); finish({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, ''); assert.equal(page.data.lastSavedId, '');
    assert.equal(page.data.todoEnabled, false); assert.equal(page.data.saving, false);
  });
});

test('待办记录：未知新建固定版本及请求ID，重试回读确认且不覆盖其他设备更新', async () => {
  for (const mode of ['retry', 'confirmed', 'conflict']) await capture(async ({ page, app }) => {
    let version = 0, records = [], offline = true;
    const writes = [];
    const store = createCloudOnlyStore({ cacheScope: app.globalData.cacheScope,
      remoteSnapshot: { cacheScope: app.globalData.cacheScope, generation: 1, version, inspirations: [] },
      transport: { async send(action, payload, meta) {
        if (action === 'snapshot.pull') return offline ? { ok: false, code: 'NETWORK' } : { ok: true, data: {
          cacheScope: app.globalData.cacheScope, generation: 1, version, inspirations: records } };
        writes.push({ payload, meta });
        if (offline) return { ok: false, code: 'NETWORK' };
        records = payload.upserts; version++;
        return { ok: true, data: { version } };
      } } });
    app.globalData.store = store;
    page.onInput(input('等待确认的待办')); page.onToggleTodo();
    await page.onSave(); assert.equal(page.data.status, 'unknown'); assert.equal(writes.length, 1);
    const target = page.pendingSave.item;
    offline = false;
    if (mode === 'confirmed') { records = [structuredClone(target)]; version = 1; }
    if (mode === 'conflict') { records = [{ ...target, text: '其他设备已经修改的正文' }]; version = 2; }
    await page.onSave();
    if (mode === 'retry') {
      assert.equal(writes.length, 2);
      assert.equal(writes[1].payload.baseVersion, writes[0].payload.baseVersion);
      assert.equal(writes[1].meta.requestId, writes[0].meta.requestId);
      assert.equal(page.data.lastSavedId, target.id);
    } else if (mode === 'confirmed') {
      assert.equal(writes.length, 1); assert.equal(page.data.lastSavedId, target.id);
    } else {
      assert.equal(writes.length, 1, '冲突后不能以新版本重传旧记录');
      assert.equal(records[0].text, '其他设备已经修改的正文');
      assert.equal(page.data.draft, '等待确认的待办'); assert.equal(page.data.status, 'rejected');
      assert.match(page.data.errorText, /内容已更新/);
    }
  });
});
