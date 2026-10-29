'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { LIMITS } = require('../miniprogram/core/limits');
const { createPhotoService } = require('../miniprogram/services/photo');
const { createCloudOnlyPhotoWorkflow } = require('../miniprogram/services/cloud-only-photo');
const { loadPrivatePhotos } = require('../miniprogram/services/private-photos');
const config = require('../miniprogram/config/cloud');
const sharedCloud = require('./helpers/shared-cloud.cjs');
const { createUploader } = require('../miniprogram/services/upload');
const scope = 'a'.repeat(32);
const prefix = 'cloud://' + config.envId + '.bucket/linggan/' + scope + '/idea/';
const record = () => core.createInspiration({ id: 'idea', text: '合成照片测试记录', now: 1 });

function preparation(error) {
  return createPhotoService({ ensurePermission: async () => true,
    chooseMedia: async () => { throw error; }, compressImage: async () => { assert.fail('不应压缩'); } });
}

test('照片选图：真实失败与用户取消分开，错误不再静默消失', async () => {
  for (const errMsg of ['chooseMedia:fail camera unavailable', 'chooseMedia:fail system error']) {
    const result = await preparation({ errMsg }).prepare({ source: 'album', existingCount: 0 });
    assert.equal(result.ok, false); assert.equal(result.code, 'FAILED');
    assert.match(result.hint, /重新|重试/);
    assert.ok(!result.hint.includes(errMsg), '原始错误不直接展示');
  }
  for (const error of [{ errMsg: 'chooseMedia:fail cancel' }, new Error('用户取消')]) {
    const result = await preparation(error).prepare({ source: 'album', existingCount: 0 });
    assert.equal(result.code, 'CANCELLED'); assert.equal(result.hint || '', '');
  }
});

test('照片选图：权限错误给出指引，残缺选择结果不被当作取消', async () => {
  const denied = await preparation({ errMsg: 'chooseMedia:fail auth deny' }).prepare({ source: 'camera', existingCount: 0 });
  assert.equal(denied.code, 'PERMISSION_DENIED'); assert.match(denied.hint, /相机/);
  const malformed = createPhotoService({ ensurePermission: async () => true,
    chooseMedia: async () => ({ tempFiles: null }), compressImage: async () => ({}) });
  const result = await malformed.prepare({ source: 'album', existingCount: 0 });
  assert.equal(result.code, 'FAILED'); assert.match(result.hint, /重新|重试/);
});

function workflow(overrides = {}) {
  let current = record(), active = true;
  const calls = { uploads: 0, saves: 0, removed: [] };
  const store = { getInspiration: () => current,
    async saveInspiration(next) { calls.saves++; current = next; return { ok: true, synced: true }; },
    refresh: async () => ({ ok: true }) };
  const options = { cacheScope: scope, store, isCurrent: () => active, newId: () => 'p1', now: () => 2,
    prepare: async () => ({ ok: true, accepted: [{ tempFilePath: 'wxfile://synthetic', size: 100 }], rejected: [] }),
    upload: async () => { calls.uploads++; return { ok: true, fileId: prefix + 'p1' }; },
    expectedFileId: () => prefix + 'p1', removeRemote: async id => { calls.removed.push(id); } };
  return { store, calls, options, service: createCloudOnlyPhotoWorkflow(Object.assign(options, overrides)),
    get: () => current, set: value => { current = value; }, expire: () => { active = false; } };
}

test('照片添加：整批图片被拒绝时不报告成功，也不上传', async () => {
  const env = workflow({ prepare: async () => ({ ok: true, accepted: [], rejected: [{ size: LIMITS.photoMaxBytes + 1 }] }) });
  const result = await env.service.add('idea', 'album');
  assert.equal(result.ok, false); assert.match(result.message, /2MB/);
  assert.equal(env.calls.uploads, 0); assert.equal(env.calls.saves, 0);
});

test('照片添加：选图期间归档或达到上限时不开始上传', async () => {
  for (const change of ['archived', 'limit']) {
    const env = workflow();
    env.options.prepare = async () => {
      if (change === 'archived') env.set({ ...env.get(), archivedAt: 2 });
      else env.set({ ...env.get(), photos: Array.from({ length: LIMITS.photosPerInspiration }, (_, i) => ({ id: 'old' + i, fileId: prefix + 'old' + i, createdAt: 1 })) });
      return { ok: true, accepted: [{ tempFilePath: 'wxfile://synthetic' }], rejected: [] };
    };
    const result = await createCloudOnlyPhotoWorkflow(env.options).add('idea', 'album');
    assert.equal(result.ok, false); assert.equal(env.calls.uploads, 0); assert.equal(env.calls.saves, 0);
  }
});

test('照片添加：上传期间来源变成只读则清理未关联文件，不追加照片', async () => {
  const env = workflow();
  env.options.upload = async () => {
    env.set({ ...env.get(), archivedAt: 2 });
    return { ok: true, fileId: prefix + 'p1' };
  };
  const result = await createCloudOnlyPhotoWorkflow(env.options).add('idea', 'album');
  assert.equal(result.ok, false); assert.equal(env.calls.saves, 0);
  assert.deepEqual(env.calls.removed, [prefix + 'p1']);
  assert.equal(env.get().photos.length, 0);
});

test('照片添加：关联后会话失效不报告当前成功，也不删除可能已关联的文件', async () => {
  const env = workflow();
  env.store.saveInspiration = async next => { env.set(next); env.expire(); return { ok: true, synced: true }; };
  const result = await env.service.add('idea', 'album');
  assert.equal(result.ok, false); assert.match(result.message, /账户/);
  assert.deepEqual(env.calls.removed, []); assert.equal(env.get().photos.length, 1);
});

test('照片添加：上传期间会话失效后不再清理或关联旧账户文件', async () => {
  const env = workflow();
  env.options.upload = async () => { env.expire(); return { ok: true, fileId: prefix + 'p1' }; };
  const result = await createCloudOnlyPhotoWorkflow(env.options).add('idea', 'album');
  assert.equal(result.ok, false); assert.equal(env.calls.saves, 0);
  assert.deepEqual(env.calls.removed, []);
});

test('照片关联：本地异常只返回固定错误码，回读确认未关联后才清理', async () => {
  const env = workflow();
  env.store.saveInspiration = async () => { throw new TypeError('private file address and content'); };
  const result = await env.service.add('idea', 'album');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PHOTO_ASSOCIATION_FAILED');
  assert.equal(result.errorCode, 'PHOTO_LOCAL_TYPE_ERROR');
  assert.ok(!JSON.stringify(result).includes('private file'));
  assert.deepEqual(env.calls.removed, [prefix + 'p1']);
  assert.equal(env.get().photos.length, 0);
});

test('照片链路：真实适配器完成选择上传关联与私有展示，不落临时路径', async () => {
  const previous = global.wx;
  const { createWxPhotos } = require('../miniprogram/services/wx-photo');
  const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
  const { createRepository } = require('../server/repository');
  const { createPhotoValidator } = require('../server/photo-lifecycle');
  const storagePrefix = 'cloud://' + config.envId + '.bucket/';
  let doc = { accountKey: scope, version: 1, generation: 1, inspirations: [record()] };
  const db = { get: async () => structuredClone(doc), async compareAndSwap(key, version, next) {
    if (key !== scope || doc.version !== version) return false;
    doc = structuredClone(next); return true;
  } };
  const repository = createRepository({ db, now: () => 5, photosEnabled: true, storagePrefix,
    validatePhoto: createPhotoValidator(storagePrefix), removeFiles: async () => ({ ok: true, removed: [] }) });
  const uploads = [], downloads = [];
  try {
    global.wx = {
      requirePrivacyAuthorize: options => options.success({}),
      chooseMedia: options => options.success({ tempFiles: [{ tempFilePath: 'wxfile://synthetic-selection', size: 100 }] }),
      cloud: sharedCloud({ async uploadFile(input) { uploads.push(input); return { fileID: storagePrefix + input.cloudPath }; },
        async downloadFile({ fileID }) { downloads.push(fileID); return { tempFilePath: 'wxfile://synthetic-display' }; } })
    };
    const snapshot = (await repository.pull(scope)).data;
    const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: snapshot, transport: {
      send: async (action, payload) => action === 'snapshot.pull' ? repository.pull(scope) : repository.push(scope, payload)
    } });
    const service = createWxPhotos({ cacheScope: scope, store, storagePrefix, isCurrent: () => true });
    assert.equal((await service.add('idea', 'album')).ok, true);
    const photos = store.getInspiration('idea').photos;
    assert.equal(photos.length, 1); assert.equal(doc.inspirations[0].photos[0].fileId, photos[0].fileId);
    const shown = await loadPrivatePhotos(photos, { cacheScope: scope, isCurrent: () => true });
    assert.equal(shown[0].src, 'wxfile://synthetic-display'); assert.equal(shown[0].failed, false);
    assert.equal(uploads.length, 1); assert.deepEqual(downloads, [photos[0].fileId]);
    assert.equal(uploads[0].filePath, 'wxfile://synthetic-selection');
    assert.ok(!JSON.stringify(doc).includes('wxfile://'), '临时选择与展示路径不能进入记录');
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});

test('私有照片：记录照片ID与文件尾段不一致时不连接也不下载', async () => {
  let connections = 0;
  const result = await loadPrivatePhotos([{ id: 'p1', fileId: prefix + 'p2' }], { cacheScope: scope,
    isCurrent: () => true, getClient: async () => { connections++; return { downloadFile() { assert.fail('禁止下载'); } }; } });
  assert.deepEqual(result, [{ id: 'p1', src: '', failed: true }]); assert.equal(connections, 0);
});

test('照片兼容：开发工具缺少chooseMedia时使用chooseImage并正确上传关联', async () => {
  const previous = global.wx;
  const { createWxPhotos } = require('../miniprogram/services/wx-photo');
  let current = record(); const selected = [], uploads = [];
  const storagePrefix = 'cloud://' + config.envId + '.bucket/';
  const store = { getInspiration: () => current, saveInspiration: async next => { current = next; return { ok: true, synced: true }; }, refresh: async () => ({ ok: true }) };
  try {
    global.wx = { chooseImage(options) {
      selected.push({ count: options.count, source: options.sourceType, size: options.sizeType });
      options.success({ tempFilePaths: ['wxfile://legacy-image'], tempFiles: [{ path: 'wxfile://legacy-image', size: 120 }] });
    }, cloud: sharedCloud({ async uploadFile(input) { uploads.push(input); return { fileID: storagePrefix + input.cloudPath }; } }) };
    const service = createWxPhotos({ cacheScope: scope, store, storagePrefix, isCurrent: () => true });
    const result = await service.add('idea', 'album');
    assert.equal(result.ok, true); assert.deepEqual(selected, [{ count: 9, source: ['album'], size: ['compressed'] }]);
    assert.equal(uploads[0].filePath, 'wxfile://legacy-image'); assert.equal(current.photos.length, 1);
    assert.ok(!JSON.stringify(current).includes('wxfile://'));
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});

test('照片兼容：两个选择接口均不可用时明确失败且不写入', async () => {
  const previous = global.wx;
  const { createWxPhotos } = require('../miniprogram/services/wx-photo');
  try {
    global.wx = {};
    const service = createWxPhotos({ cacheScope: scope, storagePrefix: 'cloud://' + config.envId + '.bucket/',
      store: { getInspiration: () => record(), saveInspiration() { assert.fail('不可用时不写入'); } }, isCurrent: () => true });
    const result = await service.add('idea', 'album');
    assert.equal(result.ok, false); assert.match(result.message, /重新选择/);
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});

test('照片上传：仅保留安全错误码，不把原始文件地址与凭证交给调用者', async () => {
  const uploader = createUploader({ uploadFile: async () => { throw { errCode: -502003, errMsg: 'cloud://private-bucket/secret-path token=not-for-output' }; } });
  const result = await uploader.uploadPhoto({ accountKey: scope, inspirationId: 'idea', photoId: 'p1', tempFilePath: 'wxfile://synthetic' });
  assert.equal(result.ok, false); assert.equal(result.errorCode, -502003);
  assert.ok(!JSON.stringify(result).includes('secret-path')); assert.ok(!JSON.stringify(result).includes('token'));
});

test('私有照片：下载错误状态与空路径保持失败占位，单张失败不影响其他图片', async () => {
  const photos = ['p1', 'p2', 'p3'].map(id => ({ id, fileId: prefix + id }));
  const result = await loadPrivatePhotos(photos, { cacheScope: scope, isCurrent: () => true,
    getClient: async () => ({ async downloadFile({ fileID }) {
      if (fileID.endsWith('p1')) return { errCode: -1, tempFilePath: 'wxfile://invalid' };
      if (fileID.endsWith('p2')) return { tempFilePath: '  ' };
      return { errCode: 0, tempFilePath: 'wxfile://valid' };
    } }) });
  assert.equal(result[0].failed, true); assert.equal(result[0].src, '');
  assert.equal(result[1].failed, true); assert.equal(result[1].src, '');
  assert.equal(result[2].src, 'wxfile://valid'); assert.equal(result[2].failed, false);
});

async function withViewer(run, failedSecond = false) {
  const previous = { wx: global.wx, Page: global.Page, getApp: global.getApp };
  const file = require.resolve('../miniprogram/pages/photo-viewer/index');
  const item = { ...record(), photos: ['p1', 'p2'].map(id => ({ id, fileId: prefix + id, createdAt: 2 })) };
  const store = { getInspiration: () => item };
  const app = { globalData: { store, sessionEpoch: 1, cacheScope: scope }, ensureReady: async () => store };
  let definition;
  try {
    global.Page = value => { definition = value; }; global.getApp = () => app;
    global.wx = { cloud: sharedCloud({ async downloadFile({ fileID }) {
      if (failedSecond && fileID.endsWith('/p2')) throw Error('SYNTHETIC_FAILURE');
      return { tempFilePath: 'wxfile://private/' + fileID.split('/').pop() };
    } }) };
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(next) { Object.assign(this.data, next); } };
    await page.onLoad({ id: 'idea', photo: 'p1' });
    await run({ page, app });
  } finally {
    delete require.cache[file];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}
const imageError = (id, src) => ({ currentTarget: { dataset: { id, src } } });

test('照片查看：单张渲染失败显示占位，迟到图片错误不覆盖新路径', async () => {
  await withViewer(async ({ page, app }) => {
    const oldSrc = page.data.photos[0].src;
    page.onImageError(imageError('p1', oldSrc));
    assert.equal(page.data.photos[0].failed, true); assert.equal(page.data.photos[0].src, '');
    assert.equal(page.data.photos[1].failed, false);
    page.setData({ photos: [{ id: 'p1', src: 'wxfile://new', failed: false }, page.data.photos[1]], error: '' });
    page.onImageError(imageError('p1', oldSrc));
    assert.equal(page.data.photos[0].src, 'wxfile://new'); assert.equal(page.data.error, '');
    app.globalData.sessionEpoch++;
    page.onImageError(imageError('p1', 'wxfile://new'));
    assert.equal(page.data.photos[0].src, 'wxfile://new');
  });
});

test('照片查看：重试保持当前照片位置，隐藏后不处理旧事件', async () => {
  await withViewer(async ({ page }) => {
    page.onChange({ detail: { current: 1 } });
    await page.onReload();
    assert.equal(page.data.current, 1); assert.equal(page.data.photos[1].id, 'p2');
    page.onHide(); page.onImageError(imageError('p2', 'wxfile://private/p2'));
    page.onChange({ detail: { current: 1 } });
    assert.deepEqual(page.data.photos, []);
  });
});

test('照片查看：仅当前失败照片显示错误，切回成功照片清除失败状态', async () => {
  await withViewer(async ({ page }) => {
    assert.equal(page.data.photos[0].failed, false); assert.equal(page.data.photos[1].failed, true);
    assert.equal(page.data.error, '');
    page.onChange({ detail: { current: 1 } }); assert.match(page.data.error, /照片未加载/);
    await page.onReload(); assert.equal(page.data.current, 1); assert.match(page.data.error, /照片未加载/);
    page.onChange({ detail: { current: 0 } }); assert.equal(page.data.error, '');
    page.onImageError(imageError('p2', 'wxfile://old'));
    assert.equal(page.data.error, '');
  }, true);
});
