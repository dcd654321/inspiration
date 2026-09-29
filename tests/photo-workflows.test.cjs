'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../server/repository');
const { createPhotoValidator } = require('../server/photo-lifecycle');
const { createPhotoWorkflow } = require('../qa/legacy/photo-workflow');
const { createStore } = require('../qa/legacy/store');
const core = require('../miniprogram/core/inspiration');
const scope = 'a'.repeat(32), prefix = 'cloud://test.bucket/';
function item() { return core.createInspiration({ id: 'idea', text: '照片相关的记录', now: 1 }); }
function photo(id) { return { id, createdAt: 2, fileId: prefix + 'linggan/' + scope + '/idea/' + id }; }
function database() {
  let value = { accountKey: scope, version: 1, generation: 1, inspirations: [Object.assign({}, item(), { photos: [photo('p1'), photo('p2')] })] };
  return { get: async () => structuredClone(value), compareAndSwap: async (_, version, next) => { if (value.version !== version) return false; value = structuredClone(next); return true; } };
}
test('照片路径严格绑定环境账户记录，普通推送不能移除已有文件引用', async () => {
  const valid = createPhotoValidator(prefix);
  assert.equal(valid(scope, 'idea', photo('p1')), true);
  for (const bad of ['https://any/file', photo('p1').fileId.replace(scope, 'b'.repeat(32)), photo('p1').fileId.replace('test.bucket', 'other.bucket')]) assert.equal(valid(scope, 'idea', Object.assign(photo('p1'), { fileId: bad })), false);
  const db = database(), repository = createRepository({ db, now: () => 5, photosEnabled: true, validatePhoto: valid, removeFiles: async () => ({ ok: false }) });
  const payload = { baseVersion: 1, generation: 1, upserts: [item()] };
  assert.equal((await repository.push(scope, payload)).code, 'PHOTO_REMOVE_REQUIRES_ACTION');
  assert.equal((await db.get()).version, 1);
});
test('照片分步删除先登记任务，部分失败保留进度并拒绝改写，重试后完成', async () => {
  const db = database(); let fail = true; const calls = [];
  const repository = createRepository({ db, now: () => 5, photosEnabled: true, validatePhoto: createPhotoValidator(prefix), removeFiles: async (ids) => {
    calls.push(ids); return { ok: !fail, removed: fail ? [photo('p1').fileId] : ids };
  } });
  const input = { inspirationId: 'idea', generation: 1, baseVersion: 1 };
  assert.equal((await repository.remove(scope, input)).code, 'PHOTO_CLEANUP_PENDING');
  const pending = await db.get();
  assert.equal(pending.inspirations.length, 1); assert.equal(pending.photoCleanup.length, 1);
  assert.deepEqual(pending.photoCleanup[0].removedIds, [photo('p1').fileId]);
  assert.equal((await repository.push(scope, { generation: 1, baseVersion: pending.version, upserts: pending.inspirations })).code, 'PHOTO_CLEANUP_PENDING');
  fail = false; assert.equal((await repository.remove(scope, input)).ok, true);
  assert.deepEqual(calls[1], [photo('p2').fileId]);
  assert.equal((await db.get()).inspirations.length, 0); assert.equal((await db.get()).photoCleanup.length, 0);
});
test('照片单张删除不动正文与其他照片，过期版本在清理前拒绝', async () => {
  const db = database(); let calls = 0;
  const repository = createRepository({ db, now: () => 5, photosEnabled: true, validatePhoto: createPhotoValidator(prefix), removeFiles: async (ids) => { calls++; return { ok: true, removed: ids }; } });
  const input = { inspirationId: 'idea', photoId: 'p1', generation: 1, baseVersion: 0 };
  assert.equal((await repository.removePhoto(scope, input)).code, 'CONFLICT'); assert.equal(calls, 0);
  input.baseVersion = 1; assert.equal((await repository.removePhoto(scope, input)).ok, true);
  const result = (await db.get()).inspirations[0];
  assert.equal(result.text, item().text); assert.deepEqual(result.photos, [photo('p2')]);
});
function workflowSetup() {
  const data = new Map(); let current = item(), uploadFail = true, synced = true, sequence = 0;
  const uploads = [], removed = [];
  const storage = { get: (key) => structuredClone(data.get(key)), set: (key, value) => data.set(key, structuredClone(value)) };
  const store = { getInspiration: () => current, getConflict: () => null, getBackupStatus: () => ({ pendingCount: synced ? 0 : 1 }),
    retryPending: async () => ({ ok: true, synced }), saveInspiration: async (next) => { current = next; return { ok: true, synced }; } };
  const options = { storage, cacheScope: scope, store, newId: () => 'p' + ++sequence, now: () => 2,
    expectedFileId: (_, id) => photo(id).fileId, prepare: async () => ({ ok: true, accepted: [{ tempFilePath: 'temp' }], rejected: [] }),
    upload: async (input) => { uploads.push(input); return uploadFail ? { ok: false } : { ok: true, fileId: photo(input.photoId).fileId }; },
    saveFile: async () => 'saved', removeLocal: async (file) => { removed.push(file); }, removeRemote: async (file) => { removed.push(file); } };
  return { service: createPhotoWorkflow(options), options, uploads, removed, store,
    setUploadFail: (value) => { uploadFail = value; }, setSynced: (value) => { synced = value; } };
}
test('照片上传失败持久保留并可跨实例重试，文字独立且同一对象不重复追加', async () => {
  const env = workflowSetup();
  assert.equal((await env.service.add('idea', 'camera')).ok, false);
  assert.equal(env.service.list('idea').length, 1); assert.equal(env.store.getInspiration().photos.length, 0);
  assert.equal(env.store.getInspiration().text, item().text);
  env.setUploadFail(false); env.setSynced(false);
  const restarted = createPhotoWorkflow(env.options);
  assert.equal((await restarted.retry('p1')).ok, false); assert.equal(env.store.getInspiration().photos.length, 1);
  assert.equal(env.removed.length, 0, '备份前不得删本机文件');
  env.setSynced(true); assert.equal((await restarted.retry('p1')).ok, true);
  assert.equal(env.uploads.length, 2); assert.equal(env.uploads[0].photoId, env.uploads[1].photoId);
  assert.equal(env.store.getInspiration().photos.length, 1); assert.equal(restarted.list().length, 0);
});
test('用户放弃失败照片仅清固定对象且不重传，账户任务隔离', async () => {
  const env = workflowSetup(); await env.service.add('idea', 'album');
  const other = createPhotoWorkflow(Object.assign({}, env.options, { cacheScope: 'b'.repeat(32) }));
  assert.equal(other.list().length, 0);
  assert.equal((await env.service.discard('p1')).ok, true);
  assert.equal(env.uploads.length, 1); assert.deepEqual(env.removed, [photo('p1').fileId, 'saved']);
  assert.equal(env.service.list().length, 0);
});

test('照片上传期间会话失效不写入另一账户，原任务可在确认身份后重试', async () => {
  const env = workflowSetup(); let active = true, uploads = 0;
  const options = Object.assign({}, env.options, { isCurrent: () => active, upload: async () => {
    uploads++; active = false; return { ok: true, fileId: photo('p1').fileId };
  } });
  const service = createPhotoWorkflow(options);
  assert.equal((await service.add('idea', 'album')).ok, false);
  assert.equal(env.store.getInspiration().photos.length, 0);
  assert.equal(service.list().length, 1);
  assert.equal((await service.retry('p1')).ok, false); assert.equal(uploads, 1);
  assert.equal((await service.discard('p1')).ok, false); assert.deepEqual(env.removed, []);
  active = true; env.setUploadFail(false); env.setSynced(true);
  assert.equal((await createPhotoWorkflow(env.options).retry('p1')).ok, true);
  assert.equal(env.store.getInspiration().photos.length, 1);
});
test('照片删除待确认时保留可见内容并暂停改写，成功后单张出队', async () => {
  let data, fail = true; const calls = [];
  const initial = Object.assign({}, item(), { photos: [photo('p1')] });
  const storage = { get: () => structuredClone(data), set: (_, next) => { data = structuredClone(next); } };
  const store = createStore({ storage, cacheScope: scope, now: () => 5, remoteSnapshot: { cacheScope: scope, generation: 1, version: 1, photosEnabled: true, inspirations: [initial] },
    transport: { send: async (action, payload) => { calls.push([action, payload]); return fail ? { ok: false, code: 'PHOTO_CLEANUP_PENDING' } : { ok: true, data: { version: 3 } }; } } });
  assert.equal((await store.deletePhoto('idea', 'p1')).synced, false); assert.equal(store.getInspiration('idea').photos.length, 1);
  assert.equal((await store.saveInspiration(item())).code, 'PHOTO_CLEANUP_PENDING');
  fail = false; assert.equal((await store.deletePhoto('idea', 'p1')).synced, true);
  assert.equal(store.getInspiration('idea').photos.length, 0); assert.equal(store.readQueue().length, 0);
  assert.equal(calls[0][0], 'photo.delete');
});
test('照片冲突切换保留完整引用及恢复预览，旧照片能力未确认时仍失败关闭', async () => {
  let data;
  const remote = { cacheScope: scope, generation: 1, version: 2, inspirations: [] };
  const store = createStore({ storage: { get: () => structuredClone(data), set: (_, x) => { data = structuredClone(x); } }, cacheScope: scope, now: () => 5,
    remoteSnapshot: Object.assign({}, remote, { photosEnabled: true }),
    transport: { send: async (action) => action === 'snapshot.pull' ? { ok: true, data: remote } : { ok: false, code: 'CONFLICT' } } });
  await store.saveInspiration(Object.assign({}, item(), { photos: [photo('p1')] }));
  assert.equal((await store.resolveUseRemote()).ok, true);
  assert.deepEqual(store.getRecoveries()[0].snapshot.inspirations[0].photos, [photo('p1')]);
});
