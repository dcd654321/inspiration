'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MATERIAL_LIMITS, listMaterials, buildMaterialDraft } = require('../miniprogram/services/material-output');

function sample() {
  return [
    { id: 'ins_a', text: '正文甲', createdAt: 1000, textHistory: [{ text: '旧正文' }], photos: [{ fileId: 'cloud://private' }], tags: ['私人标签'], supplements: [
      { id: 'sup_b', content: '补充乙', createdAt: 3000 },
      { id: 'sup_a', content: '补充甲', createdAt: 2000, contentHistory: [{ text: '旧补充' }] },
      { id: 'sup_fold', content: '收起补充', createdAt: 1500, foldedAt: 2000 },
      { id: 'sup_merge', content: '合并补充', createdAt: 1600, mergedInto: 'sup_a' }
    ] },
    { id: 'ins_b', text: '正文乙', createdAt: 4000, supplements: [] },
    { id: 'ins_gone', text: '已删除', createdAt: 5000, deletedAt: 6000 },
    { id: 'ins_merged', text: '已合并', createdAt: 5000, mergedInto: 'ins_a' }
  ];
}
function event(key) { return { currentTarget: { dataset: { key } } }; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; }

async function withPage(run) {
  const pagePath = require.resolve('../miniprogram/pages/material-output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const state = { items: sample(), saves: [], metrics: [], copies: [], modals: [], scrolls: [], savedResult: { ok: true, synced: true } };
  const store = {
    listInspirations() { return state.items; },
    async saveInspiration(item) { state.saves.push(item); return state.savedResult; }
  };
  const app = { globalData: { store, sessionEpoch: 1, metrics: { track(name) { state.metrics.push(name); } } },
    ensureReady() { return Promise.resolve(this.globalData.store); } };
  let definition;
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = {
      showModal(options) { state.modals.push(options); },
      setClipboardData(options) { state.copies.push(options); },
      pageScrollTo(options) { state.scrolls.push(options.scrollTop); },
      navigateTo() {}
    };
    delete require.cache[pagePath]; require(pagePath);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } });
    await page.onLoad();
    await run({ page, state, app, store });
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('跨记录选材只列有效正文补充，按选择顺序组合且来源不变', () => {
  const items = sample(), before = JSON.stringify(items);
  const materials = listMaterials(items);
  assert.deepEqual(materials.map((part) => part.content), ['正文甲', '补充甲', '补充乙', '正文乙']);
  assert.deepEqual(Object.keys(materials[0]).sort(), ['key', 'inspirationId', 'kind', 'content', 'sourceText', 'createdAt'].sort());
  const result = buildMaterialDraft(items, [materials[3], materials[1]], 'free');
  assert.deepEqual(result, { text: '正文乙\n\n补充甲', materialCount: 2, sourceCount: 2 });
  const template = buildMaterialDraft(items, [materials[3], materials[1]], 'work').text;
  assert.ok(template.includes('正文乙\n\n补充甲'));
  for (const omitted of ['正文甲', '补充乙', '旧正文', '旧补充', '私人标签', 'cloud://', '收起补充']) assert.ok(!template.includes(omitted));
  assert.equal(JSON.stringify(items), before);
});

test('跨记录选材拒绝失效来源、重复空选及三种超限且不截断', () => {
  const items = sample(), materials = listMaterials(items);
  assert.throws(() => buildMaterialDraft(items, [], 'free'), /至少/);
  assert.throws(() => buildMaterialDraft(items, [materials[0], materials[0]], 'free'), /重复/);
  for (const change of [
    (data) => { data[0].text = '已修改'; },
    (data) => { data[0].deletedAt = 9000; },
    (data) => { data[0].mergedInto = 'ins_b'; },
    (data) => { data[0].text = ' '; }
  ]) { const copy = structuredClone(items); change(copy); assert.throws(() => buildMaterialDraft(copy, [materials[0]], 'free'), /来源已修改/); }
  const folded = structuredClone(items); folded[0].supplements[1].foldedAt = 9000;
  assert.throws(() => buildMaterialDraft(folded, [materials[1]], 'free'), /来源已修改/);
  const many = Array.from({ length: 21 }, (_, i) => ({ id: 'ins_' + i, text: '正文', supplements: [] }));
  assert.throws(() => buildMaterialDraft(many, listMaterials(many), 'free'), /二十条/);
  assert.equal(buildMaterialDraft(many, listMaterials(many).slice(0, 20), 'free').sourceCount, 20);
  const parts = [{ id: 'ins_many', text: '正文', supplements: Array.from({ length: 40 }, (_, i) => ({ id: 'sup_' + i, content: '补充', createdAt: i })) }];
  assert.throws(() => buildMaterialDraft(parts, listMaterials(parts), 'free'), /四十段/);
  assert.equal(buildMaterialDraft(parts, listMaterials(parts).slice(0, 40), 'free').materialCount, 40);
  const long = [{ id: 'ins_long', text: '字'.repeat(MATERIAL_LIMITS.chars) }];
  assert.equal(buildMaterialDraft(long, listMaterials(long), 'free').text.length, 12000);
  long[0].text += '字';
  assert.throws(() => buildMaterialDraft(long, listMaterials(long), 'free'), /12000/);
  const separator = [{ id: 'ins_one', text: '字'.repeat(6000) }, { id: 'ins_two', text: '字'.repeat(5999) }];
  assert.throws(() => buildMaterialDraft(separator, listMaterials(separator), 'free'), /12000/);
});

test('选材页默认不选，搜索不丢选择，取消重选排在末尾', async () => {
  await withPage(async ({ page, state }) => {
    const original = JSON.stringify(state.items);
    assert.equal(page.data.selectedCount, 0); assert.equal(page.data.draft, '');
    page.onToggle(event('ins_b:text')); page.onToggle(event('ins_a:supplement:sup_a'));
    page.onSearch({ detail: { value: '补充甲' } });
    assert.equal(page.data.options.length, 1); assert.equal(page.data.selectedCount, 2);
    page.onSearch({ detail: { value: '' } }); page.onSelectedOnly();
    assert.equal(page.data.options.length, 2);
    page.onToggle(event('ins_b:text')); page.onToggle(event('ins_b:text'));
    assert.equal(page.data.options.find((part) => part.key === 'ins_b:text').order, 2);
    page.onGenerate();
    assert.equal(page.data.draft, '补充甲\n\n正文乙'); assert.equal(page.data.phase, 'edit');
    assert.deepEqual(state.scrolls, [0]);
    page.onBackToSelection(); page.onResumeDraft(); assert.deepEqual(state.scrolls, [0, 0, 0]);
    assert.equal(JSON.stringify(state.items), original); assert.equal(state.copies.length, 0); assert.equal(state.saves.length, 0);
  });
});

test('来源变化时拒绝生成，明确刷新清空选材并保留当前稿件', async () => {
  await withPage(async ({ page, state }) => {
    page.onToggle(event('ins_a:text')); page.onGenerate(); page.onBackToSelection();
    state.items[0].text = '更新后的正文'; page.onGenerate();
    assert.match(page.data.error, /来源已修改/); assert.equal(page.data.draft, '正文甲');
    page.onRefresh(); state.modals.pop().success({ confirm: false });
    assert.equal(page.data.selectedCount, 1);
    page.onRefresh(); state.modals.pop().success({ confirm: true });
    assert.equal(page.data.selectedCount, 0); assert.equal(page.data.draft, '正文甲');
    page.onToggle(event('ins_a:text')); page.onGenerate();
    assert.equal(page.data.draft, '更新后的正文');
  });
});

test('选材稿重新生成先确认，复制失败保留全文且不计成功', async () => {
  await withPage(async ({ page, state }) => {
    page.onToggle(event('ins_a:text')); page.onGenerate(); page.onInput({ detail: { value: '手动改好的稿件' } });
    page.onBackToSelection(); page.onGenerate();
    assert.equal(page.data.draft, '手动改好的稿件'); state.modals.pop().success({ confirm: false });
    assert.equal(page.data.draft, '手动改好的稿件'); page.onResumeDraft(); page.onCopy();
    assert.equal(state.copies[0].data, '手动改好的稿件'); state.copies[0].fail();
    assert.match(page.data.error, /复制未完成/); assert.equal(page.data.busy, false); assert.equal(state.metrics.length, 0);
    assert.equal(page.data.draft, '手动改好的稿件'); page.onCopy(); state.copies[1].success();
    assert.match(page.data.notice, /已复制/); assert.deepEqual(state.metrics, ['output_copied']);
    page.onBackToSelection(); page.onGenerate(); state.modals.pop().success({ confirm: true });
    assert.equal(page.data.draft, '正文甲');
  });
});

test('选材稿另存独立记录且同稿不重复保存，失败和超长不丢全文', async () => {
  await withPage(async ({ page, state }) => {
    const before = JSON.stringify(state.items);
    page.onToggle(event('ins_b:text')); page.onGenerate();
    state.savedResult = { ok: false }; await page.onSave();
    assert.match(page.data.error, /尚未确认另存/); assert.equal(page.data.savedId, ''); assert.equal(page.data.draft, '正文乙');
    state.savedResult = { ok: true, synced: false }; await page.onSave();
    assert.match(page.data.error, /尚未确认另存/); assert.equal(page.data.savedId, '');
    state.savedResult = { ok: true, synced: true }; await page.onSave();
    assert.match(page.data.notice, /已另存/); assert.ok(page.data.savedId);
    assert.equal(state.saves[0].id, state.saves[1].id); assert.equal(state.saves[1].id, state.saves[2].id);
    assert.equal(state.saves[2].text, '正文乙'); assert.notEqual(state.saves[2].id, 'ins_b');
    assert.deepEqual(state.saves[2].summarySources, []);
    await page.onSave(); assert.equal(state.saves.length, 3);
    page.onBackToSelection(); page.onGenerate(); await page.onSave(); assert.equal(state.saves.length, 3);
    const long = '字'.repeat(2001); page.onInput({ detail: { value: long } }); await page.onSave();
    assert.equal(state.saves.length, 3); assert.equal(page.data.draft, long); assert.match(page.data.error, /2000/);
    page.onCopy(); assert.equal(state.copies[0].data, long); state.copies[0].success();
    assert.equal(JSON.stringify(state.items), before);
  });
});

test('选材页离开清空正文草稿，旧复制保存回调不能覆盖新会话', async () => {
  await withPage(async ({ page, state, app }) => {
    page.onToggle(event('ins_a:text')); page.onGenerate(); page.onCopy();
    page.onHide();
    assert.equal(page.data.draft, ''); assert.equal(page.data.options.length, 0); assert.equal(page.selected.length, 0);
    await page.onShow(); page.onToggle(event('ins_b:text')); page.onGenerate();
    state.copies[0].success(); assert.equal(page.data.notice, ''); assert.equal(page.data.draft, '正文乙');
    const pending = deferred(); state.savedResult = pending.promise;
    const saving = page.onSave(); app.globalData.sessionEpoch++;
    pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.savedId, ''); assert.equal(page.data.draft, ''); assert.equal(page.data.options.length, 0);
    assert.deepEqual(state.metrics, []); assert.match(page.data.error, /账户状态/);
  });
});

test('账户切换拦截选材和旧确认，不会复制或写入新账户', async () => {
  await withPage(async ({ page, state, app }) => {
    page.onToggle(event('ins_a:text')); page.onGenerate(); page.onInput({ detail: { value: '私密编辑' } });
    page.onBackToSelection(); page.onGenerate();
    app.globalData.store = { listInspirations: () => [{ id: 'ins_new', text: '新账户内容', createdAt: 1000 }] };
    app.globalData.sessionEpoch++;
    state.modals.pop().success({ confirm: true });
    assert.equal(page.data.draft, ''); assert.equal(page.data.options.length, 0);
    page.onCopy(); await page.onSave(); assert.equal(state.copies.length, 0); assert.equal(state.saves.length, 0);
    await page.onShow(); assert.equal(page.data.options.length, 1); assert.equal(page.data.options[0].content, '新账户内容');
    assert.equal(page.data.selectedCount, 0);
  });
});

test('过期素材加载结果不回填，读取失败可重试且空列表可显示', async () => {
  await withPage(async ({ page, state, app }) => {
    page.onHide(); const pending = deferred(); const oldStore = app.globalData.store;
    app.ensureReady = () => pending.promise; const loading = page.onShow(); page.onUnload();
    pending.resolve(oldStore); await loading; assert.equal(page.data.options.length, 0);
    app.ensureReady = () => Promise.reject(Error('NETWORK')); await page.onShow();
    assert.equal(page.data.ready, true); assert.match(page.data.error, /无法读取/);
    app.ensureReady = () => Promise.resolve(oldStore); state.items = []; await page.load();
    assert.equal(page.data.total, 0); assert.equal(page.data.error, ''); assert.equal(page.data.ready, true);
  });
});

test('所有私人工作页禁止索引且选材入口不调用分享或模型', () => {
  const root = path.join(__dirname, '../miniprogram');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const sitemap = JSON.parse(fs.readFileSync(path.join(root, 'sitemap.json'), 'utf8'));
  for (const page of app.pages) {
    const rule = sitemap.rules.find((entry) => entry.page === page || entry.page === '*');
    assert.equal(rule.action, page === 'pages/welcome/index' ? 'allow' : 'disallow', page);
  }
  const source = fs.readFileSync(path.join(root, 'pages/material-output/index.js'), 'utf8');
  assert.doesNotMatch(source, /wx\.cloud|onShareAppMessage|require\([^\n]*ai/);
  assert.match(source, /shareConfirmedDraft/); // 只有明确的已确认结果分享，不在选材/生成时发起。
  assert.match(fs.readFileSync(path.join(root, 'pages/list/index.wxml'), 'utf8'), /bindtap="onMaterialOutput"/);
  assert.ok(app.pages.includes('pages/material-output/index'));
});

test('选材读取失败独立显示重试，选材错误在固定操作区可见', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/material-output/index.wxml'), 'utf8');
  assert.match(wxml, /wx:elif="\{\{error && !total\}\}"/);
  assert.ok(wxml.indexOf('error && !total') < wxml.indexOf('没有找到匹配的素材'));
  assert.match(wxml, /class="material-footer"><view wx:if="\{\{error\}\}"/);
});
