'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { createRepository } = require('../server/repository');
const { createPhotoValidator } = require('../server/photo-lifecycle');
const { createCommittedMonitor } = require('../server/operations-monitor');

const scope = 'a'.repeat(32), prefix = 'cloud://archive.bucket/';
const original = (id = 'idea') => core.createInspiration({ id, text: '保留这条灵感', now: 10 });
const photo = () => ({ id: 'photo_1', fileId: prefix + 'linggan/' + scope + '/idea/photo_1', createdAt: 12 });
function fixture(items = [original()], options = {}) {
  let document = { accountKey: scope, generation: 1, version: 1, inspirations: structuredClone(items), photoCleanup: [] };
  const removed = [];
  const db = {
    get: async () => structuredClone(document),
    compareAndSwap: async (_key, version, next) => {
      if (version !== document.version) return false;
      document = structuredClone(next); return true;
    }
  };
  const repository = createRepository({ db, now: () => 100, photosEnabled: true,
    validatePhoto: createPhotoValidator(prefix),
    removeFiles: async (ids) => { removed.push(...ids); return { removed: ids }; }, ...options });
  const transport = { send: (action, payload) => action === 'snapshot.pull' ? repository.pull(scope)
    : action === 'snapshot.push' ? repository.push(scope, payload)
      : action === 'inspiration.delete' ? repository.remove(scope, payload) : repository.removePhoto(scope, payload) };
  const push = (upserts, baseVersion = document.version, generation = document.generation) =>
    repository.push(scope, { upserts, baseVersion, generation });
  const store = async (overrides = {}) => createCloudOnlyStore({ cacheScope: scope,
    remoteSnapshot: (await repository.pull(scope)).data, transport, ...overrides });
  return { repository, db, transport, push, store, removed, read: () => structuredClone(document),
    set: (patch) => { document = Object.assign({}, document, structuredClone(patch)); } };
}

test('归档领域操作完整保留内容历史与编辑时间，时间零有效且重复归档幂等', () => {
  const item = { ...original(), tags: ['素材'], stage: 'ready', photos: [photo()],
    textHistory: [{ id: 'history_1', text: '旧文字', replacedAt: 9 }],
    supplements: [{ id: 'supplement_1', content: '后续补充', source: 'user', createdAt: 11,
      contentHistory: [{ id: 'history_2', content: '旧补充', replacedAt: 12 }] }] };
  const archived = core.markArchived(item, { now: 0 });
  assert.equal(core.isArchived(archived), true);
  assert.deepEqual(archived, { ...item, archivedAt: 0 });
  assert.equal(core.markArchived(archived, { now: 999 }), archived);
  assert.deepEqual(core.unarchive(archived), item);
  assert.equal(Object.isFrozen(archived.supplements[0].contentHistory), true);
  assert.throws(() => core.markArchived({ ...item, mergedInto: 'other' }, { now: 1 }), { code: 'ALREADY_MERGED' });
  for (const now of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) {
    assert.throws(() => core.markArchived(item, { now }), { code: 'INVALID_NOW' });
  }
  assert.equal(core.isArchived({}), false);
  assert.equal(core.isArchived({ archivedAt: null }), false);
});

test('归档保存确认后普通列表隐藏，快照详情仍可读，恢复按原编辑时间排序', async () => {
  const item = original(), newer = { ...original('newer'), updatedAt: 20 };
  const f = fixture([item, newer]), store = await f.store();
  assert.deepEqual(await store.saveInspiration(core.markArchived(item, { now: 30 })), { ok: true, synced: true });
  assert.deepEqual(store.listInspirations().map((row) => row.id), ['newer']);
  assert.equal(store.readSnapshot().inspirations.length, 2);
  assert.equal(store.getInspiration(item.id).archivedAt, 30);
  assert.deepEqual(await store.saveInspiration(core.unarchive(store.getInspiration(item.id))), { ok: true, synced: true });
  assert.deepEqual(store.listInspirations().map((row) => row.id), ['newer', 'idea']);
  assert.equal(store.getInspiration(item.id).updatedAt, 10);
});

test('归档保存失败保留未归档视图，回读确认丢失回执时才报告成功', async () => {
  const f = fixture(), target = core.markArchived(original(), { now: 0 });
  const failed = await f.store({ transport: { send: (action, payload) => action === 'snapshot.push'
    ? { ok: false, code: 'NETWORK' } : f.transport.send(action, payload) } });
  assert.equal((await failed.saveInspiration(target)).ok, false);
  assert.equal(core.isArchived(failed.getInspiration('idea')), false);
  assert.equal(failed.listInspirations().length, 1);
  let pushes = 0;
  const recovered = await f.store({ transport: { send: async (action, payload) => {
    const result = await f.transport.send(action, payload);
    if (action === 'snapshot.push') { pushes++; assert.equal(result.ok, true); throw Error('lost receipt'); }
    return result;
  } } });
  assert.deepEqual(await recovered.saveInspiration(target), { ok: true, synced: true });
  assert.equal(pushes, 1);
  assert.equal(recovered.listInspirations().length, 0);
  assert.deepEqual(recovered.getInspiration('idea'), target);
});

test('归档与跨设备编辑并发只允许一项成功，旧版本与旧代际先拒绝', async () => {
  const item = original(), f = fixture();
  const archive = core.markArchived(item, { now: 30 });
  const edit = core.updateText(item, { text: '另一台设备的修改', historyId: 'history_1', now: 40 });
  const results = await Promise.all([f.push([archive], 1), f.push([edit], 1)]);
  assert.equal(results.filter((row) => row.ok).length, 1);
  assert.equal(results.find((row) => !row.ok).code, 'CONFLICT');
  assert.equal((await f.push([edit], 1)).code, 'CONFLICT');
  assert.equal((await f.push([edit], f.read().version, 2)).code, 'STALE_GENERATION');
  assert.deepEqual(f.read().inspirations, [archive]);
});

test('其他设备改写后归档回读保留新内容，不用新版本套用旧归档目标', async () => {
  const f = fixture(), store = await f.store(), item = original();
  const newer = core.appendSupplement(item, { id: 'supplement_1', content: '新的补充', now: 20 });
  await f.push([newer]);
  assert.deepEqual(await store.saveInspiration(core.markArchived(item, { now: 30 })), { ok: false, code: 'CONFLICT', message: 'CONFLICT' });
  assert.deepEqual(store.getInspiration('idea'), newer);
  assert.equal(core.isArchived(store.getInspiration('idea')), false);
});

test('旧客户端省略归档字段继承原值，省略字段不能改写归档内容', async () => {
  const archived = core.markArchived(original(), { now: 0 }), f = fixture([archived]);
  const { archivedAt: _unused, ...legacy } = archived;
  assert.equal((await f.push([legacy])).ok, true);
  assert.equal(f.read().version, 1, '相同内容不产生额外版本');
  assert.equal(f.read().inspirations[0].archivedAt, 0);
  assert.equal((await f.push([{ ...legacy, archivedAt: undefined }])).ok, true);
  assert.equal(f.read().inspirations[0].archivedAt, 0);
  assert.equal((await f.push([{ ...legacy, tags: ['旧设备修改'] }])).code, 'INSPIRATION_ARCHIVED');
  let sent, serialized;
  const store = await f.store({ transport: { send: async (action, payload) => {
    const wirePayload = JSON.parse(JSON.stringify(payload));
    if (action === 'snapshot.push') { sent = payload.upserts[0]; serialized = wirePayload.upserts[0]; }
    return f.transport.send(action, wirePayload);
  } } });
  for (const submitted of [legacy, { ...legacy, archivedAt: undefined }]) {
    assert.deepEqual(await store.saveInspiration(submitted), { ok: true, synced: true });
    assert.equal(sent.archivedAt, 0);
    assert.equal(serialized.archivedAt, 0);
    assert.equal(store.getInspiration('idea').archivedAt, 0);
    assert.equal(store.listInspirations().length, 0);
  }
});

test('旧记录缺失归档字段与显式空值的发送回读比较相同', async () => {
  const { archivedAt: _unused, ...legacy } = original(), f = fixture([legacy]);
  const store = await f.store({ transport: { send: async (action) => action === 'snapshot.push'
    ? { ok: false, code: 'NETWORK' } : f.repository.pull(scope) } });
  assert.equal(store.getInspiration('idea').archivedAt, null);
  assert.deepEqual(await store.saveInspiration(legacy), { ok: true, synced: true });
  assert.deepEqual(await store.saveInspiration({ ...legacy, archivedAt: undefined }), { ok: true, synced: true });
  assert.equal(store.getInspiration('idea').archivedAt, null);
  assert.equal(f.read().version, 1);
});

test('归档与恢复只能改变归档字段，内容照片历史标签及归档时间不能夹带改写', async () => {
  const item = { ...original(), photos: [photo()] }, f = fixture([item]);
  const archived = core.markArchived(item, { now: 30 });
  for (const patch of [{ text: '变化' }, { updatedAt: 31 }, { tags: ['变化'] }, { stage: 'ready' },
    { photos: [] }, { supplements: [{ id: 'supplement_1', content: '补充', createdAt: 12 }] }]) {
    assert.equal((await f.push([{ ...archived, ...patch }])).code, 'INSPIRATION_ARCHIVED');
  }
  assert.equal((await f.push([archived])).ok, true);
  for (const patch of [{ text: '变化' }, { updatedAt: 31 }, { archivedAt: 40 }, { archivedAt: null, tags: ['变化'] }]) {
    assert.equal((await f.push([{ ...archived, ...patch }])).code, 'INSPIRATION_ARCHIVED');
  }
  assert.deepEqual(f.read().inspirations, [archived]);
  assert.equal((await f.push([core.unarchive(archived)])).ok, true);
});

test('服务端拒绝非法归档时间、新建即归档和已合并记录归档', async () => {
  for (const archivedAt of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', false]) {
    const f = fixture();
    assert.equal((await f.push([{ ...original(), archivedAt }])).code, 'INVALID_PAYLOAD');
    assert.equal(f.read().version, 1);
  }
  const f = fixture([original(), original('target')]);
  assert.equal((await f.push([core.markArchived(original('new'), { now: 0 })])).code, 'INVALID_PAYLOAD');
  assert.equal((await f.push([{ ...original(), mergedInto: 'target', archivedAt: 0 }])).code, 'INVALID_PAYLOAD');
});

test('已归档目标拒绝新增合并引用，既有引用在目标归档后保留', async () => {
  const item = original(), target = original('target'), f = fixture([item, target]);
  const merged = { ...item, mergedInto: target.id };
  assert.equal((await f.push([merged])).ok, true);
  assert.equal((await f.push([core.markArchived(target, { now: 0 })])).ok, true);
  assert.equal((await f.push([merged])).ok, true);
  assert.equal(f.read().inspirations.find((row) => row.id === 'idea').mergedInto, 'target');
  assert.equal((await f.push([{ ...original('new'), mergedInto: target.id }])).code, 'MERGE_TARGET_INVALID');
});

test('归档照片只读且不登记删除任务，整条删除仍清理照片', async () => {
  const archived = core.markArchived({ ...original(), photos: [photo()] }, { now: 0 }), f = fixture([archived]);
  const data = { inspirationId: 'idea', photoId: 'photo_1', generation: 1, baseVersion: 1 };
  assert.equal((await f.repository.removePhoto(scope, { ...data, baseVersion: 0 })).code, 'CONFLICT');
  assert.equal((await f.repository.removePhoto(scope, data)).code, 'INSPIRATION_ARCHIVED');
  assert.deepEqual(f.read().photoCleanup, []);
  assert.deepEqual(f.removed, []);
  assert.equal((await f.repository.remove(scope, data)).ok, true);
  assert.deepEqual(f.read().inspirations, []);
  assert.deepEqual(f.removed, [photo().fileId]);
});

test('已登记的单张照片清理在归档标记存在时仍可安全收敛', async () => {
  const archived = core.markArchived({ ...original(), photos: [photo()] }, { now: 0 }), f = fixture([archived]);
  f.set({ photoCleanup: [{ id: 'idea:photo:photo_1', inspirationId: 'idea', photoId: 'photo_1',
    fileIds: [photo().fileId], removedIds: [], requestedAt: 20 }] });
  assert.equal((await f.repository.removePhoto(scope, { inspirationId: 'idea', photoId: 'photo_1', generation: 1, baseVersion: 0 })).ok, true);
  assert.deepEqual(f.read().inspirations, [{ ...archived, photos: [] }]);
  assert.deepEqual(f.read().photoCleanup, []);
});

test('归档与恢复不重复计入新增记录、补充或成稿事件', async () => {
  let eventAccesses = 0;
  const committed = createCommittedMonitor({ db: { collection() { eventAccesses++; throw Error('不应创建新事件'); } } });
  const item = { ...original(), templateId: 'free' }, f = fixture([item], { onCommitted: committed });
  const context = { sourceUserId: 'user_' + 'b'.repeat(24) };
  const archived = core.markArchived(item, { now: 30 });
  assert.equal((await f.repository.push(scope, { generation: 1, baseVersion: 1, upserts: [archived] }, context)).ok, true);
  assert.equal((await f.repository.push(scope, { generation: 1, baseVersion: 2, upserts: [item] }, context)).ok, true);
  assert.equal(eventAccesses, 0);
});

test('归档写入期间切换账户丢弃迟到回执，不向原会话确认成功', async () => {
  const f = fixture(); let active = true, release;
  const store = await f.store({ isCurrent: () => active, transport: { send: () => new Promise((resolve) => { release = resolve; }) } });
  const pending = store.saveInspiration(core.markArchived(original(), { now: 30 }));
  await new Promise((resolve) => setImmediate(resolve));
  active = false; release({ ok: true, data: { version: 2 } });
  assert.equal((await pending).code, 'ACCOUNT_SESSION_CHANGED');
  assert.equal(core.isArchived(store.getInspiration('idea')), false);
});
