'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const todos = require('../miniprogram/core/todo');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { createCaptureDrafts } = require('../miniprogram/services/capture-drafts');
const { createSessionDrafts } = require('../miniprogram/services/session-drafts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const scope = 'a'.repeat(32), event = id => ({ currentTarget: { dataset: { id } } });
const input = value => ({ detail: { value } });
const choice = value => ({ currentTarget: { dataset: { choice: value } } });

async function addTodo(page, id) {
  page.onTodoAdd(event(id));
  await page.onApplyTodoDate();
}

function sample() {
  return core.appendSupplement(core.createInspiration({ id: 'idea', text: '安排城市漫步', now: 1000 }),
    { id: 'sup', content: '提前查好路线', now: 2000 });
}

async function withDetail(run, seed = sample(), query = {}) {
  const old = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const file = require.resolve('../miniprogram/pages/detail/index');
  const state = { record: structuredClone(seed), version: 1, generation: 1, writes: [], pulls: 0, modals: [], toasts: [], scrolls: [],
    mode: '', failPull: false, confirm: true, onPush: null };
  const sessionDrafts = createSessionDrafts(); sessionDrafts.bind({ cacheScope: scope, generation: 1 });
  const app = { globalData: { sessionEpoch: 1, cacheScope: scope, sessionDrafts, drafts: createCaptureDrafts() },
    ensureReady: async () => app.globalData.store };
  const transport = { async send(action, payload) {
    if (action === 'snapshot.pull') {
      state.pulls++;
      return state.failPull ? { ok: false, code: 'NETWORK' } : { ok: true, data: {
        cacheScope: scope, generation: state.generation, version: state.version, inspirations: state.record ? [state.record] : [] } };
    }
    if (action === 'inspiration.delete') { state.record = null; state.version++; return { ok: true, data: { version: state.version } }; }
    assert.equal(action, 'snapshot.push'); state.writes.push(structuredClone(payload));
    if (state.onPush) return state.onPush(payload);
    if (state.mode === 'network') return { ok: false, code: 'NETWORK' };
    if (payload.baseVersion !== state.version) return { ok: false, code: 'CONFLICT' };
    state.record = structuredClone(payload.upserts[0]); state.version++;
    return state.mode === 'lost' ? { ok: false, code: 'NETWORK' } : { ok: true, data: { version: state.version } };
  } };
  const freshStore = record => createCloudOnlyStore({ cacheScope: scope, transport, remoteSnapshot: {
    cacheScope: scope, generation: state.generation, version: state.version, inspirations: record ? [record] : [] } });
  const store = app.globalData.store = freshStore(state.record);
  let definition;
  const pages = [];
  try {
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { showToast: options => state.toasts.push(options.title), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
      showModal: options => { state.modals.push(options); if (options.success) options.success({ confirm: state.confirm, cancel: !state.confirm }); },
      showActionSheet() {}, pageScrollTo: options => state.scrolls.push(options), nextTick: callback => callback(),
      navigateTo() {}, navigateBack() {}, switchTab() {} };
    delete require.cache[file]; require(file);
    const makePage = async (extra = {}) => {
      const page = { ...definition, data: structuredClone(definition.data),
        setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); } };
      pages.push(page); await page.onLoad({ id: 'idea', ...extra }); await flush(); return page;
    };
    const page = await makePage(query);
    await run({ page, app, store, state, freshStore, makePage });
  } finally {
    for (const page of pages) { clearTimeout(page.todoUndoTimer); clearTimeout(page.highlightTimer); clearTimeout(page.todoMidnightTimer); }
    delete require.cache[file];
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('待办详情：正文补充独立完成恢复，撤销与移除均保留文字日期和编辑时间', async () => {
  await withDetail(async ({ page, store }) => {
    await addTodo(page, ''); await addTodo(page, 'sup');
    const before = store.getInspiration('idea'), text = before.text, updatedAt = before.updatedAt;
    page.onTodoDate(event('')); page.onTodoDatePick(input('2026-10-25')); await page.onApplyTodoDate();
    await page.onTodoToggle(event(''));
    assert.equal(page.data.todoDone, true); assert.equal(page.data.supplements[0].todoDone, false);
    assert.equal(page.data.todoUndoVisible, true);
    await page.onUndoTodo(); assert.equal(page.data.todoDone, false);
    assert.equal(page.data.todoDate, '2026-10-25');
    await page.onTodoToggle(event('sup')); assert.equal(page.data.todoDone, false);
    assert.equal(page.data.supplements[0].todoDone, true);
    await page.onTodoToggle(event('sup')); assert.equal(page.data.supplements[0].todoDone, false);
    await page.applyTodo('remove', 'sup');
    const after = store.getInspiration('idea');
    assert.equal(after.text, text); assert.equal(after.updatedAt, updatedAt);
    assert.equal(after.supplements[0].content, '提前查好路线'); assert.equal(after.supplements[0].todo, null);
    assert.equal(after.textHistory.length, 0);
  });
});

test('待办详情：已有正文与可见收起补充先配置待办，打开选择与取消均不写入', async () => {
  const hidden = core.foldIntoText(sample(), { supplementId: 'sup', historyId: 'hist', now: 3000 });
  for (const { id, seed } of [{ id: '', seed: sample() }, { id: 'sup', seed: sample() }, { id: 'sup', seed: hidden }]) {
    await withDetail(async ({ page, store, state }) => {
      const before = structuredClone(store.getInspiration('idea'));
      page.onTodoAdd(event(id));
      assert.equal(page.data.todoDateVisible, true);
      assert.equal(page.data.todoDateAction, 'add');
      assert.equal(page.data.todoDateTargetId, id);
      assert.equal(page.data.todoDateDraft, '');
      assert.equal(state.writes.length, 0);
      page.onTodoDateChoice(choice('today'));
      assert.equal(page.data.todoDateDraft, todos.localDate());
      page.onTodoDatePick(input('2026-11-06'));
      assert.equal(state.writes.length, 0);
      assert.deepEqual(store.getInspiration('idea'), before);
      page.onCloseTodoDate();
      await page.onApplyTodoDate();
      assert.equal(page.data.todoDateVisible, false);
      assert.equal(state.writes.length, 0, '取消后的旧确认不得新增待办');
      assert.deepEqual(store.getInspiration('idea'), before);
      page.onTodoAdd(event(id));
      assert.equal(page.data.todoDateDraft, '', '再次加入不沿用已取消的日期');
      page.onCloseTodoDate();
    }, seed);
  }
});

test('待办详情：已有内容确认加入时保存选定日期，仅改变选中来源', async () => {
  const hidden = core.foldIntoText(sample(), { supplementId: 'sup', historyId: 'hist', now: 3000 });
  const cases = [
    { id: '', seed: sample(), dateChoice: 'none', dueDate: null },
    { id: 'sup', seed: sample(), dateChoice: 'today', dueDate: todos.localDate() },
    { id: 'sup', seed: hidden, dateChoice: 'tomorrow', dueDate: todos.dateAfter(1) },
    { id: 'sup', seed: sample(), dueDate: '2026-11-07' }
  ];
  for (const { id, seed, dateChoice, dueDate } of cases) await withDetail(async ({ page, store, state }) => {
    const before = structuredClone(store.getInspiration('idea'));
    page.onTodoAdd(event(id));
    if (dateChoice) page.onTodoDateChoice(choice(dateChoice));
    else page.onTodoDatePick(input(dueDate));
    assert.equal(state.writes.length, 0);
    await page.onApplyTodoDate();
    assert.equal(state.writes.length, 1);
    assert.equal(page.data.todoDateVisible, false);
    const after = structuredClone(store.getInspiration('idea'));
    const target = id ? after.supplements.find(item => item.id === id) : after;
    assert.equal(target.todo.dueDate, dueDate);
    assert.equal(target.todo.completedAt, null);
    target.todo = null;
    assert.deepEqual(after, before, '文字、历史与其他来源的待办不得随之改变');
    await page.onApplyTodoDate();
    assert.equal(state.writes.length, 1, '已关闭的面板不得重复确认');
  }, seed);
});

test('待办详情：新增待办配置期间来源文字变更删除或远端加入待办，旧确认不覆盖新状态', async () => {
  for (const id of ['', 'sup']) for (const change of ['content', 'delete', 'remote-todo', 'archived', 'merged']) {
    await withDetail(async ({ page, store, state }) => {
      page.onTodoAdd(event(id)); page.onTodoDatePick(input('2026-11-08'));
      if (change === 'content') state.record = id
        ? core.editSupplement(state.record, { supplementId: id, content: '另一设备修改后的路线', historyId: 'changed', now: 5000 })
        : core.updateText(state.record, { text: '另一设备修改后的行程', historyId: 'changed', now: 5000 });
      else if (change === 'delete') state.record = id ? core.removeSupplement(state.record, { supplementId: id }) : null;
      else if (change === 'remote-todo') state.record = todos.updateTodo(state.record, { supplementId: id, action: 'replace',
        todo: { createdAt: 5000, completedAt: 6000, dueDate: '2026-11-09' } });
      else if (change === 'archived') state.record = core.markArchived(state.record, { now: 5000 });
      else state.record = core.markMerged(state.record, { targetId: 'target', now: 5000 });
      state.version++; await store.refresh();
      const latest = structuredClone(store.getInspiration('idea'));
      await page.onApplyTodoDate();
      assert.equal(state.writes.length, 0, change + '后不得提交旧加入操作');
      assert.deepEqual(store.getInspiration('idea'), latest);
      assert.equal(page.data.todoDateVisible, false);
      assert.match(page.data.todoError, /事项已更新/);
    });
  }
});

test('待办详情：新增待办面板不跨页面账户或数据代际确认', async () => {
  for (const change of ['hide', 'account', 'epoch', 'generation']) await withDetail(async ({ page, app, store, state, freshStore }) => {
    page.onTodoAdd(event('sup')); page.onTodoDatePick(input('2026-11-08'));
    if (change === 'hide') page.onHide();
    else if (change === 'account') { app.globalData.sessionEpoch++; app.globalData.store = freshStore(sample()); }
    else if (change === 'epoch') app.globalData.sessionEpoch++;
    else { state.generation++; await store.refresh(); }
    await page.onApplyTodoDate();
    assert.equal(state.writes.length, 0, change + '后不得确认旧面板');
    assert.equal(app.globalData.store.getInspiration('idea').supplements[0].todo, null);
    assert.ok(!state.toasts.includes('已设为待办'));
  });
});

test('待办详情：取消加入后修改现有日期不串模式，下一条加入不继承旧日期', async () => {
  const seed = { ...sample(), todo: todos.makeTodo(2500, '2026-10-26') };
  await withDetail(async ({ page, store, state }) => {
    page.onTodoAdd(event('sup')); page.onTodoDatePick(input('2026-11-10')); page.onCloseTodoDate();
    page.onTodoDate(event(''));
    assert.equal(page.data.todoDateAction, 'date');
    assert.equal(page.data.todoDateDraft, '2026-10-26');
    page.onTodoDatePick(input('2026-11-11')); await page.onApplyTodoDate();
    assert.equal(store.getInspiration('idea').todo.dueDate, '2026-11-11');
    assert.equal(store.getInspiration('idea').supplements[0].todo, null);
    page.onTodoAdd(event('sup'));
    assert.equal(page.data.todoDateAction, 'add'); assert.equal(page.data.todoDateDraft, '');
    await page.onApplyTodoDate();
    assert.equal(store.getInspiration('idea').supplements[0].todo.dueDate, null);
    assert.equal(store.getInspiration('idea').todo.dueDate, '2026-11-11');
    assert.equal(state.writes.length, 2);
  }, seed);
});

test('待办详情：新增补充原子保存待办，未知保存保留日期模式并复用补充标识', async () => {
  await withDetail(async ({ page, store, state }) => {
    page.onSupplementInput(input('买好车票')); page.onSupplementTodoToggle();
    page.onSupplementTodoDate(input('2026-10-23'));
    state.mode = 'network'; state.failPull = true;
    await page.onSubmitSupplement();
    assert.equal(page.data.supplementDraft, '买好车票'); assert.equal(page.data.supplementUnknown, true);
    assert.equal(page.data.supplementTodoEnabled, true); assert.equal(page.data.supplementTodoDate, '2026-10-23');
    assert.equal(store.getInspiration('idea').supplements.length, 1);
    const first = state.writes[0].upserts[0].supplements.at(-1);
    state.mode = ''; state.failPull = false; await page.onSubmitSupplement();
    const second = state.writes[1].upserts[0].supplements.at(-1);
    assert.equal(first.id, second.id); assert.deepEqual(first.todo, second.todo);
    assert.equal(store.getInspiration('idea').supplements.length, 2);
    assert.equal(store.getInspiration('idea').supplements.at(-1).todo.dueDate, '2026-10-23');
    assert.equal(page.data.supplementDraft, ''); assert.equal(page.data.supplementTodoEnabled, false);
    assert.equal(page.data.supplementTodoDate, '');
  });
});

test('待办详情：会话内返回保留补充文字日期和模式，账户改变清除旧设置', async () => {
  await withDetail(async ({ page, app, state, freshStore, makePage }) => {
    page.onSupplementInput(input('尚未保存的购票事项')); page.onSupplementTodoToggle(); page.onSupplementTodoDate(input('2026-10-24'));
    page.onHide(); const next = await makePage();
    assert.equal(next.data.supplementDraft, '尚未保存的购票事项');
    assert.equal(next.data.supplementTodoEnabled, true); assert.equal(next.data.supplementTodoDate, '2026-10-24');
    app.globalData.sessionEpoch++; app.globalData.store = freshStore(state.record);
    app.globalData.cacheScope = 'b'.repeat(32); app.globalData.drafts = createCaptureDrafts();
    app.globalData.sessionDrafts.bind({ cacheScope: 'b'.repeat(32), generation: 1 });
    await next.onShow();
    assert.equal(next.data.supplementDraft, ''); assert.equal(next.data.supplementTodoEnabled, false);
    assert.equal(next.data.supplementTodoDate, '');
  });
});

test('待办详情：归档未办先提示可取消也可继续，归档后待办只读且恢复后可处理', async () => {
  await withDetail(async ({ page, store, state }) => {
    await addTodo(page, ''); await addTodo(page, 'sup');
    state.confirm = false; await page.onMoreArchive();
    assert.equal(page.data.archived, false); assert.match(state.modals[0].title, /2/);
    assert.equal(state.modals[0].confirmText, '继续归档');
    state.confirm = true; await page.onMoreArchive(); assert.equal(page.data.archived, true);
    const writes = state.writes.length;
    await page.onTodoToggle(event('')); await page.onTodoAdd(event('sup'));
    page.onTodoDate(event('')); await page.applyTodo('remove', 'sup');
    assert.equal(state.writes.length, writes); assert.equal(page.data.todoDateVisible, false);
    assert.equal(todos.todoCounts(store.getInspiration('idea')).pending, 2);
    await page.onMoreArchive(); assert.equal(page.data.archived, false);
    await page.onTodoToggle(event('')); assert.equal(page.data.todoDone, true);
  });
});

test('待办详情：归档确认期间来源状态或版本变化停止旧确认，不执行反向恢复', async () => {
  for (const change of ['archived', 'archive-restored', 'content', 'generation']) await withDetail(async ({ page, store, state }) => {
    await addTodo(page, '');
    let dialog;
    global.wx.showModal = options => { dialog = options; };
    const confirming = page.onMoreArchive(); await flush();
    assert.equal(dialog.confirmText, '继续归档');
    const writes = state.writes.length;
    if (change === 'archived') {
      state.record = core.markArchived(state.record, { now: 5000 }); state.version++;
    } else if (change === 'archive-restored') {
      state.record = core.unarchive(core.markArchived(state.record, { now: 5000 })); state.version += 2;
    } else if (change === 'content') {
      state.record = core.updateText(state.record, { text: '另一设备已经修改的正文', historyId: 'other_edit', now: 5000 }); state.version++;
    } else {
      state.generation++;
    }
    await store.refresh();
    const latest = structuredClone(store.getInspiration('idea'));
    await dialog.success({ confirm: true }); await confirming;
    assert.equal(state.writes.length, writes, change + '不得提交旧确认或反向操作');
    assert.deepEqual(store.getInspiration('idea'), latest);
    assert.match(page.data.error, /内容已更新/);
    assert.ok(!state.toasts.includes('已取消归档'));
  });
});

test('待办详情：删除来源确认说明待办已办数量，移除待办不删除补充', async () => {
  await withDetail(async ({ page, store }) => {
    await addTodo(page, ''); await addTodo(page, 'sup'); await page.onTodoToggle(event('sup'));
    page.onMoreDelete(); assert.match(page.data.confirmBody, /1 项待办、1 项已办/); page.onConfirmDismiss();
    page.openSupplementActions('sup'); page.onSheetDelete();
    assert.match(page.data.confirmBody, /0 项待办、1 项已办/); page.onConfirmDismiss();
    await page.applyTodo('remove', 'sup'); assert.equal(store.getInspiration('idea').supplements.length, 1);
  });
});

test('待办详情：定位已并入补充会展开高亮，缺失来源不跳到其他补充', async () => {
  const hidden = core.foldIntoText(sample(), { supplementId: 'sup', historyId: 'hist', now: 3000 });
  await withDetail(async ({ page, state }) => {
    assert.equal(page.data.hiddenExpanded, true); assert.equal(page.data.highlightSupplementId, 'sup');
    assert.deepEqual(state.scrolls.map(row => row.selector), ['#supplement-sup']);
    assert.equal(page.data.hidden[0].content, '提前查好路线');
  }, hidden, { supplementId: 'sup' });
  await withDetail(async ({ page, state }) => {
    assert.match(page.data.sourceNotice, /不存在/); assert.equal(state.scrolls.length, 0);
  }, sample(), { supplementId: 'missing' });
});

test('待办详情：完成回执确认前不改勾选，隐藏页面和更换账户不接收旧回执', async () => {
  const seed = { ...sample(), todo: todos.makeTodo(2500) };
  for (const changeAccount of [false, true]) await withDetail(async ({ page, app, store, state, freshStore }) => {
    let finish;
    state.onPush = payload => new Promise(resolve => { finish = () => {
      state.record = structuredClone(payload.upserts[0]); state.version++; resolve({ ok: true, data: { version: state.version } });
    }; });
    const pending = page.onTodoToggle(event('')); await flush();
    assert.equal(page.data.todoDone, false); assert.equal(page.data.pending, 'todo');
    if (changeAccount) { app.globalData.sessionEpoch++; app.globalData.store = freshStore(sample()); }
    else page.onHide();
    finish(); await pending; assert.equal(page.data.todoDone, false); assert.equal(page.data.todoUndoVisible, false);
    if (!changeAccount) {
      await page.onShow(); assert.equal(page.data.todoDone, true); assert.equal(page.data.todoUnknown, false);
      assert.notEqual(store.getInspiration('idea').todo.completedAt, null);
    }
  }, seed);
});

test('待办详情：未知重试发现新版本时不重放旧正文，日期取消不改变记录', async () => {
  const seed = { ...sample(), todo: todos.makeTodo(2500, '2026-10-26') };
  await withDetail(async ({ page, store, state }) => {
    page.onTodoDate(event('')); page.onTodoDatePick(input('2026-10-27')); page.onCloseTodoDate();
    assert.equal(store.getInspiration('idea').todo.dueDate, '2026-10-26');
    state.mode = 'network'; state.failPull = true; await page.onTodoToggle(event(''));
    assert.equal(page.data.todoDone, false); assert.equal(page.data.todoUnknown, true);
    const writes = state.writes.length;
    state.record = core.updateText(state.record, { text: '其他设备修改的正文', historyId: 'changed', now: 4000 }); state.version++;
    state.mode = ''; state.failPull = false; await page.onRetryTodo();
    assert.equal(state.writes.length, writes); assert.equal(store.getInspiration('idea').text, '其他设备修改的正文');
    assert.equal(page.data.todoDone, false); assert.equal(page.data.todoUnknown, false); assert.match(page.data.todoError, /更新/);
  }, seed);
});

test('待办详情：未知新增补充被其他设备删除后重试不复活，返回页面保留固定操作', async () => {
  await withDetail(async ({ page, state, store, makePage }) => {
    page.onSupplementInput(input('先购票再出发')); page.onSupplementTodoToggle(); page.onSupplementTodoDate(input('2026-10-28'));
    state.mode = 'lost'; state.failPull = true;
    await page.onSubmitSupplement();
    assert.equal(page.data.supplementUnknown, true);
    const pending = page.pendingSupplement;
    assert.equal(state.record.supplements.at(-1).id, pending.id);
    state.record = core.removeSupplement(state.record, { supplementId: pending.id }); state.version++;
    page.onHide(); const next = await makePage();
    assert.equal(next.pendingSupplement.id, pending.id);
    assert.deepEqual(next.pendingSupplement.revision, pending.revision);
    assert.equal(next.pendingSupplement.requestId, pending.requestId);
    assert.equal(next.data.supplementUnknown, true);
    state.mode = ''; state.failPull = false;
    await next.onSubmitSupplement();
    assert.equal(state.writes.length, 1, '不得重新追加已被另一设备删除的补充');
    assert.equal(store.getInspiration('idea').supplements.length, 1);
    assert.equal(next.data.supplementDraft, '先购票再出发'); assert.equal(next.data.supplementTodoEnabled, true);
    assert.equal(next.data.supplementTodoDate, '2026-10-28'); assert.match(next.data.supplementError, /更新/);
  });
});

test('待办详情：勾选绑定已渲染状态，远端完成或恢复后旧点击不执行反向操作', async () => {
  for (const id of ['', 'sup']) for (const originallyDone of [false, true]) await withDetail(async ({ page, state, store }) => {
    await addTodo(page, id);
    if (originallyDone) await page.onTodoToggle(event(id));
    const writes = state.writes.length;
    state.record = todos.updateTodo(state.record, { supplementId: id, action: originallyDone ? 'reopen' : 'complete', now: 5000 });
    state.version++; await store.refresh();
    const latest = structuredClone(store.getInspiration('idea'));
    await page.onTodoToggle(event(id));
    assert.equal(state.writes.length, writes);
    assert.deepEqual(store.getInspiration('idea'), latest);
    assert.match(page.data.todoError, /事项已更新/);
    const rendered = id ? page.data.supplements.find(item => item.id === id) : page.data;
    assert.equal(rendered.todoDone, !originallyDone);
  });
});

test('待办详情：日期面板绑定原事项，完成移除重建或日期变化后停止旧确认', async () => {
  for (const id of ['', 'sup']) for (const change of ['complete', 'replace', 'remove', 'date']) await withDetail(async ({ page, state, store }) => {
    await addTodo(page, id); page.onTodoDate(event(id));
    page.onTodoDatePick(input('2026-11-02'));
    const writes = state.writes.length;
    if (change === 'replace') {
      state.record = todos.updateTodo(state.record, { supplementId: id, action: 'replace', todo: todos.makeTodo(6000, '2026-10-29') });
    } else {
      state.record = todos.updateTodo(state.record, { supplementId: id, action: change, now: 6000, dueDate: '2026-10-29' });
    }
    state.version++; await store.refresh();
    const latest = structuredClone(store.getInspiration('idea'));
    await page.onApplyTodoDate();
    assert.equal(state.writes.length, writes);
    assert.deepEqual(store.getInspiration('idea'), latest);
    assert.equal(page.data.todoDateVisible, false); assert.match(page.data.todoError, /事项已更新/);
  });
});

test('待办详情：设为待办与更多操作绑定可见事项，不改写远端新增或重建的任务', async () => {
  for (const id of ['', 'sup']) await withDetail(async ({ page, state, store }) => {
    state.record = todos.updateTodo(state.record, { supplementId: id, action: 'replace',
      todo: { createdAt: 5000, completedAt: 6000, dueDate: null } }); state.version++;
    await store.refresh(); const writes = state.writes.length;
    await page.onTodoAdd(event(id));
    assert.equal(state.writes.length, writes); assert.match(page.data.todoError, /事项已更新/);
    const target = id ? store.getInspiration('idea').supplements.find(entry => entry.id === id) : store.getInspiration('idea');
    assert.equal(target.todo.completedAt, 6000);
  });
  for (const menu of ['native-remove', 'native-date', 'supplement-remove', 'supplement-date']) await withDetail(async ({ page, state, store }) => {
    const id = menu.startsWith('supplement') ? 'sup' : '';
    await addTodo(page, id); let sheet;
    if (id) page.openSupplementActions(id);
    else { global.wx.showActionSheet = options => { sheet = options; }; page.onTodoMore(event(id)); }
    state.record = todos.updateTodo(state.record, { supplementId: id, action: 'replace', todo: todos.makeTodo(6000, '2026-11-03') });
    state.version++; await store.refresh(); const writes = state.writes.length, latest = structuredClone(store.getInspiration('idea'));
    if (menu === 'supplement-remove') await page.onSheetTodoRemove();
    else if (menu === 'supplement-date') page.onSheetTodoDate();
    else sheet.success({ tapIndex: menu === 'native-remove' ? 1 : 0 });
    assert.equal(state.writes.length, writes); assert.deepEqual(store.getInspiration('idea'), latest);
    assert.equal(page.data.todoDateVisible, false); assert.match(page.data.todoError, /事项已更新/);
  });
});

test('待办详情：正文可见与收起补充使用同一日历标签并保留原始日期', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 24, 12).getTime() });
  let seed = todos.updateTodo(sample(), { action: 'add', dueDate: '2026-10-24', now: 2500 });
  seed = todos.updateTodo(seed, { supplementId: 'sup', action: 'add', dueDate: '2026-10-25', now: 2501 });
  seed = core.appendSupplement(seed, { id: 'hidden', content: '元旦后再整理', now: 2600,
    todo: todos.makeTodo(2600, '2027-01-02') });
  seed = core.foldIntoText(seed, { supplementId: 'hidden', historyId: 'hist', now: 3000 });
  seed = core.appendSupplement(seed, { id: 'undated', content: '有空时查看', now: 3100, todo: todos.makeTodo(3100) });
  await withDetail(async ({ page, state }) => {
    assert.equal(page.data.todayDate, '2026-10-24'); assert.equal(page.data.tomorrowDate, '2026-10-25');
    assert.equal(page.data.todoDate, '2026-10-24'); assert.equal(page.data.todoDateLabel, '今天 · 10月24日');
    const upcoming = page.data.supplements.find(row => row.id === 'sup');
    assert.equal(upcoming.todoDate, '2026-10-25'); assert.equal(upcoming.todoDateLabel, '明天 · 10月25日');
    assert.equal(page.data.hidden[0].todoDate, '2027-01-02');
    assert.equal(page.data.hidden[0].todoDateLabel, '2027年1月2日 周六');
    assert.equal(page.data.supplements.find(row => row.id === 'undated').todoDateLabel, '未安排日期');
    assert.equal(state.writes.length, 0); assert.equal(state.pulls, 0);
  }, seed);
});

test('待办详情：午夜只刷新日期标签，保留输入面板草稿与未知操作且不读写云端', async (t) => {
  const beforeMidnight = new Date(2026, 9, 24, 23, 59, 59).getTime();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: beforeMidnight });
  const seed = todos.updateTodo(sample(), { action: 'add', dueDate: '2026-10-25', now: 2500 });
  const withoutDateLabels = data => {
    const copy = structuredClone(data);
    delete copy.todayDate; delete copy.tomorrowDate; delete copy.todoDateLabel;
    for (const name of ['supplements', 'hidden']) copy[name].forEach(row => { delete row.todoDateLabel; });
    return copy;
  };
  for (const mode of ['date-panel', 'unknown']) {
    t.mock.timers.setTime(beforeMidnight);
    await withDetail(async ({ page, state }) => {
      page.onSupplementInput(input('尚未保存的补充')); page.onSupplementTodoToggle();
      page.onSupplementTodoDate(input('2026-11-04'));
      page.setData({ tagsDraft: '尚未保存标签', orgOpen: true, orgDirty: true });
      if (mode === 'date-panel') {
        page.onTodoDate(event('')); page.onTodoDatePick(input('2026-11-05'));
      } else {
        state.mode = 'network'; state.failPull = true; await page.onTodoToggle(event(''));
        assert.equal(page.data.todoUnknown, true);
      }
      const origin = page.todoDateOrigin, operation = page.pendingTodo;
      const before = withoutDateLabels(page.data), writes = state.writes.length, pulls = state.pulls;
      assert.equal(page.data.todoDateLabel, '明天 · 10月25日');
      t.mock.timers.tick(1100);
      assert.equal(page.data.todoDateLabel, '今天 · 10月25日');
      assert.equal(page.data.todayDate, '2026-10-25'); assert.equal(page.data.tomorrowDate, '2026-10-26');
      assert.deepEqual(withoutDateLabels(page.data), before);
      assert.equal(page.todoDateOrigin, origin); assert.equal(page.pendingTodo, operation);
      assert.equal(state.writes.length, writes); assert.equal(state.pulls, pulls);
      assert.notEqual(page.todoMidnightTimer, null, '仍在当前来源时安排下一次午夜刷新');
    }, seed);
  }
});

test('待办详情：隐藏账户代际与来源失效后午夜停止刷新并清理定时器', async (t) => {
  const beforeMidnight = new Date(2026, 9, 24, 23, 59, 59).getTime();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: beforeMidnight });
  const seed = todos.updateTodo(sample(), { action: 'add', dueDate: '2026-10-25', now: 2500 });
  for (const change of ['hide', 'account', 'epoch', 'generation', 'source-deleted', 'source-todo', 'page-source']) {
    t.mock.timers.setTime(beforeMidnight);
    await withDetail(async ({ page, app, store, state, freshStore }) => {
      assert.notEqual(page.todoMidnightTimer, null);
      if (change === 'hide') page.onHide();
      else if (change === 'account') { app.globalData.sessionEpoch++; app.globalData.store = freshStore(seed); }
      else if (change === 'epoch') app.globalData.sessionEpoch++;
      else if (change === 'page-source') page.id = 'another';
      else {
        if (change === 'generation') state.generation++;
        else if (change === 'source-deleted') state.record = null;
        else state.record = todos.updateTodo(state.record, { action: 'date', dueDate: '2026-11-06' });
        state.version++; await store.refresh();
      }
      const before = structuredClone(page.data), pulls = state.pulls, writes = state.writes.length;
      t.mock.timers.tick(1100);
      assert.deepEqual(page.data, before, change + '后不得用旧来源重绘日期');
      assert.equal(page.todoMidnightTimer, null);
      assert.equal(state.pulls, pulls); assert.equal(state.writes.length, writes);
    }, seed);
  }
});
