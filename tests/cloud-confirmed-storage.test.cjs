'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { createCloudOnlyPhotoWorkflow } = require('../miniprogram/services/cloud-only-photo');
const { createMemoryStorage } = require('../miniprogram/services/memory-storage');
const { createInspiration } = require('../miniprogram/core/inspiration');
const { createRepository } = require('../server/repository');
const { createProtocol } = require('../server/protocol');

const scope = 'a'.repeat(32);
const empty = () => ({ cacheScope: scope, generation: 1, version: 0, inspirations: [], photosEnabled: true });
const item = (id = 'ins_1') => ({ id, text: '一个想法', photos: [], createdAt: 1, updatedAt: 1, supplements: [], textHistory: [] });

test('云确认才保存：失败时无持久队列也不改会话视图', async () => {
  const calls = [];
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: empty(),
    transport: { send: async (action, payload) => { calls.push([action, payload]); return { ok: false, code: 'NETWORK' }; } } });
  const result = await store.saveInspiration(item());
  assert.equal(result.ok, false);
  assert.equal(typeof store.readQueue, 'undefined');
  assert.deepEqual(store.listInspirations(), []);
  assert.deepEqual(store.getConfirmedRevision(), { baseVersion: 0, generation: 1 });
  assert.equal(calls[0][0], 'snapshot.push');
  assert.equal(calls[0][1].baseVersion, 0);
});

test('保存未获确认时记录页保留输入和会话内重试标识', async () => {
  const pagePath = require.resolve('../miniprogram/pages/capture/index');
  const previous = { Page: global.Page, getApp: global.getApp };
  let definition;
  const saved = [];
  const store = { saveInspiration: async (value) => { saved.push(value); return { ok: true, synced: false }; } };
  const app = { globalData: { store, cacheScope: scope }, ensureReady: async () => store };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    delete require.cache[pagePath]; require(pagePath);
    const page = { data: Object.assign({}, definition.data), setData(next) { Object.assign(this.data, next); } };
    definition.onInput.call(page, { detail: { value: '尚待保存的想法' } });
    await definition.onSave.call(page);
    assert.equal(page.data.draft, '尚待保存的想法');
    assert.equal(page.data.lastSavedId, '');
    assert.match(page.data.error, /保存未完成/);
    await definition.onSave.call(page);
    assert.equal(saved[0].id, saved[1].id);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('云确认后更新内存视图，删除失败仍保留记录', async () => {
  let version = 0;
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: empty(),
    transport: { send: async (action) => action === 'snapshot.pull'
      ? { ok: true, data: Object.assign(empty(), { version, inspirations: version ? [item()] : [] }) }
      : action === 'inspiration.delete' ? { ok: false, code: 'NETWORK' }
        : { ok: true, data: { version: ++version } } } });
  assert.deepEqual(await store.saveInspiration(item()), { ok: true, synced: true });
  assert.equal(store.getInspiration('ins_1').text, '一个想法');
  assert.equal((await store.deleteInspiration('ins_1')).ok, false);
  assert.equal(store.getInspiration('ins_1').text, '一个想法');
});

test('新存储入口与真实服务端协议完成保存和删除闭环', async () => {
  const docs = new Map();
  const db = {
    get: async (key) => docs.get(key) || null,
    put: async (key, value) => docs.set(key, value),
    compareAndSwap: async (key, expectedVersion, value) => {
      const previous = docs.get(key);
      if ((previous ? previous.version : 0) !== expectedVersion) return false;
      docs.set(key, value); return true;
    }
  };
  const repo = createRepository({ db, now: () => 1000 });
  const protocol = createProtocol({ repository: repo, now: () => 1000 });
  const transport = { send: (action, payload, meta) => protocol.handle({ accountKey: scope },
    { action, payload, requestId: meta && meta.requestId || 'pull_1' }) };
  const initial = await transport.send('snapshot.pull', {});
  assert.equal(initial.ok, true);
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: initial.data, transport });
  const record = createInspiration({ id: 'ins_real', text: '可以使用的想法', now: 1000 });
  assert.deepEqual(await store.saveInspiration(record), { ok: true, synced: true });
  assert.equal((await repo.pull(scope)).data.inspirations.length, 1);
  assert.deepEqual(await store.deleteInspiration(record.id), { ok: true, synced: true });
  assert.equal((await repo.pull(scope)).data.inspirations.length, 0);
});

test('版本冲突先读取最新云端记录但不确认本次写入', async () => {
  const old = item('ins_old');
  const latest = item('ins_other');
  const store = createCloudOnlyStore({ cacheScope: scope,
    remoteSnapshot: Object.assign(empty(), { version: 1, inspirations: [old] }),
    transport: { send: async (action) => action === 'snapshot.pull'
      ? { ok: true, data: Object.assign(empty(), { version: 2, inspirations: [latest] }) }
      : { ok: false, code: 'CONFLICT' } } });
  const result = await store.saveInspiration(item('ins_new'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFLICT');
  assert.equal(store.getInspiration('ins_old'), null);
  assert.equal(store.getInspiration('ins_other').id, 'ins_other');
  assert.equal(store.getInspiration('ins_new'), null);
});

test('账户会话失效后不接受迟到的保存回执', async () => {
  let active = true;
  let complete;
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: empty(), isCurrent: () => active,
    transport: { send: () => new Promise((resolve) => { complete = resolve; }) } });
  const pending = store.saveInspiration(item());
  await new Promise((resolve) => setImmediate(resolve));
  active = false;
  complete({ ok: true, data: { version: 1 } });
  assert.equal((await pending).code, 'ACCOUNT_SESSION_CHANGED');
  assert.deepEqual(store.listInspirations(), []);
});

test('回包丢失时先拉取核对已提交记录，不重复报告失败', async () => {
  let pushes = 0;
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: empty(), transport: {
    send: async (action) => {
      if (action === 'snapshot.push') { pushes += 1; throw Error('timeout'); }
      return { ok: true, data: Object.assign(empty(), { version: 1, inspirations: [item()] }) };
    }
  } });
  assert.deepEqual(await store.saveInspiration(item()), { ok: true, synced: true });
  assert.equal(pushes, 1);
});

test('旧缓存读取适配器不会用于新会话，内存适配器不调用微信持久存储', () => {
  const storage = createMemoryStorage();
  storage.set('setting', { enabled: true });
  assert.deepEqual(storage.get('setting'), { enabled: true });
  assert.equal(storage.get('legacy'), undefined);
});

test('运行入口不再连接持久存储和旧照片暂存流程', () => {
  const root = path.join(__dirname, '..', 'miniprogram');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const photo = fs.readFileSync(path.join(root, 'services', 'wx-photo.js'), 'utf8');
  assert.match(app, /createCloudOnlyStore/);
  assert.doesNotMatch(app, /createWxStorage|createStore\(|getStorageInfoSync|legacyCachePresent/);
  assert.match(photo, /createCloudOnlyPhotoWorkflow/);
  assert.doesNotMatch(photo, /saveFile|createPhotoWorkflow/);
  for (const retired of ['store.js', 'wx-storage.js', 'photo-workflow.js']) {
    assert.equal(fs.existsSync(path.join(root, 'services', retired)), false, `${retired} 不应进入小程序包`);
  }
});

test('照片直接用临时路径上传，关联失败后清理已确认未关联的文件', async () => {
  const removed = [];
  const store = { getInspiration: () => item(), saveInspiration: async () => ({ ok: false }),
    refresh: async () => ({ ok: true }) };
  const photos = createCloudOnlyPhotoWorkflow({ cacheScope: scope, store,
    prepare: async () => ({ ok: true, accepted: [{ tempFilePath: 'wxfile://tmp', size: 100 }], rejected: [] }),
    upload: async ({ tempFilePath }) => { assert.equal(tempFilePath, 'wxfile://tmp'); return { ok: true, fileId: 'cloud://x/photo' }; },
    expectedFileId: () => 'cloud://x/photo', removeRemote: async (fileId) => removed.push(fileId),
    newId: () => 'pho_1' });
  const result = await photos.add('ins_1', 'album');
  assert.equal(result.ok, false);
  assert.deepEqual(removed, ['cloud://x/photo']);
  assert.match(result.message, /重新选择未添加/);
  assert.deepEqual(Object.keys(photos), ['add']);
});

test('照片关联状态核对失败时不误删可能已关联的云文件', async () => {
  const removed = [];
  const store = { getInspiration: () => item(), saveInspiration: async () => ({ ok: false }),
    refresh: async () => ({ ok: false, code: 'NETWORK' }) };
  const photos = createCloudOnlyPhotoWorkflow({ cacheScope: scope, store,
    prepare: async () => ({ ok: true, accepted: [{ tempFilePath: 'wxfile://tmp', size: 100 }], rejected: [] }),
    upload: async () => ({ ok: true, fileId: 'cloud://x/photo' }), expectedFileId: () => 'cloud://x/photo',
    removeRemote: async (fileId) => removed.push(fileId), newId: () => 'pho_1' });
  const result = await photos.add('ins_1', 'album');
  assert.equal(result.ok, false);
  assert.match(result.message, /重新打开这条灵感查看/);
  assert.deepEqual(removed, []);
});

function photoFixture(overrides = {}) {
  let current = createInspiration({ id: 'ins_1', text: '一个想法', now: 1 });
  const removed = [], uploaded = [];
  const store = {
    getInspiration: () => current,
    saveInspiration: async (next) => { current = next; return { ok: true, synced: true }; },
    refresh: async () => ({ ok: true })
  };
  let sequence = 0;
  const options = {
    cacheScope: scope, store, now: () => 10, newId: () => 'pho_' + (++sequence),
    prepare: async () => ({ ok: true, accepted: [{ tempFilePath: 'wxfile://first' }, { tempFilePath: 'wxfile://second' }], rejected: [] }),
    expectedFileId: (id, photoId) => 'cloud://x/' + photoId,
    upload: async (input) => { uploaded.push(input); return { ok: true, fileId: 'cloud://x/' + input.photoId }; },
    removeRemote: async (fileId) => { removed.push(fileId); }
  };
  const service = createCloudOnlyPhotoWorkflow(Object.assign(options, overrides));
  return { service, store, removed, uploaded, get: () => current, set: (next) => { current = next; } };
}

test('照片部分上传失败时保留成功照片与文字，再次选图可以继续添加', async () => {
  let attempts = 0;
  const fixture = photoFixture({ upload: async ({ photoId }) => {
    attempts += 1;
    return attempts === 1 ? { ok: false } : { ok: true, fileId: 'cloud://x/' + photoId };
  } });
  const first = await fixture.service.add('ins_1', 'album');
  assert.equal(first.ok, false);
  assert.match(first.message, /重新选择未添加/);
  assert.equal(fixture.get().text, '一个想法');
  assert.deepEqual(fixture.get().photos.map((p) => p.id), ['pho_2']);
  assert.equal((await fixture.service.add('ins_1', 'album')).ok, true);
  assert.equal(fixture.get().photos.length, 3);
});

test('上传期间更新文字后，照片关联使用最新记录不覆盖文字', async () => {
  const fixture = photoFixture({ upload: async ({ photoId }) => {
    fixture.set(Object.assign({}, fixture.get(), { text: '上传期间修改的正文' }));
    return { ok: true, fileId: 'cloud://x/' + photoId };
  } });
  assert.equal((await fixture.service.add('ins_1', 'album')).ok, true);
  assert.equal(fixture.get().text, '上传期间修改的正文');
  assert.equal(fixture.get().photos.length, 2);
});

test('照片关联回执丢失但回读确认成功时不误删或要求重新选图', async () => {
  const fixture = photoFixture();
  fixture.store.saveInspiration = async (next) => { fixture.set(next); return { ok: false }; };
  const result = await fixture.service.add('ins_1', 'album');
  assert.equal(result.ok, true);
  assert.equal(result.message, '');
  assert.equal(fixture.get().photos.length, 2);
  assert.deepEqual(fixture.removed, []);
});

test('照片关联状态不确定时停止本批后续上传，避免扩大不确定结果', async () => {
  const fixture = photoFixture();
  fixture.store.saveInspiration = async () => ({ ok: false });
  fixture.store.refresh = async () => ({ ok: false });
  const result = await fixture.service.add('ins_1', 'album');
  assert.match(result.message, /重新打开/);
  assert.equal(fixture.uploaded.length, 1);
  assert.deepEqual(fixture.removed, []);
});

test('上传时灵感已删除则不重建记录，并清理未关联的照片', async () => {
  let saved = 0;
  const fixture = photoFixture({ upload: async ({ photoId }) => {
    fixture.set(null);
    return { ok: true, fileId: 'cloud://x/' + photoId };
  } });
  fixture.store.saveInspiration = async () => { saved += 1; return { ok: true, synced: true }; };
  assert.equal((await fixture.service.add('ins_1', 'album')).ok, false);
  assert.equal(saved, 0);
  assert.deepEqual(fixture.removed, ['cloud://x/pho_1']);
});

test('照片添加失败保留详情文字输入，同账户换会话后忽略旧结果', async () => {
  const modulePath = require.resolve('../miniprogram/pages/detail/index');
  const previous = { Page: global.Page, getApp: global.getApp };
  let definition, finish;
  const service = { add: () => new Promise((resolve) => { finish = resolve; }) };
  const app = { globalData: { photos: service, store: {}, cacheScope: scope, sessionEpoch: 1 } };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    delete require.cache[modulePath]; require(modulePath);
    let loads = 0;
    const page = { id: 'ins_1', visible: true, viewVersion: 1,
      data: Object.assign({}, definition.data, { editDraft: '未保存正文', supplementDraft: '未保存补充' }),
      setData(next) { Object.assign(this.data, next); }, load() { loads += 1; } };
    const first = definition.addPhotos.call(page, 'album');
    assert.equal(page.data.photoBusy, true);
    finish({ ok: false, message: '请重新选择照片。' });
    await first;
    assert.equal(page.data.photoBusy, false);
    assert.equal(page.data.editDraft, '未保存正文');
    assert.equal(page.data.supplementDraft, '未保存补充');
    assert.equal(loads, 1);
    const late = definition.addPhotos.call(page, 'album');
    app.globalData.sessionEpoch += 1;
    app.globalData.store = {};
    page.data.photoError = '新会话的提示';
    finish({ ok: false, message: '旧会话的提示' });
    await late;
    assert.equal(page.data.photoError, '新会话的提示');
    assert.equal(loads, 1);
  } finally {
    delete require.cache[modulePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
