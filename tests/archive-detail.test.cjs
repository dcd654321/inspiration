'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const scope = 'a'.repeat(32);
const flush = () => new Promise(resolve => setImmediate(resolve));
const input = value => ({ detail: { value } });
const event = id => ({ currentTarget: { dataset: { id } } });

function sample() {
  let item = core.createInspiration({ id: 'idea', text: '正文初稿\n保留换行', now: 1000 });
  item = core.updateText(item, { text: '当前正文\n保留换行', historyId: 'history_text', now: 2000 });
  item = core.appendSupplement(item, { id: 'sup', content: '补充初稿', now: 3000 });
  item = core.editSupplement(item, { supplementId: 'sup', content: '当前补充\n完整文字', historyId: 'history_sup', now: 4000 });
  return { ...item, tags: ['散步'], stage: 'working', photos: [{ id: 'photo', createdAt: 4500, fileId: 'cloud://private/photo' }] };
}

async function withDetail(run, seed = sample()) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const file = require.resolve('../miniprogram/pages/detail/index');
  const state = { record: structuredClone(seed), version: 1, generation: 1, writes: [], targets: [], routes: [], copied: [], toasts: [], back: 0,
    failPull: false, mode: '', onPush: null };
  const app = { globalData: { sessionEpoch: 1, cacheScope: scope }, ensureReady: async () => app.globalData.store };
  const transport = { async send(action, payload) {
    if (action === 'snapshot.pull') {
      return state.failPull ? { ok: false, code: 'NETWORK' } : { ok: true, data: {
        cacheScope: scope, generation: state.generation, version: state.version, inspirations: state.record ? [state.record] : [] } };
    }
    if (action === 'inspiration.delete') {
      state.record = null; state.version++; return { ok: true, data: { version: state.version } };
    }
    assert.equal(action, 'snapshot.push');
    state.writes.push(structuredClone(payload.upserts[0]));
    if (state.onPush) return state.onPush(payload);
    if (state.mode === 'network') return { ok: false, code: 'NETWORK' };
    state.record = structuredClone(payload.upserts[0]); state.version++;
    return state.mode === 'lost' ? { ok: false, code: 'NETWORK' } : { ok: true, data: { version: state.version } };
  } };
  function freshStore(record = state.record) {
    const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: {
      cacheScope: scope, generation: state.generation, version: state.version, inspirations: record ? [record] : [] }, transport });
    const save = store.saveInspiration;
    store.saveInspiration = target => { state.targets.push(target); return save(target); };
    return store;
  }
  const store = app.globalData.store = freshStore();
  app.globalData.photos = { add: async () => { throw Error('read-only photos must not add'); } };
  try {
    let definition;
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { navigateTo: options => state.routes.push(options.url), navigateBack: () => state.back++,
      showToast: options => state.toasts.push(options.title), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
      showActionSheet: options => options.success({ tapIndex: 1 }),
      setClipboardData: options => { state.copied.push(options.data); if (options.success) options.success(); },
      showModal: () => { throw Error('archive must not request confirmation'); } };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data),
      setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } };
    await page.onLoad({ id: 'idea' }); await flush();
    await run({ page, app, store, state, freshStore });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('详情归档：确认后停留原页，取消归档完整保留内容及原更新时间', async () => {
  await withDetail(async ({ page, store, state }) => {
    const original = structuredClone(store.getInspiration('idea'));
    let finish;
    state.onPush = payload => new Promise(resolve => { finish = () => {
      state.record = structuredClone(payload.upserts[0]); state.version++;
      resolve({ ok: true, data: { version: state.version } });
    }; });
    const saving = page.onMoreArchive(); await flush();
    assert.equal(page.data.pending, 'archive'); assert.equal(page.data.archived, false);
    assert.equal(store.getInspiration('idea').archivedAt, null); assert.deepEqual(state.toasts, []);
    finish(); await saving;
    const archived = store.getInspiration('idea');
    assert.equal(page.data.archived, true); assert.equal(page.data.pending, '');
    assert.deepEqual({ ...archived, archivedAt: null }, original);
    assert.equal(page.data.historyCount, 2); assert.equal(page.data.supplements[0].content, '当前补充\n完整文字');
    assert.equal(page.data.photos.length, 1); assert.deepEqual(state.routes, []); assert.equal(state.back, 0);
    assert.deepEqual(state.toasts, ['已归档']);
    state.onPush = null; await page.onMoreArchive();
    assert.equal(page.data.archived, false); assert.deepEqual(store.getInspiration('idea'), original);
    assert.deepEqual(state.toasts, ['已归档', '已取消归档']);
    page.onStartEdit(); assert.equal(page.data.editing, true);
  });
});

test('详情归档：任何输入草稿、照片或写入处理中及未知结果均阻止新归档且保留输入', async () => {
  const cases = [
    { supplementDraft: '尚未保存的补充' }, { supplementDraft: ' ' },
    { editing: true, editDraft: '尚未保存正文' },
    { editingSupplementId: 'sup', supplementEditDraft: '待改补充', supplementEditOriginal: '原补充' },
    { orgDirty: true, tagsDraft: '待存标签' }, { photoBusy: true }, { pending: 'text' },
    { editUnknown: true }, { supplementUnknown: true }, { supplementEditUnknown: true }
  ];
  for (const changes of cases) await withDetail(async ({ page, state }) => {
    Object.assign(page.data, changes); const before = structuredClone(changes);
    await page.onMoreArchive();
    assert.equal(state.writes.length, 0); assert.equal(page.data.archived, false);
    for (const key of Object.keys(changes)) assert.deepEqual(page.data[key], before[key]);
    assert.match(page.data.error, /处理中|先保存或清空/);
  });
  await withDetail(async ({ page, state }) => {
    page.unconfirmedWrite = true; await page.onMoreArchive();
    assert.equal(state.writes.length, 0); assert.match(page.data.error, /确认保存结果/);
  });
});

test('详情归档：未知回执复用同一目标和归档时间，阻止编辑绕过，回读确认后恢复正常', async () => {
  await withDetail(async ({ page, store, state }) => {
    state.mode = 'network'; state.failPull = true;
    await page.onMoreArchive();
    assert.equal(page.data.archived, false); assert.equal(page.data.archiveUnknown, true);
    assert.equal(store.getInspiration('idea').archivedAt, null);
    const target = page.pendingArchive.target;
    page.onStartEdit(); page.onSupplementInput(input('不得写入'));
    assert.equal(page.data.editing, false); assert.equal(page.data.supplementDraft, '');
    state.mode = ''; state.failPull = false; await page.onMoreArchive();
    assert.equal(state.targets[0], target); assert.equal(state.targets[1], target);
    assert.equal(state.writes[1].archivedAt, state.writes[0].archivedAt);
    assert.equal(page.data.archived, true); assert.equal(page.data.archiveUnknown, false);
    assert.equal(page.pendingArchive, null); assert.equal(store.getInspiration('idea').updatedAt, 4000);
  });
  await withDetail(async ({ page, state }) => {
    state.mode = 'lost'; await page.onMoreArchive();
    assert.equal(page.data.archived, true); assert.equal(page.data.archiveUnknown, false);
    assert.equal(state.writes.length, 1); assert.deepEqual(state.toasts, ['已归档']);
  });
});

test('详情归档：其他设备归档后会话补充仍保留，允许先恢复再保存输入', async () => {
  await withDetail(async ({ page, store }) => {
    page.onSupplementInput(input('尚未提交的会话文字'));
    await store.saveInspiration(core.markArchived(store.getInspiration('idea'), { now: 5000 }));
    page.load(); assert.equal(page.data.archived, true);
    assert.equal(page.data.supplementDraft, '尚未提交的会话文字');
    await page.onMoreArchive();
    assert.equal(page.data.archived, false); assert.equal(page.data.supplementDraft, '尚未提交的会话文字');
    await page.onSubmitSupplement();
    assert.equal(store.getInspiration('idea').supplements.at(-1).content, '尚未提交的会话文字');
  });
});

test('详情归档：取消归档未知后已达到目标，重试不覆掉其他设备新增补充', async () => {
  await withDetail(async ({ page, store, state }) => {
    state.mode = 'network'; state.failPull = true;
    await page.onMoreArchive(); assert.equal(page.data.archiveUnknown, true);
    state.record = core.appendSupplement(core.unarchive(state.record), {
      id: 'other_device_sup', content: '其他设备取消归档后新增的补充', now: 6000 });
    state.version += 2; state.mode = ''; state.failPull = false;
    assert.equal((await store.refresh()).ok, true);
    const writes = state.writes.length;
    await page.onMoreArchive();
    assert.equal(state.writes.length, writes, '目标状态已达成，不得重放旧的取消归档对象');
    assert.equal(store.getInspiration('idea').supplements.at(-1).content, '其他设备取消归档后新增的补充');
    assert.equal(state.record.supplements.at(-1).id, 'other_device_sup');
    assert.equal(page.data.supplements.at(-1).id, 'other_device_sup');
    assert.equal(page.data.archived, false); assert.equal(page.data.archiveUnknown, false);
    assert.equal(page.pendingArchive, null);
  }, core.markArchived(sample(), { now: 5000 }));
});

test('详情归档：未知重试前版本变化且目标未达成时停止旧对象并显示冲突', async () => {
  await withDetail(async ({ page, store, state }) => {
    state.mode = 'network'; state.failPull = true; await page.onMoreArchive();
    state.record = core.appendSupplement(state.record, { id: 'new_sup', content: '新补充必须保留', now: 6000 });
    state.version++; state.mode = ''; state.failPull = false; await store.refresh();
    const writes = state.writes.length; await page.onMoreArchive();
    assert.equal(state.writes.length, writes); assert.equal(page.pendingArchive, null);
    assert.equal(page.data.archiveUnknown, false); assert.equal(page.data.archived, false);
    assert.equal(page.data.supplements.at(-1).content, '新补充必须保留');
    assert.match(page.data.error, /更新|变化/);
  });
});

test('详情归档：未知恢复跨代际即使归档字段相同也不能确认或重放', async () => {
  for (const reload of [false, true]) await withDetail(async ({ page, store, state }) => {
    state.mode = 'network'; state.failPull = true; await page.onMoreArchive();
    state.record = core.unarchive(state.record); state.generation++; state.version = 0;
    state.mode = ''; state.failPull = false; await store.refresh();
    if (reload) page.load();
    const writes = state.writes.length; await page.onMoreArchive();
    assert.equal(state.writes.length, writes); assert.equal(page.pendingArchive, null);
    assert.equal(page.data.archiveUnknown, false); assert.equal(page.data.archived, false);
    assert.match(page.data.error, /更新|变化/);
    assert.deepEqual(state.toasts, []);
  }, core.markArchived(sample(), { now: 5000 }));
});

test('详情归档：明确失败不切换，跨设备冲突不重放旧内容', async () => {
  await withDetail(async ({ page, state, store }) => {
    state.onPush = () => ({ ok: false, code: 'INVALID_PAYLOAD' });
    await page.onMoreArchive();
    assert.equal(page.data.archived, false); assert.equal(page.data.archiveUnknown, false);
    assert.equal(page.pendingArchive, null); assert.deepEqual(state.toasts, []);
    state.onPush = () => {
      state.record = { ...state.record, text: '另一设备的新正文', updatedAt: 9000 }; state.version++;
      return { ok: false, code: 'CONFLICT' };
    };
    await page.onMoreArchive();
    assert.equal(store.getInspiration('idea').text, '另一设备的新正文');
    assert.match(page.data.error, /其他设备更新/);
    const attempts = state.writes.length; await page.onMoreArchive();
    assert.equal(state.writes.length, attempts); assert.equal(page.data.archived, false);
  });
});

test('详情归档：只读事件拦截所有修改，保留复制、历史、照片、文字留档及整条删除', async () => {
  await withDetail(async ({ page, store, state }) => {
    const original = structuredClone(store.getInspiration('idea'));
    const blocked = ['onStartEdit', 'onEditInput', 'onSaveEdit', 'onMoreEditText', 'onOpenOutput', 'onLocateCompose',
      'onToggleOrganization', 'onTagsInput', 'onStageSelect', 'onSaveOrganization', 'onRestoreInspiration',
      'onAddPhoto', 'addPhotos', 'onDeletePhoto', 'onComposeFocus', 'onSupplementInput', 'onSubmitSupplement',
      'onSheetEdit', 'onSupplementEditInput', 'onSupplementEditSave', 'onSheetFold', 'onSheetRestore', 'onSheetDelete'];
    Object.assign(page.data, { canSaveEdit: true, canSaveSupplementEdit: true, canAddSupplement: true,
      sheetTargetId: 'sup', editingSupplementId: '', longText: true });
    for (const handler of blocked) await page[handler]({ ...event('sup'), ...input('不得写入') });
    assert.equal(page.data.editing, false); assert.equal(page.data.composeFocus, false);
    assert.equal(page.data.orgOpen, false); assert.equal(page.data.supplementDraft, '');
    assert.equal(state.writes.length, 0); assert.deepEqual(state.routes, []);
    page.setData({ confirmVisible: true, confirmKind: 'supplement' }); await page.onConfirmDelete();
    assert.equal(state.writes.length, 0); page.onConfirmDismiss();
    page.onPageScroll({ scrollTop: 10000 }); assert.equal(page.data.floatVisible, false);
    page.onMoreCopy(); assert.ok(state.copied[0].includes('当前正文\n保留换行'));
    assert.ok(state.copied[0].includes('当前补充\n完整文字'));
    page.onMoreHistory(); assert.equal(state.routes.pop(), '/pages/history/index?id=idea');
    page.openSupplementActions('sup'); page.onSheetHistory();
    assert.equal(state.routes.pop(), '/pages/history/index?id=idea&supplementId=sup');
    page.onPreviewPhoto(event('photo')); assert.equal(state.routes.pop(), '/pages/photo-viewer/index?id=idea&photo=photo');
    page.onOpenArchiveExport(); assert.equal(state.routes.pop(), '/pages/output/index?id=idea&exportOnly=1');
    assert.deepEqual(store.getInspiration('idea'), original);
    page.onMoreDelete(); assert.equal(page.data.confirmKind, 'inspiration');
    await page.onConfirmDelete(); assert.equal(store.getInspiration('idea'), null); assert.equal(state.back, 1);
  }, core.markArchived(sample(), { now: 5000 }));
});

test('详情归档：当前记录归档即阻挡尚未重绘的旧详情修改，合并来源须先恢复', async () => {
  await withDetail(async ({ page, store, state }) => {
    await store.saveInspiration(core.markArchived(store.getInspiration('idea'), { now: 5000 }));
    assert.equal(page.data.archived, false);
    const writes = state.writes.length;
    page.onStartEdit(); page.onToggleOrganization(); await page.addPhotos('album');
    assert.equal(page.data.editing, false); assert.equal(page.data.orgOpen, false);
    assert.equal(state.writes.length, writes);
    page.load(); assert.equal(page.data.archived, true);
  });
  await withDetail(async ({ page, state }) => {
    await page.onMoreArchive(); assert.equal(state.writes.length, 0);
    assert.match(page.data.error, /先恢复为独立灵感/);
  }, { ...sample(), mergedInto: 'summary' });
});

test('详情归档：页面隐藏及账户切换拒绝迟到回执，重新展示只读确认快照', async () => {
  for (const change of ['page', 'account']) await withDetail(async ({ page, app, state, freshStore }) => {
    let finish;
    state.onPush = payload => new Promise(resolve => { finish = () => {
      state.record = structuredClone(payload.upserts[0]); state.version++;
      resolve({ ok: true, data: { version: state.version } });
    }; });
    const saving = page.onMoreArchive(); await flush();
    if (change === 'page') page.onHide();
    else {
      app.globalData.sessionEpoch++;
      app.globalData.store = freshStore({ ...sample(), text: '新账户内容' }); page.load();
    }
    await flush();
    const before = structuredClone(page.data); finish(); await saving;
    assert.deepEqual(page.data, before); assert.deepEqual(state.toasts, []);
    if (change === 'page') {
      await page.onShow(); assert.equal(page.data.archived, true); assert.equal(page.data.archiveUnknown, false);
    } else {
      assert.equal(page.data.text, '新账户内容'); assert.equal(page.data.archived, false);
      assert.equal(page.pendingArchive, null);
    }
  });
});
