'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { loadPrivatePhotos } = require('../miniprogram/services/private-photos');
const sharedCloud = require('./helpers/shared-cloud.cjs');
const config = require('../miniprogram/config/cloud');
const scope = 'a'.repeat(32);
const input = value => ({ detail: { value } });
const event = (id, src) => ({ currentTarget: { dataset: { id, src } } });
const photo = id => ({ id, createdAt: 2, fileId: 'cloud://' + config.envId + '.bucket/linggan/' + scope + '/idea/' + id });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function withPage(name, run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  let definition;
  const state = { record: core.createInspiration({ id: 'idea', text: '记录街角的小店', now: 1 }),
    version: 1, result: null, writes: [], downloads: [], routes: [], alerts: [] };
  const app = { globalData: { sessionEpoch: 1, cacheScope: scope, photos: null }, ensureReady: async () => app.globalData.store };
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: { cacheScope: scope,
    generation: 1, version: 1, inspirations: [state.record] },
    transport: { async send(action, payload) {
      if (action === 'snapshot.pull') return { ok: true, data: { cacheScope: scope,
        generation: 1, version: state.version, inspirations: [state.record] } };
      state.writes.push(payload.upserts[0]);
      if (state.result) return typeof state.result === 'function' ? state.result() : state.result;
      state.record = payload.upserts[0]; state.version++;
      return { ok: true, data: { version: state.version } };
    } } });
  app.globalData.store = store;
  try {
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { cloud: sharedCloud({ async downloadFile({ fileID }) {
      state.downloads.push(fileID); return { tempFilePath: 'wxfile://private/' + fileID.split('/').pop() };
    } }), navigateTo: opts => state.routes.push(opts.url),
    enableAlertBeforeUnload: opts => state.alerts.push(opts.message), disableAlertBeforeUnload() {}, showToast() {} };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data),
      setData(next, callback) { Object.assign(this.data, next); if (callback) callback(); } };
    if (name === 'detail') await page.onLoad({ id: 'idea' }); else await page.onShow();
    await flush();
    await run({ page, app, store, state });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test('详情标签：输入与摘要同步，取消或收起恢复已保存值', async () => {
  await withPage('detail', async ({ page, store, state }) => {
    assert.equal(page.data.orgSummary, '想法 · 未加标签');
    for (const close of ['onCancelOrganization', 'onToggleOrganization']) {
      page.onToggleOrganization();
      page.onTagsInput(input('旅行，散步'));
      page.onStageSelect(input('1'));
      assert.equal(page.data.orgSummary, '整理中 · 旅行、散步');
      assert.equal(page.data.orgDirty, true);
      assert.equal(store.getInspiration('idea').tags.length, 0);
      assert.ok(state.alerts.length);
      page[close]();
      assert.equal(page.data.tagsDraft, ''); assert.equal(page.data.stageIndex, 0);
      assert.equal(page.data.orgSummary, '想法 · 未加标签');
      assert.equal(page.data.orgOpen, false); assert.equal(page.data.orgDirty, false);
    }
    assert.equal(state.writes.length, 0);
  });
});

test('详情标签：照片添加重读保留标签草稿，确认保存和重入显示同值', async () => {
  await withPage('detail', async ({ page, app, store, state }) => {
    page.onToggleOrganization(); page.onTagsInput(input('旅行，散步')); page.onStageSelect(input('2'));
    page.onSupplementInput(input('还没提交的补充'));
    app.globalData.photos = { async add() {
      const next = { ...store.getInspiration('idea'), photos: [photo('p1')] };
      return store.saveInspiration(next);
    } };
    await page.addPhotos('album'); await flush();
    assert.equal(page.data.tagsDraft, '旅行，散步'); assert.equal(page.data.orgDirty, true);
    assert.equal(page.data.orgSummary, '可使用 · 旅行、散步');
    assert.equal(page.data.supplementDraft, '还没提交的补充');
    assert.equal(page.data.photos[0].src, 'wxfile://private/p1');
    page.onPreviewPhoto(event('p1'));
    assert.match(state.routes[0], /photo-viewer\/index\?id=idea&photo=p1/);
    await page.onSaveOrganization(); await flush();
    assert.deepEqual(store.getInspiration('idea').tags, ['旅行', '散步']);
    assert.equal(page.data.orgOpen, false); assert.equal(page.data.orgDirty, false);
    assert.equal(page.data.orgSummary, '可使用 · 旅行、散步');
    page.onHide(); await page.onShow(); await flush();
    assert.equal(page.data.tagsDraft, '旅行，散步');
    assert.equal(page.data.orgSummary, '可使用 · 旅行、散步');
    assert.equal(page.data.photos.length, 1); assert.equal(page.data.photos[0].src, 'wxfile://private/p1');
    assert.equal(store.getInspiration('idea').text, '记录街角的小店');
  });
});

test('详情标签：补充确认后保留未保存标签，清空的仅为本次补充', async () => {
  await withPage('detail', async ({ page, store }) => {
    page.onToggleOrganization(); page.onTagsInput(input('旅行'));
    page.onSupplementInput(input('补充街角的小店营业时间'));
    await page.onSubmitSupplement();
    assert.equal(page.data.supplementDraft, '');
    assert.equal(page.data.tagsDraft, '旅行'); assert.equal(page.data.orgDirty, true);
    assert.equal(page.data.orgSummary, '想法 · 旅行'); assert.equal(page.data.orgOpen, true);
    assert.deepEqual(store.getInspiration('idea').tags, []);
    assert.equal(store.getInspiration('idea').supplements[0].content, '补充街角的小店营业时间');
    await page.onSaveOrganization();
    assert.deepEqual(store.getInspiration('idea').tags, ['旅行']);
    assert.equal(store.getInspiration('idea').supplements.length, 1);
  });
});

test('详情标签：校验失败和未知保存保留输入，不把草稿当确认结果', async () => {
  await withPage('detail', async ({ page, store, state }) => {
    page.onToggleOrganization(); page.onTagsInput(input('旅行，旅行'));
    await page.onSaveOrganization();
    assert.match(page.data.error, /不同标签/); assert.equal(state.writes.length, 0);
    page.onTagsInput(input('旅行'));
    state.result = { ok: false, code: 'NETWORK' };
    await page.onSaveOrganization();
    assert.equal(page.data.tagsDraft, '旅行'); assert.equal(page.data.orgDirty, true);
    assert.equal(page.data.orgOpen, true); assert.match(page.data.error, /尚未确认保存/);
    assert.deepEqual(store.getInspiration('idea').tags, []);
    state.result = null; await page.onSaveOrganization();
    assert.equal(page.data.orgSummary, '想法 · 旅行'); assert.equal(page.data.orgDirty, false);
    assert.equal(page.data.orgOpen, false);
  });
});

test('详情标签：账户变化和切页后的旧保存回执不回填新表单', async () => {
  for (const change of ['account', 'page']) await withPage('detail', async ({ page, app, state }) => {
    let finish; state.result = () => new Promise(resolve => { finish = resolve; });
    page.onToggleOrganization(); page.onTagsInput(input('旧标签'));
    const saving = page.onSaveOrganization(); await flush();
    if (change === 'account') {
      app.globalData.sessionEpoch++;
      app.globalData.store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: { cacheScope: scope,
        generation: 1, version: 2, inspirations: [{ ...state.record, tags: ['新标签'] }] },
        transport: { send: async () => { throw Error('new session must not write'); } } });
      page.load();
      assert.equal(page.data.tagsDraft, '新标签'); assert.equal(page.data.orgDirty, false);
    } else { page.onHide(); await page.onShow(); }
    if (!page.data.orgOpen) page.onToggleOrganization();
    page.onTagsInput(input('当前输入'));
    const before = structuredClone(page.data);
    finish({ ok: true, data: { version: 2 } }); await saving;
    assert.equal(page.data.tagsDraft, before.tagsDraft); assert.equal(page.data.orgSummary, before.orgSummary);
    assert.equal(page.data.orgOpen, before.orgOpen); assert.equal(page.data.error, before.error);
  });
});

test('详情照片：渲染失败保留占位，重试恢复且旧图片错误不覆盖新结果', async () => {
  await withPage('detail', async ({ page, store }) => {
    await store.saveInspiration({ ...store.getInspiration('idea'), photos: [photo('p1'), photo('p2')] });
    page.load(); await flush();
    assert.equal(page.data.photosEnabled, false, '服务关闭时仍展示已有照片');
    const oldSrc = page.data.photos[0].src;
    page.onPhotoImageError(event('p1', oldSrc));
    assert.equal(page.data.photos[0].failed, true); assert.equal(page.data.photos[0].src, '');
    assert.equal(page.data.photos[1].failed, false);
    page.onReloadPhoto(); await flush();
    assert.equal(page.data.photos[0].failed, false);
    page.setData({ photos: [{ id: 'p1', src: 'wxfile://new', failed: false }, page.data.photos[1]] });
    page.onPhotoImageError(event('p1', oldSrc));
    assert.equal(page.data.photos[0].src, 'wxfile://new');
    page.onHide(); page.onPhotoImageError(event('p1', 'wxfile://new'));
    assert.deepEqual(page.data.photos, []);
  });
});

test('私有照片：身份作用域未就绪时保留失败占位且不调用下载', async () => {
  let calls = 0;
  const options = { cacheScope: '', isCurrent: () => true, getClient: async () => { calls++; throw Error('forbidden'); } };
  assert.deepEqual(await loadPrivatePhotos([photo('p1')], options), [{ id: 'p1', src: '', failed: true }]);
  assert.equal(calls, 0);
  assert.deepEqual(await loadPrivatePhotos([photo('p1')], { ...options, isCurrent: () => false }), []);
});

test('灵感列表：照片数量和已保存标签可见，不为列表下载照片', async () => {
  await withPage('list', async ({ page, store, state }) => {
    await store.saveInspiration({ ...store.getInspiration('idea'), tags: ['旅行'], photos: [photo('p1'), photo('p2')] });
    await page.onShow();
    assert.equal(page.data.items[0].photos, 2); assert.deepEqual(page.data.items[0].tags, ['旅行']);
    assert.equal(state.downloads.length, 0);
  });
});
