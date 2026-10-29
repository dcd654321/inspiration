'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { localDate, dateAfter } = require('../miniprogram/core/todo');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');

const clone = value => structuredClone(value);
const event = key => ({ currentTarget: { dataset: { key } } });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const scope = 'a'.repeat(32), now = Date.now();
  const item = (id, text, dueDate, completedAt = null) => Object.assign({}, core.createInspiration({ id, text, now }), {
    todo: { createdAt: now, completedAt, dueDate }
  });
  const first = item('first', '今天要处理的正文', localDate());
  const supplement = { id: 'folded', content: '收起的补充待办', contentHistory: [], createdAt: now, source: 'user',
    sourceIds: [], mergedInto: null, foldedAt: now, todo: { createdAt: now + 1, completedAt: null, dueDate: null } };
  first.supplements = [supplement];
  let remote = { cacheScope: scope, generation: 1, version: 0, inspirations: [first,
    item('overdue', '过期的计划', dateAfter(-1)), item('future', '未来的计划', dateAfter(2)),
    item('done', '已经办好的事情', dateAfter(-1), now - 1),
    Object.assign(item('archived', '归档的未办事项', dateAfter(-3)), { archivedAt: now })] };
  const state = { routes: [], writes: [], calls: [], modals: [], actionSheets: [], intercept: null };
  const transport = { async send(action, payload, options) {
    state.calls.push({ action, payload: clone(payload), options: clone(options) });
    if (state.intercept) {
      const response = await state.intercept(action, payload, options);
      if (response !== undefined) return response;
    }
    if (action === 'snapshot.pull') return { ok: true, data: clone(remote) };
    if (action !== 'snapshot.push') throw Error(action);
    if (payload.baseVersion !== remote.version || payload.generation !== remote.generation) return { ok: false, code: 'CONFLICT' };
    state.writes.push(clone(payload));
    for (const next of payload.upserts) remote.inspirations = remote.inspirations.filter(row => row.id !== next.id).concat([clone(next)]);
    remote.version++;
    return { ok: true, data: { version: remote.version, applied: payload.upserts.map(row => row.id) } };
  } };
  const store = createCloudOnlyStore({ transport, cacheScope: scope, remoteSnapshot: clone(remote) });
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: scope },
    ensureReady: async () => app.globalData.store, refreshAccount: async () => app.globalData.store };
  const mounted = [];
  function mount(name = 'todos') {
    const filename = require.resolve('../miniprogram/pages/' + name + '/index');
    let definition; global.Page = value => { definition = value; };
    delete require.cache[filename]; require(filename); mounted.push(filename);
    const page = { ...definition, data: clone(definition.data), setData(data, done) { Object.assign(this.data, data); if (done) done(); } };
    return page;
  }
  global.getApp = () => app;
  global.wx = {
    navigateTo: value => state.routes.push(value.url), switchTab: value => state.routes.push(value.url),
    showActionSheet: options => state.actionSheets.push(options),
    showModal: options => { state.modals.push(options); options.success({ confirm: true }); }, stopPullDownRefresh() {}
  };
  const pages = [];
  try { await run({ mount: name => { const page = mount(name); pages.push(page); return page; }, app, store, state,
    remote: () => remote, replaceRemote: value => { remote = value; } }); }
  finally {
    pages.forEach(page => { if (page.onHide) page.onHide(); }); mounted.forEach(file => delete require.cache[file]);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('待办看板：四入口注册、默认记录及独立勾选区域', () => {
  const app = require('../miniprogram/app.json');
  assert.deepEqual(app.tabBar.list.map(tab => tab.text), ['记录', '灵感', '待办', '我的']);
  assert.equal(app.pages.filter(page => page === 'pages/todos/index').length, 1);
  assert.match(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/launch/index.js'), 'utf8'), /\/pages\/capture\/index/);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/todos/index.wxml'), 'utf8');
  assert.match(wxml, /catchtap="onToggle"/); assert.match(wxml, /bindtap="onOpen"/);
  assert.match(wxml, /disabled="\{\{busy \|\| blocked \|\| item.readOnly\}\}"/);
  assert.match(wxml, /取消归档后可处理/);
});

test('待办看板：完整数量日期分组、范围搜索与灵感摘要', async () => {
  await fixture(async ({ mount }) => {
    const page = mount(); await page.onShow();
    assert.deepEqual(page.data.counts, { all: 6, pending: 5, done: 1 });
    assert.equal(page.data.scope, 'pending');
    assert.deepEqual(page.data.groups.map(group => group.id), ['overdue', 'today', 'date:' + dateAfter(2), 'undated', 'archived']);
    page.onSearch({ detail: { value: '今天' } });
    assert.equal(page.data.matchCount, 2, '补充也可按所属正文找到');
    assert.deepEqual(page.data.counts, { all: 6, pending: 5, done: 1 });
    page.onScope({ currentTarget: { dataset: { scope: 'done' } } }); assert.equal(page.data.matchCount, 0);
    page.onClearQuery(); assert.deepEqual(page.data.groups.map(group => group.id), ['done']);
    const list = mount('list'); await list.onShow();
    assert.equal(list.data.items.find(row => row.id === 'first').todoSummary, '待办 2 · 已办 0');
  });
});

test('待办看板：确认后完成、独立补充与撤销保留日期', async () => {
  await fixture(async ({ mount, store, state }) => {
    const page = mount(); await page.onShow();
    const original = clone(store.getInspiration('first'));
    await page.onToggle(event('first:'));
    assert.ok(store.getInspiration('first').todo.completedAt !== null);
    assert.equal(store.getInspiration('first').supplements[0].todo.completedAt, null);
    assert.equal(store.getInspiration('first').updatedAt, original.updatedAt);
    assert.deepEqual(page.data.counts, { all: 6, pending: 4, done: 2 }); assert.equal(page.data.undoVisible, true);
    assert.equal(state.routes.length, 0);
    await page.onUndo(); assert.deepEqual(store.getInspiration('first').todo, original.todo);
    assert.equal(page.data.undoVisible, false); assert.equal(page.data.counts.pending, 5);
  });
});

test('待办看板：归档项只读且取消整条归档后才能完成', async () => {
  await fixture(async ({ mount, store, state }) => {
    const page = mount(); await page.onShow();
    await page.onToggle(event('archived:')); page.onMore(event('archived:'));
    assert.equal(state.writes.length, 0); assert.equal(state.actionSheets.length, 0);
    const archiveGroup = page.data.groups.find(group => group.id === 'archived');
    assert.equal(archiveGroup.items[0].readOnly, true);
    page.onUnarchive(event('archived:')); await flush(); await flush();
    assert.match(state.modals[0].content, /全部补充/); assert.equal(store.getInspiration('archived').archivedAt, null);
    assert.equal(store.getInspiration('archived').todo.completedAt, null);
    await page.onToggle(event('archived:')); assert.ok(store.getInspiration('archived').todo.completedAt !== null);
  });
});

test('待办看板：收起补充来源定位、日期调整及移除保留文字', async () => {
  await fixture(async ({ mount, store, state }) => {
    const page = mount(); await page.onShow();
    page.onOpen(event('first:folded')); assert.equal(state.routes.at(-1), '/pages/detail/index?id=first&supplementId=folded');
    page.onMore(event('first:folded')); state.actionSheets.at(-1).success({ tapIndex: 0 });
    assert.equal(page.data.dateVisible, true); await page.onDateQuick({ currentTarget: { dataset: { kind: 'tomorrow' } } });
    assert.equal(store.getInspiration('first').supplements[0].todo.dueDate, dateAfter(1));
    page.onMore(event('first:folded')); state.actionSheets.at(-1).success({ tapIndex: 1 }); await flush(); await flush();
    assert.equal(store.getInspiration('first').supplements[0].todo, null);
    assert.equal(store.getInspiration('first').supplements[0].content, '收起的补充待办');
  });
});

test('待办看板：未知回执保留固定操作，返回后仍能重试确认', async () => {
  await fixture(async ({ mount, store, state }) => {
    const page = mount(); await page.onShow();
    state.intercept = () => { throw Error('offline'); };
    await page.onToggle(event('first:'));
    const operation = page.pendingOperation;
    assert.ok(operation); assert.equal(page.data.blocked, true); assert.equal(store.getInspiration('first').todo.completedAt, null);
    assert.equal(page.data.counts.done, 1); assert.match(page.data.operationError, /尚未确认/);
    page.onHide(); await page.onShow();
    assert.equal(page.pendingOperation, operation); assert.match(page.data.operationError, /尚未确认/);
    state.intercept = null; await page.onRetryOperation();
    assert.equal(page.pendingOperation, null); assert.ok(store.getInspiration('first').todo.completedAt !== null);
    assert.equal(state.writes.length, 1);
  });
});

test('待办看板：重复点击和迟到回执不回填其他账户', async () => {
  await fixture(async ({ mount, app, store, state }) => {
    const page = mount(); await page.onShow();
    let release;
    state.intercept = action => action === 'snapshot.push' ? new Promise(resolve => { release = resolve; }) : undefined;
    const saving = page.onToggle(event('first:')); await flush(); await page.onToggle(event('first:'));
    assert.equal(state.calls.filter(call => call.action === 'snapshot.push').length, 1);
    page.onHide(); app.globalData.sessionEpoch++; app.globalData.cacheScope = 'b'.repeat(32);
    app.globalData.store = { readSnapshot: () => ({ inspirations: [] }), refresh: async () => ({ ok: true }) };
    await page.onShow(); release({ ok: false, code: 'CONFLICT' }); await saving;
    assert.deepEqual(page.data.groups, []); assert.deepEqual(page.data.counts, { all: 0, pending: 0, done: 0 });
    assert.equal(page.data.operationError, ''); assert.equal(page.pendingOperation, null); assert.equal(page.data.undoVisible, false);
    assert.equal(store.getInspiration('first').todo.completedAt, null);
  });
});

test('待办看板：刷新失败保留已确认内容，记待办复用记录入口', async () => {
  await fixture(async ({ mount, state, app }) => {
    const page = mount(); await page.onShow();
    state.intercept = action => action === 'snapshot.pull' ? { ok: false, code: 'NETWORK' } : undefined;
    await page.onRetry(); assert.equal(page.data.groups.length, 5); assert.match(page.data.error, /上次读取/);
    page.onAdd(); assert.equal(state.routes.at(-1), '/pages/capture/index');
    assert.equal(app.globalData.captureStartIntent.todo, true);
  });
});

test('待办看板：首次账户失败可重试准备，跨日重算并清理定时器', async () => {
  await fixture(async ({ mount, app, store }) => {
    app.globalData.store = null; app.globalData.accountError = '暂时无法准备账户';
    const page = mount(); await page.onShow(); assert.match(page.data.error, /准备账户/);
    app.refreshAccount = async () => { app.globalData.sessionEpoch++; app.globalData.store = store; return store; };
    await page.onRetry(); assert.equal(page.data.counts.all, 6); assert.equal(page.data.error, '');
    page.scheduleMidnight(); assert.ok(page.midnightTimer);
    const { mock } = require('node:test');
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 3 * 86400000 });
    try {
      page.load();
      assert.deepEqual(page.data.groups.map(group => group.id), ['overdue', 'undated', 'archived']);
    } finally { mock.timers.reset(); }
    page.onHide(); assert.equal(page.midnightTimer, null); assert.deepEqual(page.data.groups, []);
  });
});

test('待办看板：午夜同时重算日期分组和标签，保留日期面板且不发起读写', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 9, 24, 23, 59, 59, 900).getTime() });
  try {
    await fixture(async ({ mount, state, store }) => {
      const page = mount(); await page.onShow();
      const findRow = key => page.data.groups.flatMap(group => group.items).find(row => row.key === key);
      assert.deepEqual(page.data.groups.map(group => group.id), ['overdue', 'today', 'date:2026-10-26', 'undated', 'archived']);
      assert.equal(findRow('first:').dueLabel, '今天 · 10月24日');
      assert.equal(findRow('future:').dueLabel, '10月26日 周一');
      assert.equal(findRow('first:folded').dueLabel, '未安排日期');
      page.onMore(event('first:')); state.actionSheets.at(-1).success({ tapIndex: 0 });
      page.setData({ dateValue: '2027-01-02' });
      const panelTarget = clone(page.dateTargetTodo), snapshot = store.readSnapshot(), calls = state.calls.length;
      t.mock.timers.tick(1100);
      assert.deepEqual(page.data.groups.map(group => group.id), ['overdue', 'tomorrow', 'undated', 'archived']);
      assert.equal(findRow('first:').dueLabel, '10月24日 周六');
      assert.equal(findRow('future:').dueLabel, '明天 · 10月26日');
      assert.deepEqual(page.data.counts, { all: 6, pending: 5, done: 1 });
      assert.equal(page.data.dateVisible, true); assert.equal(page.data.dateKey, 'first:');
      assert.equal(page.data.dateValue, '2027-01-02'); assert.deepEqual(page.dateTargetTodo, panelTarget);
      assert.equal(state.calls.length, calls); assert.equal(state.writes.length, 0);
      assert.deepEqual(store.readSnapshot(), snapshot, '午夜刷新不改已确认的来源内容');
      page.onHide(); assert.equal(page.midnightTimer, null);
      t.mock.timers.tick(86400000);
      assert.deepEqual(page.data.groups, [], '离页后不回填分组');
    });
  } finally { t.mock.timers.reset(); }
});

test('待办看板：返回刷新确认未知目标或冲突，不自动重发旧操作', async () => {
  for (const reached of [true, false]) await fixture(async ({ mount, state, remote, replaceRemote }) => {
    const page = mount(); await page.onShow();
    state.intercept = () => { throw Error('offline'); };
    await page.onToggle(event('first:')); const operation = page.pendingOperation;
    assert.ok(operation); page.onHide();
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === 'first'
      ? reached ? clone(operation.target) : Object.assign({}, item, { text: '另一设备修改了正文' }) : item);
    replaceRemote(next); state.intercept = null;
    await page.onShow();
    assert.equal(page.pendingOperation, null); assert.equal(page.data.blocked, false);
    assert.equal(state.calls.filter(call => call.action === 'snapshot.push').length, 1);
    if (reached) {
      assert.equal(page.data.counts.done, 2); assert.equal(page.data.operationError, ''); assert.equal(page.data.undoVisible, true);
    } else {
      assert.equal(page.data.counts.done, 1); assert.match(page.data.operationError, /变化/); assert.equal(page.data.undoVisible, false);
    }
  });
});

test('待办看板：离开后重入共享旧刷新并按当前页面加载结果', async () => {
  await fixture(async ({ mount, state, remote, replaceRemote }) => {
    const page = mount(); await page.onShow();
    let release;
    state.intercept = action => action === 'snapshot.pull' ? new Promise(resolve => { release = resolve; }) : undefined;
    const priorCalls = state.calls.filter(call => call.action === 'snapshot.pull').length;
    const refreshing = page.onRetry(); await flush(); page.onHide();
    const returning = page.onShow(); await flush();
    const next = clone(remote()); next.version++; next.inspirations = [];
    replaceRemote(next); release({ ok: true, data: clone(next) });
    await Promise.all([refreshing, returning]);
    assert.deepEqual(page.data.groups, []); assert.deepEqual(page.data.counts, { all: 0, pending: 0, done: 0 });
    assert.equal(page.data.loading, false); assert.equal(page.data.error, '');
    assert.equal(state.calls.filter(call => call.action === 'snapshot.pull').length, priorCalls + 1);
  });
});

test('待办看板：未知移除回读空待办自动结清且不覆盖来源新文字', async () => {
  await fixture(async ({ mount, state, remote, replaceRemote, store }) => {
    const page = mount(); await page.onShow();
    state.intercept = () => { throw Error('offline'); };
    await page.changeTodo({ inspirationId: 'first', supplementId: '' }, 'remove');
    const operation = page.pendingOperation; assert.equal(operation.targetTodo, null);
    page.onHide();
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === 'first'
      ? Object.assign({}, clone(operation.target), { text: '另一设备更新的正文' }) : item);
    replaceRemote(next); state.intercept = null;
    await page.onShow();
    assert.equal(page.pendingOperation, null); assert.equal(page.data.blocked, false); assert.equal(page.data.operationError, '');
    assert.equal(page.data.counts.all, 5); assert.equal(store.getInspiration('first').todo, null);
    assert.equal(store.getInspiration('first').text, '另一设备更新的正文');
    assert.equal(state.calls.filter(call => call.action === 'snapshot.push').length, 1);
  });
});

test('待办看板：勾选按已渲染状态处理，后台变化不反向完成或恢复', async () => {
  for (const completed of [false, true]) await fixture(async ({ mount, state, remote, replaceRemote, store }) => {
    const page = mount(); await page.onShow();
    page.onScope({ currentTarget: { dataset: { scope: 'all' } } });
    const id = completed ? 'done' : 'first';
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === id
      ? { ...item, todo: { ...item.todo, completedAt: completed ? null : Date.now() } } : item);
    replaceRemote(next); await store.refresh();
    const confirmed = clone(store.getInspiration(id).todo);
    await page.onToggle(event(id + ':'));
    assert.deepEqual(store.getInspiration(id).todo, confirmed);
    assert.equal(state.writes.length, 0);
    assert.match(page.data.operationError, /事项已变化/);
  });
});

test('待办看板：菜单固定打开时动作，日期选项不因状态变化变成恢复待办', async () => {
  for (const completed of [false, true]) await fixture(async ({ mount, state, remote, replaceRemote, store }) => {
    const page = mount(); await page.onShow();
    page.onScope({ currentTarget: { dataset: { scope: 'all' } } });
    const id = completed ? 'done' : 'first';
    page.onMore(event(id + ':'));
    const sheet = state.actionSheets.at(-1);
    assert.equal(sheet.itemList[0], completed ? '恢复待办' : '调整日期');
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === id
      ? { ...item, todo: { ...item.todo, completedAt: completed ? null : Date.now() } } : item);
    replaceRemote(next); await store.refresh();
    const confirmed = clone(store.getInspiration(id).todo);
    sheet.success({ tapIndex: 0 }); await flush();
    assert.deepEqual(store.getInspiration(id).todo, confirmed);
    assert.equal(state.writes.length, 0); assert.equal(page.data.dateVisible, false);
    assert.match(page.data.operationError, /事项已变化/);
  });
});

test('待办看板：日期面板绑定原事项，移除重建或远端改日期不覆盖新待办', async () => {
  for (const rebuilt of [false, true]) await fixture(async ({ mount, state, remote, replaceRemote, store }) => {
    const page = mount(); await page.onShow();
    page.onMore(event('first:')); state.actionSheets.at(-1).success({ tapIndex: 0 });
    assert.equal(page.data.dateVisible, true);
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === 'first'
      ? { ...item, todo: { ...item.todo, createdAt: item.todo.createdAt + (rebuilt ? 1000 : 0), dueDate: '2026-11-10' } } : item);
    replaceRemote(next); await store.refresh();
    const confirmed = clone(store.getInspiration('first').todo);
    await page.onDateSelected({ detail: { value: '2026-11-20' } });
    assert.deepEqual(store.getInspiration('first').todo, confirmed);
    assert.equal(state.writes.length, 0); assert.equal(page.data.dateVisible, false);
    assert.equal(page.dateTargetTodo, null); assert.match(page.data.operationError, /事项已变化/);
  });
});

test('待办看板：取消归档确认绑定归档时间，不取消其他设备的新一次归档', async () => {
  await fixture(async ({ mount, state, remote, replaceRemote, store }) => {
    const page = mount(); await page.onShow();
    let confirmation; global.wx.showModal = options => { confirmation = options; };
    page.onUnarchive(event('archived:')); assert.ok(confirmation);
    const next = clone(remote()); next.version++;
    next.inspirations = next.inspirations.map(item => item.id === 'archived'
      ? { ...item, archivedAt: item.archivedAt + 1000 } : item);
    replaceRemote(next); await store.refresh();
    const archivedAt = store.getInspiration('archived').archivedAt;
    confirmation.success({ confirm: true }); await flush();
    assert.equal(store.getInspiration('archived').archivedAt, archivedAt);
    assert.equal(state.writes.length, 0); assert.match(page.data.operationError, /事项已变化/);
  });
});
