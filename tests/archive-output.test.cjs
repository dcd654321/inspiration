'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../miniprogram/core/inspiration');
const { createSessionDrafts } = require('../miniprogram/services/session-drafts');
const { listMaterials, buildMaterialDraft } = require('../miniprogram/services/material-output');
const { organize } = require('../miniprogram/services/organization');

const input = (value) => ({ detail: { value } });
const event = (dataset) => ({ currentTarget: { dataset } });

async function withPages(run) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const paths = ['output', 'material-output'].map((name) => require.resolve('../miniprogram/pages/' + name + '/index'));
  const state = { items: [core.appendSupplement(core.createInspiration({ id: 'one', text: '正文', now: 100 }),
    { id: 'supplement', content: '补充', now: 110 })], copies: [], saves: [], files: [], removed: [], titles: [], redirects: [], dialogs: [], draftCalls: [], metrics: [] };
  const memory = createSessionDrafts();
  const owner = { cacheScope: 'a'.repeat(32), generation: 1 };
  memory.bind(owner);
  const store = {
    getConfirmedRevision: () => ({ generation: 1, baseVersion: 1 }),
    getInspiration: (id) => state.items.find((item) => item.id === id),
    listInspirations: () => state.items.filter((item) => !core.isArchived(item)),
    async refresh() { state.refreshes = (state.refreshes || 0) + 1; if (state.refresh) state.refresh(); return { ok: true, synced: true }; },
    async saveInspiration(item) { state.saves.push(item); return state.saveResult || { ok: true, synced: true }; }
  };
  const drafts = Object.fromEntries(['get', 'put', 'remove'].map((name) => [name, (...args) => {
    state.draftCalls.push(name); return memory[name](...args);
  }]));
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: owner.cacheScope, sessionDrafts: drafts,
    metrics: { track: (name) => state.metrics.push(name) } },
  ensureReady: async () => app.globalData.store, refreshAccount: async () => app.globalData.store };
  try {
    global.getApp = () => app;
    global.wx = {
      env: { USER_DATA_PATH: '/mock' },
      setNavigationBarTitle: ({ title }) => state.titles.push(title),
      setClipboardData: (options) => state.copies.push(options),
      redirectTo: (options) => state.redirects.push(options.url),
      showModal: (options) => state.dialogs.push(options),
      enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, pageScrollTo() {},
      getFileSystemManager: () => ({ writeFile: (options) => state.files.push(options), unlink: ({ filePath }) => state.removed.push(filePath) })
    };
    const createPage = async (name = 'output', query = { id: 'one' }) => {
      let definition;
      global.Page = (value) => { definition = value; };
      const file = require.resolve('../miniprogram/pages/' + name + '/index');
      delete require.cache[file]; require(file);
      const page = Object.assign({}, definition, { data: structuredClone(definition.data),
        setData(next, done) { Object.assign(this.data, next); if (done) done(); } });
      await page.onLoad(query);
      return page;
    };
    await run({ state, app, store, memory, owner, createPage });
  } finally {
    paths.forEach((file) => { delete require.cache[file]; });
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('待办成稿：仅改变正文或补充待办不使会话稿失效，另存仍为普通灵感', async () => {
  await withPages(async ({ state, createPage }) => {
    const page = await createPage();
    page.onDraftInput(input('已经手工修改过的稿件'));
    page.onHide();
    state.items[0] = { ...state.items[0], todo: { createdAt: 200, completedAt: 210, dueDate: null },
      supplements: state.items[0].supplements.map(item => ({ ...item, todo: { createdAt: 220, completedAt: null, dueDate: '2026-10-25' } })) };
    const recovered = await createPage();
    assert.equal(recovered.data.sourceStale, false);
    assert.equal(recovered.data.draft, '已经手工修改过的稿件');
    await recovered.onSaveAsNew();
    assert.equal(state.saves.length, 1);
    assert.equal(state.saves[0].todo, null);
    assert.equal(state.saves[0].text, '已经手工修改过的稿件');
  });
});

test('归档留档：普通路由和 exportOnly 路由强制独立只读，关闭及事件不能露出编辑器', async () => {
  for (const archived of [true, false]) await withPages(async ({ state, createPage }) => {
    if (archived) state.items[0] = core.markArchived(state.items[0], { now: 200 });
    const page = await createPage('output', { id: 'one', ...(archived ? {} : { exportOnly: '1' }) });
    assert.equal(page.data.exportOnly, true); assert.equal(page.data.phase, 'export');
    assert.equal(state.titles.at(-1), '文字留档');
    assert.match(page.data.archive, /正文/); assert.match(page.data.archive, /补充/);
    page.onOpenContent(); page.onOpenFormat(); page.onOpenMore(); page.onOpenArchive(); page.onClosePanel();
    page.onToggleSupplement(event({ id: 'supplement' })); page.onTemplateSelect(event({ template: 'work' }));
    page.onApply(); page.onDraftInput(input('不能写入')); await page.onSaveAsNew(); page.onCopyDraft();
    assert.equal(page.data.phase, 'export'); assert.equal(page.data.draft, ''); assert.deepEqual(page.data.options, []);
    assert.equal(state.saves.length, 0); assert.equal(state.copies.length, 0);
    page.onCopyArchive(); assert.equal(state.copies[0].data, page.data.archive); state.copies[0].success();
    assert.equal(state.metrics.length, 0, '留档复制不计作稿件复制');
    page.onReturnDetail(); assert.equal(state.redirects[0], '/pages/detail/index?id=one');
    page.onHide(); page.onUnload(); assert.deepEqual(state.draftCalls, []);
  });
  const wxml = fs.readFileSync(require.resolve('../miniprogram/pages/output/index.wxml'), 'utf8');
  const readonly = wxml.match(/<block wx:elif="\{\{exportOnly\}\}">([\s\S]*?)<\/block>/)[1];
  assert.doesNotMatch(readonly, /textarea|onApply|onSaveAsNew|onOpenFormat/);
  assert.match(readonly, /onCopyArchive/); assert.match(readonly, /onCreateTxt/); assert.match(readonly, /返回详情/);
});

test('归档留档：读取重试与退出均不读取覆盖删除普通会话稿，恢复后可接续原稿', async () => {
  await withPages(async ({ state, createPage, memory, owner }) => {
    const ordinary = await createPage(); ordinary.onDraftInput(input('未另存的普通稿件')); ordinary.onHide();
    const saved = memory.get('output:one', owner); assert.equal(saved.data.draft, '未另存的普通稿件');
    state.items[0] = core.markArchived(state.items[0], { now: 200 }); state.draftCalls = [];
    const readonly = await createPage(); await readonly.onRetryLoad(); readonly.onCreateTxt();
    assert.equal(state.files.length, 1); assert.equal(state.files[0].data, readonly.data.archive);
    state.files[0].success(); const path = readonly.data.txtPath; readonly.onHide();
    assert.ok(state.removed.includes(path)); assert.deepEqual(state.draftCalls, []);
    assert.deepEqual(memory.get('output:one', owner), saved);
    state.items[0] = core.unarchive(state.items[0]);
    const restored = await createPage(); assert.equal(restored.data.exportOnly, false);
    assert.equal(restored.data.draft, '未另存的普通稿件'); assert.equal(restored.data.sourceStale, false);
  });
});

test('归档留档：先核验记录存在再接续稿件，缺失来源不会恢复普通编辑', async () => {
  await withPages(async ({ state, createPage }) => {
    const ordinary = await createPage(); ordinary.onDraftInput(input('来源已删除的稿件')); ordinary.onHide();
    state.items = []; state.draftCalls = [];
    const page = await createPage(); assert.equal(page.data.missing, true); assert.equal(page.data.draft, '');
    page.onDraftInput(input('不能新写')); await page.onSaveAsNew();
    assert.equal(state.saves.length, 0); assert.deepEqual(state.draftCalls, []);
  });
});

test('归档留档：普通稿件重新读取才发现来源归档时保留会话稿，不执行只读恢复或删除', async () => {
  await withPages(async ({ state, createPage, memory, owner }) => {
    const page = await createPage(); page.onDraftInput(input('重新读取前仍需保留的稿件'));
    state.items[0] = core.markArchived(state.items[0], { now: 200 }); state.draftCalls = [];
    page.onRetryLoad(); state.dialogs[0].success({ confirm: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.exportOnly, true); assert.equal(page.data.phase, 'export');
    assert.deepEqual(state.draftCalls, ['put'], '仅在离开普通模式前保留一次会话稿');
    assert.equal(memory.get('output:one', owner).data.draft, '重新读取前仍需保留的稿件');
    page.onHide(); assert.deepEqual(state.draftCalls, ['put']);
  });
});

test('归档来源：单条稿件中途归档冻结编辑格式生成另存，保留全文供复制并要求重新核对', async () => {
  await withPages(async ({ state, createPage }) => {
    const page = await createPage(); page.onDraftInput(input('已编辑好的稿件'));
    state.items[0] = core.markArchived(state.items[0], { now: 200 });
    page.onDraftInput(input('不能覆盖')); page.onOpenFormat(); page.onApply(); await page.onSaveAsNew();
    assert.equal(page.data.draft, '已编辑好的稿件'); assert.equal(page.data.sourceStale, true); assert.equal(page.data.canSaveAs, false);
    assert.match(page.data.error, /归档/); assert.equal(state.saves.length, 0);
    page.onCopyDraft(); assert.equal(state.copies[0].data, '已编辑好的稿件'); state.copies[0].success();
    state.items[0] = core.unarchive(state.items[0]); page.onDraftInput(input('尚未核对不能改'));
    assert.equal(page.data.draft, '已编辑好的稿件');
    page.onOpenContent(); assert.equal(state.dialogs.length, 1); state.dialogs[0].success({ confirm: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.sourceStale, false); assert.equal(page.data.draft, '正文\n补充');
    page.onDraftInput(input('重新核对后的稿件')); await page.onSaveAsNew(); assert.equal(state.saves.length, 1);
  });
});

test('归档来源：替换确认出现后来源归档不能执行迟到的生成确认', async () => {
  await withPages(async ({ state, createPage }) => {
    const page = await createPage(); page.onDraftInput(input('确认前的手工稿'));
    page.onOpenContent(); page.onToggleSupplement(event({ id: 'supplement' })); page.onApply();
    assert.equal(state.dialogs.length, 1); state.items[0] = core.markArchived(state.items[0], { now: 200 });
    state.dialogs[0].success({ confirm: true });
    assert.equal(page.data.draft, '确认前的手工稿'); assert.equal(page.data.sourceStale, true);
  });
});

test('归档留档：账户切换和离开后的复制与文件回执不回填，迟到文件仍被清理', async () => {
  await withPages(async ({ state, app, createPage }) => {
    state.items[0] = core.markArchived(state.items[0], { now: 200 });
    const page = await createPage(); page.onCopyArchive(); page.onCreateTxt();
    app.globalData.sessionEpoch++; app.globalData.store = null;
    state.copies[0].success(); state.files[0].success();
    assert.equal(page.data.notice, ''); assert.equal(page.data.txtPath, ''); assert.equal(state.removed[0], state.files[0].filePath);
    page.onHide(); page.onCopyArchive(); page.onCreateTxt();
    assert.equal(state.copies.length, 1); assert.equal(state.files.length, 1); assert.deepEqual(state.draftCalls, []);
  });
});

test('归档选材：正文及补充排除归档，旧选材拒绝生成，标签阶段先取消归档', async () => {
  await withPages(async ({ state }) => {
    const selections = listMaterials(state.items); assert.equal(selections.length, 2);
    state.items[0] = core.markArchived(state.items[0], { now: 0 });
    assert.deepEqual(listMaterials(state.items), []);
    assert.throws(() => buildMaterialDraft(state.items, selections, 'free'), /来源已修改/);
    assert.throws(() => organize(state.items[0], { tags: ['标签'], stage: 'ready', now: 300 }), /取消归档/);
  });
});

test('归档选材：来源中途归档冻结生成编辑另存并保留稿件，账户切换的复制回执不回填', async () => {
  await withPages(async ({ state, app, createPage }) => {
    const page = await createPage('material-output'); page.onToggle(event({ key: 'one:text' })); page.onGenerate();
    page.onInput(input('跨素材手工稿件')); state.items[0] = core.markArchived(state.items[0], { now: 200 });
    page.onInput(input('不能覆盖')); page.onGenerate(); page.onTemplate(event({ template: 'work' })); await page.onSave();
    assert.equal(page.data.draft, '跨素材手工稿件'); assert.equal(page.data.sourceStale, true); assert.equal(state.saves.length, 0);
    page.onCopy(); assert.equal(state.copies[0].data, '跨素材手工稿件');
    app.globalData.sessionEpoch++; app.globalData.store = null; state.copies[0].success();
    assert.equal(page.data.draft, ''); assert.equal(page.data.notice, ''); assert.equal(state.saves.length, 0);
  });
});

test('归档来源：未知另存已存在完整快照时先结清确认，来源失效不重发写入', async () => {
  for (const name of ['output', 'material-output']) await withPages(async ({ state, createPage }) => {
    const page = await createPage(name);
    if (name === 'output') page.onDraftInput(input('等待确认的稿件'));
    else { page.onToggle(event({ key: 'one:text' })); page.onGenerate(); page.onInput(input('等待确认的稿件')); }
    const save = () => name === 'output' ? page.onSaveAsNew() : page.onSave();
    state.saveResult = { ok: false, code: 'NETWORK' }; await save();
    assert.equal(page.data.saveUnknown, true); const committed = page.pendingSave.item;
    state.items.push(committed); state.items[0] = core.markArchived(state.items[0], { now: 200 });
    page.setData({ sourceStale: true }); await save();
    assert.equal(page.data.saveUnknown, false); assert.equal(page.data.savedId, committed.id);
    assert.equal(page.pendingSave, null); assert.equal(state.saves.length, 1); assert.equal(page.data.draft, '等待确认的稿件');
  });
});

test('归档来源：未知另存未确认时只能回读，完整目标匹配后结清且不新增写入', async () => {
  for (const name of ['output', 'material-output']) await withPages(async ({ state, createPage }) => {
    const page = await createPage(name);
    if (name === 'output') page.onDraftInput(input('尚待确认的稿件'));
    else { page.onToggle(event({ key: 'one:text' })); page.onGenerate(); page.onInput(input('尚待确认的稿件')); }
    const save = () => name === 'output' ? page.onSaveAsNew() : page.onSave();
    state.saveResult = { ok: false, code: 'NETWORK' }; await save(); const expected = page.pendingSave.item;
    state.items[0] = core.markArchived(state.items[0], { now: 200 });
    await save(); assert.equal(page.data.saveUnknown, true); assert.equal(state.saves.length, 1); assert.equal(state.refreshes, 1);
    state.refresh = () => { state.items.push(Object.assign({}, expected, { photos: [{ id: 'unexpected', fileId: 'cloud://unexpected' }] })); };
    await save(); assert.equal(page.data.saveUnknown, true, '照片差异同样不能误认完全相同的另存结果'); assert.equal(state.saves.length, 1);
    state.refresh = () => { state.items = state.items.filter((item) => item.id !== expected.id).concat([expected]); };
    await save(); assert.equal(page.data.saveUnknown, false); assert.equal(page.data.savedId, expected.id); assert.equal(state.saves.length, 1);
    assert.equal(page.data.draft, '尚待确认的稿件');
  });
});

test('归档选材：恢复稿件的来源全部归档时仍显示全文及复制入口', async () => {
  await withPages(async ({ state, createPage }) => {
    const original = await createPage('material-output'); original.onToggle(event({ key: 'one:text' })); original.onGenerate();
    original.onInput(input('来源全归档也能复制的稿件')); original.onHide();
    state.items[0] = core.markArchived(state.items[0], { now: 200 });
    const page = await createPage('material-output'); assert.equal(page.data.total, 0); assert.equal(page.data.sourceStale, true);
    assert.equal(page.data.draft, '来源全归档也能复制的稿件'); page.onCopy(); assert.equal(state.copies[0].data, page.data.draft);
    const wxml = fs.readFileSync(require.resolve('../miniprogram/pages/material-output/index.wxml'), 'utf8');
    assert.match(wxml, /wx:elif="\{\{error && !total && !draft\}\}"/);
  });
});

test('归档来源：未知另存回读跨账户的迟到目标不能结清新会话，核对入口不受来源冻结阻挡', async () => {
  for (const name of ['output', 'material-output']) await withPages(async ({ state, app, store, createPage }) => {
    const page = await createPage(name);
    if (name === 'output') page.onDraftInput(input('等待账户内核对的稿件'));
    else { page.onToggle(event({ key: 'one:text' })); page.onGenerate(); }
    const save = () => name === 'output' ? page.onSaveAsNew() : page.onSave();
    state.saveResult = { ok: false, code: 'NETWORK' }; await save(); const expected = page.pendingSave.item;
    state.items[0] = core.markArchived(state.items[0], { now: 200 });
    let resolve; store.refresh = () => new Promise((done) => { resolve = done; });
    const verifying = save(); assert.equal(page.data.busy, true);
    app.globalData.sessionEpoch++; app.globalData.store = null; state.items.push(expected);
    resolve({ ok: true, synced: true }); await verifying;
    assert.equal(page.data.savedId, ''); assert.equal(state.saves.length, 1);
    const wxml = fs.readFileSync(require.resolve('../miniprogram/pages/' + name + '/index.wxml'), 'utf8');
    const binding = name === 'output' ? 'onSaveAsNew' : 'onSave';
    const disabled = wxml.match(new RegExp('bindtap="' + binding + '" disabled="([^\"]+)"'))[1];
    assert.match(disabled, /!saveUnknown &&/);
  });
});
