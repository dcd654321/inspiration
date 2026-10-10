'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createCaptureDrafts } = require('../miniprogram/services/capture-drafts');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const input = (value) => ({ detail: { value } });

async function withPage(name, run) {
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  const old = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  const state = { items: [core.createInspiration({ id: 'ins_review', text: '散步路线想法', now: Date.now() })],
    saves: [], alerts: [], disabledAlerts: 0, scrolls: [], toasts: [], copies: [], refreshes: 0 };
  const store = {
    getInspiration: (id) => state.items.find((x) => x.id === id),
    listInspirations: () => state.items,
    readSnapshot: () => ({ inspirations: state.items }),
    async refresh() { state.refreshes++; return { ok: true, synced: true }; },
    async saveInspiration(next) {
      state.saves.push(next);
      const result = state.save ? await state.save(next) : { ok: true, synced: true };
      if (result && result.ok && result.synced) state.items = state.items.filter((x) => x.id !== next.id).concat([next]);
      return result;
    }
  };
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: 'a'.repeat(32),
    drafts: createCaptureDrafts() }, ensureReady: async () => app.globalData.store,
    refreshAccount: async () => { throw Error('should not reauthenticate a confirmed session'); } };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = { showToast: (options) => state.toasts.push(options.title),
      pageScrollTo: (options) => state.scrolls.push(options),
      enableAlertBeforeUnload: (options) => state.alerts.push(options.message),
      disableAlertBeforeUnload: () => state.disabledAlerts++,
      setClipboardData: (options) => { state.copies.push(options.data); options.success(); } };
    delete require.cache[file]; require(file);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data),
      setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } });
    if (name === 'list') await page.onShow();
    else await page.onLoad({ id: 'ins_review' });
    await run({ page, state, app, store });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('复核：单条整理迟到读取不回填旧页面或账户', async () => {
  for (const stale of ['unloaded', 'account', 'newer']) await withPage('output', async ({ page, app, store }) => {
    const wait = deferred(); app.ensureReady = () => wait.promise;
    const loading = page.onLoad({ id: 'ins_review' });
    if (stale === 'unloaded') page.onUnload();
    else { app.globalData.store = Object.assign({}, store); app.globalData.sessionEpoch++; }
    if (stale === 'newer') { app.ensureReady = async () => app.globalData.store; await page.onLoad({ id: 'ins_review' }); }
    page.setData({ ready: true, draft: '新页面当前输入', archive: '新留档' });
    wait.resolve(store); await loading;
    assert.equal(page.data.draft, '新页面当前输入', stale); assert.equal(page.data.archive, '新留档', stale);
  });
  await withPage('output', async ({ page, app, store }) => {
    const wait = deferred(); let calls = 0; app.ensureReady = () => { calls++; return wait.promise; };
    const loading = page.onLoad({ id: 'ins_review' }), showing = page.onShow();
    wait.resolve(store); await Promise.all([loading, showing]); assert.equal(calls, 1);
  });
});

test('复核：单条整理过期重读不覆盖新稿', async () => {
  await withPage('output', async ({ page, app, store }) => {
    const wait = deferred(); app.refreshAccount = () => wait.promise;
    const reloading = page.onRetryLoad(); page.onUnload();
    await page.onLoad({ id: 'ins_review' }); page.onDraftInput(input('重读期间新输入'));
    wait.resolve(store); await reloading; await new Promise(setImmediate);
    assert.equal(page.data.draft, '重读期间新输入');
  });
});

test('复核：单条替换确认只作用于原稿面板和素材', async () => {
  for (const change of ['draft', 'panel', 'account', 'source', 'unloaded', 'saving']) await withPage('output', async ({ page, app, state }) => {
    let modal; global.wx.showModal = (options) => { modal = options; };
    page.onDraftInput(input('用户原稿')); page.onOpenFormat();
    page.onTemplateSelect({ currentTarget: { dataset: { template: 'work' } } }); page.onApply();
    assert.ok(modal);
    if (change === 'draft') page.onDraftInput(input('期间新编辑'));
    if (change === 'panel') page.onClosePanel();
    if (change === 'account') { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    if (change === 'source') state.items[0] = Object.assign({}, state.items[0], { text: '来源期间变化' });
    if (change === 'unloaded') page.onUnload();
    if (change === 'saving') page.setData({ busy: true });
    const before = page.data.draft; modal.success({ confirm: true });
    assert.equal(page.data.draft, before, change); assert.equal(page.data.templateId, 'free', change);
  });
});

test('复核：单条复制失败回执不回填新页面', async () => {
  for (const stale of ['unloaded', 'account', 'newer']) await withPage('output', async ({ page, app }) => {
    let copy; global.wx.setClipboardData = (options) => { copy = options; }; page.onCopyDraft();
    if (stale === 'unloaded') page.onUnload();
    if (stale === 'account') app.globalData.sessionEpoch++;
    if (stale === 'newer') await page.onLoad({ id: 'ins_review' });
    page.setData({ error: '新反馈', notice: '新状态' }); copy.fail();
    assert.equal(page.data.error, '新反馈', stale); assert.equal(page.data.notice, '新状态', stale);
  });
});

test('复核：过期留档文件只清理自身不回填', async () => {
  for (const outcome of ['success', 'fail']) await withPage('output', async ({ page }) => {
    let write; const removed = [];
    global.wx.env = { USER_DATA_PATH: '/tmp' };
    global.wx.getFileSystemManager = () => ({ writeFile: (options) => { write = options; }, unlink: (options) => removed.push(options.filePath) });
    page.onCreateTxt(); const oldFile = write.filePath;
    page.onUnload(); await page.onLoad({ id: 'ins_review' });
    page.setData({ txtPath: '新文件', error: '新反馈', notice: '新状态' }); write[outcome]();
    assert.equal(page.data.txtPath, '新文件'); assert.equal(page.data.error, '新反馈'); assert.equal(page.data.notice, '新状态');
    assert.deepEqual(removed, outcome === 'success' ? [oldFile] : []);
  });
});

test('复核：文件发送迟到回执不修改新页面', async () => {
  for (const outcome of ['success', 'fail']) await withPage('output', async ({ page, app }) => {
    let share; global.wx.shareFileMessage = (options) => { share = options; };
    page.setData({ txtPath: '待发送文件' }); page.onShareTxt();
    app.globalData.sessionEpoch++; page.setData({ error: '新反馈', notice: '新状态', busy: false }); share[outcome]();
    assert.equal(page.data.error, '新反馈'); assert.equal(page.data.notice, '新状态'); assert.equal(page.data.busy, false);
  });
});

test('复核：单条另存迟到回执不标记重新进入的新稿', async () => {
  await withPage('output', async ({ page, state }) => {
    const wait = deferred(); state.save = () => wait.promise;
    page.onDraftInput(input('旧页面提交')); const saving = page.onSaveAsNew();
    page.onUnload(); await page.onLoad({ id: 'ins_review' }); page.onDraftInput(input('重新进入的新稿'));
    wait.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, '重新进入的新稿'); assert.equal(page.data.savedId, ''); assert.equal(page.data.notice, '');
  });
});

test('交互修复：补充确认期间忽略新输入并只添加提交正文', async () => {
  await withPage('detail', async ({ page, state, app }) => {
    const pending = deferred(); state.save = () => pending.promise;
    page.onSupplementInput(input('补充 A')); const saving = page.onSubmitSupplement();
    page.onSupplementInput(input('补充 B')); await page.onSubmitSupplement();
    assert.equal(page.data.supplementDraft, '补充 A');
    assert.equal(app.globalData.drafts.get('ins_review'), '补充 A');
    assert.equal(state.saves.length, 1);
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.deepEqual(state.items[0].supplements.map((x) => x.content), ['补充 A']);
    assert.equal(page.data.supplementDraft, ''); assert.equal(page.data.pending, '');
  });
});

test('交互修复：补充失败保留输入且重试同一补充标识', async () => {
  await withPage('detail', async ({ page, state, app }) => {
    state.save = async () => ({ ok: false, code: 'NETWORK' });
    page.onSupplementInput(input('补充 A')); await page.onSubmitSupplement();
    assert.equal(page.data.supplementDraft, '补充 A');
    assert.equal(app.globalData.drafts.get('ins_review'), '补充 A');
    state.save = async () => ({ ok: true, synced: true }); await page.onSubmitSupplement();
    assert.equal(state.saves[0].supplements[0].id, state.saves[1].supplements[0].id);
    assert.equal(state.items[0].supplements.length, 1);
  });
});

test('交互修复：补充迟到响应不清空新账户输入或会话草稿', async () => {
  await withPage('detail', async ({ page, state, app }) => {
    const pending = deferred(); state.save = () => pending.promise;
    page.onSupplementInput(input('旧账户补充')); const saving = page.onSubmitSupplement();
    app.globalData.store = {}; app.globalData.sessionEpoch++;
    app.globalData.drafts = createCaptureDrafts(); app.globalData.drafts.set('ins_review', '新账户输入');
    page.setData({ supplementDraft: '新账户输入', pending: '' });
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.supplementDraft, '新账户输入');
    assert.equal(app.globalData.drafts.get('ins_review'), '新账户输入'); assert.equal(state.toasts.length, 0);
  });
});

test('交互修复：补充重试使用最新正文而不覆盖期间其他修改', async () => {
  await withPage('detail', async ({ page, state }) => {
    state.save = async () => ({ ok: false, code: 'NETWORK' });
    page.onSupplementInput(input('补充 A')); await page.onSubmitSupplement();
    state.items = [Object.assign({}, state.items[0], { text: '期间修改的正文', tags: ['保留标签'] })];
    state.save = async () => ({ ok: true, synced: true }); await page.onSubmitSupplement();
    assert.equal(state.items[0].text, '期间修改的正文'); assert.deepEqual(state.items[0].tags, ['保留标签']);
    assert.equal(state.saves[0].supplements[0].id, state.items[0].supplements[0].id);
  });
});

test('交互修复：刷新已确认原补充后重试不追加第二条', async () => {
  await withPage('detail', async ({ page, state }) => {
    state.save = async () => ({ ok: false, code: 'NETWORK' });
    page.onSupplementInput(input('补充 A')); await page.onSubmitSupplement();
    state.items = [state.saves[0]];
    state.save = async () => ({ ok: true, synced: true }); await page.onSubmitSupplement();
    assert.equal(state.items[0].supplements.length, 1); assert.equal(page.data.supplementDraft, '');
  });
});

test('交互修复：离开详情后的补充回执不覆盖重新进入的页面', async () => {
  await withPage('detail', async ({ page, state }) => {
    const pending = deferred(); state.save = () => pending.promise;
    page.onSupplementInput(input('提交的补充')); const saving = page.onSubmitSupplement();
    page.onHide(); page.visible = true; page.viewVersion++;
    page.setData({ supplementDraft: '返回后输入', pending: '' });
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.supplementDraft, '返回后输入'); assert.equal(state.toasts.length, 0);
  });
});

test('交互修复：另存确认期间忽略编辑且已另存对应实际正文', async () => {
  await withPage('output', async ({ page, state }) => {
    const pending = deferred(); state.save = () => pending.promise;
    page.onDraftInput(input('稿件 A')); const saving = page.onSaveAsNew();
    page.onDraftInput(input('稿件 B')); await page.onSaveAsNew();
    assert.equal(page.data.draft, '稿件 A'); assert.equal(state.saves.length, 1);
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.savedDraft, page.data.draft); assert.equal(state.saves[0].text, page.data.draft);
    assert.equal(page.data.savedSame, true); assert.equal(page.data.canSaveAs, false);
    page.onDraftInput(input('稿件 B'));
    assert.equal(page.data.savedSame, false); assert.equal(page.data.canSaveAs, true);
  });
});

test('交互修复：单条另存未知、异常与拒绝保持准确反馈和同稿标识', async () => {
  await withPage('output', async ({ page, state }) => {
    page.onDraftInput(input('需要确认的稿件'));
    for (const result of [null, { ok: false, code: 'NETWORK' }, { ok: false, code: 'INTERNAL' }]) {
      state.save = async () => result; await page.onSaveAsNew();
      assert.match(page.data.error, /尚未确认另存/); assert.equal(page.data.draft, '需要确认的稿件');
    }
    state.save = async () => { throw Error('network'); }; await page.onSaveAsNew();
    assert.match(page.data.error, /尚未确认另存/);
    state.save = async () => ({ ok: false, code: 'INVALID_PAYLOAD' }); await page.onSaveAsNew();
    assert.match(page.data.error, /未能另存/); assert.doesNotMatch(page.data.error, /尚未确认/);
    state.save = async () => ({ ok: true, synced: true }); await page.onSaveAsNew();
    assert.equal(new Set(state.saves.map((x) => x.id)).size, 1); assert.equal(page.data.error, '');
    assert.equal(page.data.savedSame, true);
  });
});

test('交互修复：另存旧账户响应不标记当前稿件成功', async () => {
  await withPage('output', async ({ page, state, app }) => {
    const pending = deferred(); state.save = () => pending.promise;
    page.onDraftInput(input('旧稿')); const saving = page.onSaveAsNew();
    app.globalData.store = {}; app.globalData.sessionEpoch++;
    page.setData({ draft: '当前稿', savedSame: false, savedId: '', notice: '' });
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.draft, '当前稿'); assert.equal(page.data.savedSame, false);
    assert.equal(page.data.savedId, ''); assert.equal(page.data.notice, '');
  });
});

test('交互修复：稿件编辑开启离开提醒复制不当作另存', async () => {
  await withPage('output', async ({ page, state }) => {
    const initial = state.alerts.length;
    page.onDraftInput(input('编辑后的稿件')); assert.equal(state.alerts.length, initial + 1);
    const disables = state.disabledAlerts; page.onCopyDraft();
    assert.equal(state.disabledAlerts, disables); assert.equal(page.data.savedSame, false);
    page.onHide(); assert.ok(state.disabledAlerts > disables);
    await page.onShow(); assert.equal(state.alerts.length, initial + 1, '缺少受信代际的测试账户不得恢复私人编辑');
    await page.onSaveAsNew(); const afterSave = state.disabledAlerts;
    page.onDraftInput(input('再次编辑')); assert.equal(state.alerts.length, initial + 2);
    page.onUnload(); assert.ok(state.disabledAlerts > afterSave);
    assert.equal(page.data.draft, '', '卸载后可见私人内容清空，恢复由受信账户会话测试覆盖');
  });
});

test('交互修复：多素材稿件生成和再编辑提醒未另存', async () => {
  await withPage('material-output', async ({ page, state }) => {
    page.onToggle({ currentTarget: { dataset: { key: page.data.options[0].key } } }); page.onGenerate();
    assert.equal(state.alerts.length, 1); await page.onSave();
    const disabled = state.disabledAlerts;
    page.onInput(input('新编辑稿')); assert.equal(state.alerts.length, 2);
    page.onHide(); assert.ok(state.disabledAlerts > disabled); assert.equal(page.data.draft, '');
  });
});

test('交互修复：原生滚动高度同步且旧面板测量不覆盖新面板', async () => {
  await withPage('output', async ({ page }) => {
    const callbacks = [];
    global.wx.createSelectorQuery = () => ({ select() { return this; },
      boundingClientRect(callback) { callbacks.push(callback); return this; }, exec() {} });
    page.onOpenArchive(); page.onClosePanel(); page.onOpenArchive();
    callbacks[0]({ height: 900 }); assert.equal(page.data.sheetScrollHeight, 0);
    callbacks[1]({ height: 354.4 }); assert.equal(page.data.sheetScrollHeight, 354);
    page.onResize(); assert.equal(page.data.sheetScrollHeight, 0);
    page.onUnload(); callbacks[2]({ height: 100 }); assert.equal(page.data.sheetScrollHeight, 0);
  });
});

test('交互修复：多素材未知另存重试同一实体并忽略等待期间输入', async () => {
  await withPage('material-output', async ({ page, state }) => {
    page.onToggle({ currentTarget: { dataset: { key: page.data.options[0].key } } }); page.onGenerate();
    const pending = deferred(); state.save = () => pending.promise;
    const original = page.data.draft, saving = page.onSave(); page.onInput(input('等待期间新内容'));
    assert.equal(page.data.draft, original);
    pending.resolve({ ok: false, code: 'NETWORK' }); await saving;
    assert.match(page.data.error, /尚未确认另存/);
    state.save = async () => ({ ok: true, synced: true }); await page.onSave();
    assert.equal(state.saves[0].id, state.saves[1].id); assert.equal(page.data.error, '');
    assert.equal(page.data.savedDraft, original);
  });
});

test('交互修复：继续补充可重复请求焦点普通进入不请求', async () => {
  await withPage('detail', async ({ page, state }) => {
    assert.equal(page.data.composeRequestedFocus, false);
    page.onLocateCompose(); assert.equal(page.data.composeRequestedFocus, true);
    page.onComposeBlur(); assert.equal(page.data.composeRequestedFocus, false);
    page.onLocateCompose(); assert.equal(page.data.composeRequestedFocus, true); assert.equal(state.scrolls.length, 2);
    page.onHide(); assert.equal(page.data.composeRequestedFocus, false);
  });
});

test('交互修复：同一可信会话刷新失败保留列表查询和阅读位置', async () => {
  await withPage('list', async ({ page, state, app, store }) => {
    page.onSearch(input('散步')); page.savedScrollTop = 500; page.anchorId = 'ins_review';
    const previous = structuredClone(page.data.items), pending = deferred();
    app.ensureReady = () => pending.promise; store.readSnapshot = () => { throw Error('read'); };
    const loading = page.onShow(); assert.deepEqual(page.data.items, previous);
    pending.resolve(store); await loading;
    assert.deepEqual(page.data.items, previous); assert.equal(page.data.query, '散步');
    assert.equal(page.savedScrollTop, 500); assert.match(page.data.error, /仍显示上次读取/);
    assert.deepEqual(state.scrolls.at(-1), { selector: '#row-ins_review', duration: 0 });
  });
});

test('交互修复：列表重试不重新认证可信账户失败仍保留记录', async () => {
  await withPage('list', async ({ page, store }) => {
    const previous = structuredClone(page.data.items);
    store.refresh = async () => ({ ok: false, code: 'NETWORK' }); await page.onRetry();
    assert.deepEqual(page.data.items, previous); assert.equal(page.data.loading, false);
    assert.match(page.data.error, /仍显示上次读取/);
    store.refresh = async () => ({ ok: true, synced: true }); await page.onRetry();
    assert.equal(page.data.error, ''); assert.deepEqual(page.data.items, previous);
  });
});

test('交互修复：账户锁定或变化立即清除列表条件和旧内容', async () => {
  for (const change of ['scope', 'epoch', 'store', 'locked']) {
    await withPage('list', async ({ page, app, store }) => {
      page.onSearch(input('散步')); page.savedScrollTop = 500; page.anchorId = 'ins_review';
      if (change === 'scope') app.globalData.cacheScope = 'b'.repeat(32);
      if (change === 'epoch') app.globalData.sessionEpoch++;
      if (change === 'store') app.globalData.store = Object.assign({}, store);
      if (change === 'locked') { app.globalData.store = null; app.globalData.cacheScope = ''; }
      const pending = deferred(); app.ensureReady = () => pending.promise;
      const loading = page.onShow();
      assert.equal(page.data.items.length, 0, change); assert.equal(page.data.query, '', change);
      assert.equal(page.anchorId, '', change); page.onHide();
      pending.resolve(store); await loading; assert.equal(page.data.items.length, 0, change);
    });
  }
});

test('交互修复：列表首次读取失败有错误且旧加载不回填页面', async () => {
  await withPage('list', async ({ page, app, store }) => {
    page.onHide(); app.globalData.store = null; app.globalData.sessionEpoch++;
    app.ensureReady = async () => null; await page.onShow();
    assert.equal(page.data.items.length, 0); assert.equal(page.data.loading, false); assert.ok(page.data.error);
    app.globalData.store = store;
    const pending = deferred(); app.ensureReady = () => pending.promise;
    const loading = page.onShow(); page.onHide(); page.setData({ error: '新页面状态' });
    pending.resolve(store); await loading; assert.equal(page.data.error, '新页面状态');
    assert.equal(page.data.items.length, 0);
  });
});
