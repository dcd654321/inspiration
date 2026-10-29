'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../miniprogram/core/inspiration');
const { searchInspirations } = require('../miniprogram/services/discovery');

async function fixture(run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  let rows = [core.createInspiration({ id: 'active', text: '日常散步想法', now: 30 }),
    core.markArchived(core.appendSupplement(core.createInspiration({ id: 'old', text: '旧方案', now: 10 }),
      { id: 's', content: '雨天的散步路线', now: 15 }), { now: 100 }),
    core.markArchived(Object.assign({}, core.createInspiration({ id: 'new', text: '新方案', now: 20 }), { tags: ['咖啡'] }), { now: 200 })];
  const routes = [];
  const store = { readSnapshot: () => ({ inspirations: rows }), getInspiration: id => rows.find(item => item.id === id),
    listInspirations: () => rows.filter(item => !item.mergedInto && !core.isArchived(item)), refresh: async () => ({ ok: true }) };
  const app = { globalData: { store, cacheScope: 'a'.repeat(32), sessionEpoch: 1 },
    ensureReady: async () => app.globalData.store, refreshAccount: async () => app.globalData.store };
  const loaded = [];
  function mount(name) {
    const file = require.resolve('../miniprogram/pages/' + name + '/index.js'); loaded.push(file);
    let definition; global.Page = value => { definition = value; }; delete require.cache[file]; require(file);
    return { ...definition, data: structuredClone(definition.data), setData(value, done) { Object.assign(this.data, value); if (done) done(); } };
  }
  global.wx = { navigateTo: value => routes.push(value.url) };
  global.getApp = () => app;
  try { await run({ mount, app, store, routes, rows, replaceRows: value => { rows = value; } }); }
  finally {
    loaded.forEach(file => delete require.cache[file]);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('归档查找：搜索范围、归档排序与旧记录兼容', async () => {
  await fixture(async ({ rows }) => {
    const legacy = { ...rows[0], id: 'legacy' }; delete legacy.archivedAt;
    const source = rows.concat([legacy, { ...rows[0], id: 'merged', mergedInto: 'active' },
      { ...rows[1], id: 'deleted', deletedAt: 300 }, { ...rows[1], id: 'folded', mergedInto: 'active' }]);
    assert.deepEqual(searchInspirations(source).map(result => result.item.id), ['active', 'legacy']);
    assert.deepEqual(searchInspirations(source, { archived: true }).map(result => result.item.id), ['new', 'old']);
    assert.deepEqual(searchInspirations(source, { query: '方案' }), []);
    assert.deepEqual(searchInspirations(source, { archived: true, query: '雨天' }).map(result => [result.item.id, result.matchSource]), [['old', '补充']]);
    assert.deepEqual(searchInspirations(source, { archived: true, query: '咖啡' }).map(result => result.item.id), ['new']);
    assert.deepEqual(searchInspirations(source, { filter: 'merged' }).map(result => result.item.id), ['merged']);
    const zero = core.markArchived(core.createInspiration({ id: 'zero', text: '零时刻归档', now: 0 }), { now: 0 });
    assert.equal(searchInspirations([zero], { archived: true }).length, 1);
  });
});

test('归档查找：独立入口搜索和全归档空态', async () => {
  await fixture(async ({ mount, routes, rows, replaceRows }) => {
    mount('mine').onOpenArchived(); assert.equal(routes[0], '/pages/archived/index');
    const page = mount('archived'); await page.onShow();
    assert.deepEqual(page.data.items.map(item => item.id), ['new', 'old']);
    page.onSearch({ detail: { value: '雨天' } }); assert.deepEqual(page.data.items.map(item => item.id), ['old']);
    page.onOpen({ currentTarget: { dataset: { id: 'old' } } }); assert.equal(routes.at(-1), '/pages/detail/index?id=old');
    page.onClearQuery(); assert.equal(page.data.items.length, 2);
    const list = mount('list'); await list.onShow();
    assert.deepEqual(list.data.items.map(item => item.id), ['active']); assert.equal(list.data.archivedCount, 2);
    list.setData({ query: '散步', stage: 'seed', recentOn: true });
    replaceRows(rows.filter(item => item.id !== 'active')); list.load();
    assert.equal(list.data.activeCount, 0); assert.equal(list.data.archivedCount, 2); assert.deepEqual(list.data.items, []);
    list.onShowArchived(); assert.equal(routes.at(-1), '/pages/archived/index');
    const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/list/index.wxml'), 'utf8');
    assert.match(wxml, /activeCount === 0 && archivedCount > 0/); assert.match(wxml, /暂无未归档灵感/);
    assert.match(wxml, /items.length === 0 && !\(activeCount === 0 && archivedCount > 0\) && \(query/);
    assert.ok(wxml.indexOf('暂无未归档灵感') < wxml.indexOf('还没有记录'));
    const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));
    assert.ok(app.pages.includes('pages/archived/index'));
  });
});

test('归档查找：读取失败保留内容，账户切换清除查询', async () => {
  await fixture(async ({ mount, app, store }) => {
    const page = mount('archived'); await page.onShow(); page.onSearch({ detail: { value: '方案' } });
    store.refresh = async () => ({ ok: false, code: 'NETWORK' }); await page.onRetry();
    assert.equal(page.data.items.length, 2); assert.ok(page.data.error); assert.equal(page.data.query, '方案');
    app.globalData.sessionEpoch++; app.globalData.cacheScope = 'b'.repeat(32);
    app.globalData.store = { readSnapshot: () => ({ inspirations: [] }), getInspiration: () => null };
    await page.onShow(); assert.deepEqual(page.data.items, []); assert.equal(page.data.query, ''); assert.equal(page.data.count, 0);
    page.onOpen({ currentTarget: { dataset: { id: 'old' } } });
    page.onHide(); app.globalData.store = null; app.globalData.accountError = '读取暂不可用';
    await page.onShow(); assert.equal(page.data.error, '读取暂不可用'); assert.deepEqual(page.data.items, []);
  });
});

test('归档查找：迟到刷新不覆盖新账户或离开页面', async () => {
  await fixture(async ({ mount, app, store }) => {
    const page = mount('archived'); await page.onShow();
    let settle; store.refresh = () => new Promise(resolve => { settle = resolve; });
    const retry = page.onRetry(); page.onHide();
    app.globalData.sessionEpoch++; app.globalData.cacheScope = 'b'.repeat(32);
    app.globalData.store = { readSnapshot: () => ({ inspirations: [] }) };
    await page.onShow(); settle({ ok: true }); await retry;
    assert.equal(page.data.loading, false); assert.deepEqual(page.data.items, []);
    assert.equal(page.data.query, ''); assert.equal(page.data.error, '');
  });
});
