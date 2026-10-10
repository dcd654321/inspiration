'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { createRepository } = require('../server/repository');
const { createPhotoValidator } = require('../server/photo-lifecycle');

const scope = 'a'.repeat(32);
const prefix = 'cloud://test.bucket/';
const record = id => core.createInspiration({ id, text: id + ' 的原文', now: 1 });
const supplement = (item, id) => core.appendSupplement(item, { id, content: id + ' 的补充', source: 'user', now: 2 });
const ids = item => item.supplements.map(entry => entry.id);

function database(inspirations = [record('a'), record('b')]) {
  let document = { accountKey: scope, generation: 1, version: 1, inspirations, photoCleanup: [] };
  let writes = 0;
  return {
    get: async () => structuredClone(document),
    compareAndSwap: async (_key, version, next) => {
      if (document.version !== version) return false;
      document = structuredClone(next); writes += 1; return true;
    },
    read: () => structuredClone(document),
    writes: () => writes
  };
}

test('版本安全：丢失回执后的幂等重试取得完整快照，不覆盖另一条记录的新补充', async () => {
  const db = database();
  const repository = createRepository({ db, now: () => 3 });
  let loseWriteReceipt = true, losePull = true;
  const transport = { send: async (action, payload) => {
    if (action === 'snapshot.pull') {
      if (losePull) throw Error('回读暂不可用');
      return repository.pull(scope);
    }
    const result = await repository.push(scope, payload);
    if (loseWriteReceipt) { loseWriteReceipt = false; throw Error('写入已发生，回执丢失'); }
    return result;
  } };
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: (await repository.pull(scope)).data, transport });
  const nextA = supplement(store.getInspiration('a'), 'local_a');
  assert.equal((await store.saveInspiration(nextA)).code, 'NETWORK');
  assert.equal(store.getConfirmedRevision().baseVersion, 1);
  assert.equal(db.read().version, 2);

  const remoteB = supplement(db.read().inspirations.find(item => item.id === 'b'), 'remote_b');
  assert.equal((await repository.push(scope, { generation: 1, baseVersion: 2, upserts: [remoteB] })).ok, true);
  losePull = false;
  assert.deepEqual(await store.saveInspiration(nextA), { ok: true, synced: true });
  assert.equal(store.getConfirmedRevision().baseVersion, 3);
  assert.deepEqual(ids(store.getInspiration('b')), ['remote_b'], '新版本必须对应完整回读后的 B');
  assert.deepEqual(store.getInspiration('a'), nextA);

  assert.deepEqual(await store.saveInspiration(supplement(store.getInspiration('b'), 'local_b')), { ok: true, synced: true });
  assert.deepEqual(ids(db.read().inspirations.find(item => item.id === 'b')), ['remote_b', 'local_b']);
});

test('版本安全：排队回读后的旧记录写入返回冲突，不自动套用新版本', async () => {
  const db = database();
  const repository = createRepository({ db, now: () => 3 });
  let finishPull, pushes = 0;
  const gate = new Promise(resolve => { finishPull = resolve; });
  const transport = { send: async (action, payload) => {
    if (action === 'snapshot.pull') { await gate; return repository.pull(scope); }
    pushes += 1; return repository.push(scope, payload);
  } };
  const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: (await repository.pull(scope)).data, transport });
  const oldB = store.getInspiration('b');
  assert.equal((await repository.push(scope, { generation: 1, baseVersion: 1, upserts: [supplement(oldB, 'remote_b')] })).ok, true);
  const refreshing = store.refresh();
  const saving = store.saveInspiration(supplement(oldB, 'local_b'));
  finishPull();
  assert.deepEqual(await refreshing, { ok: true, synced: true });
  const result = await saving;
  assert.equal(result.ok, false); assert.equal(result.code, 'CONFLICT');
  assert.equal(pushes, 0, '旧稿件不能以回读后的新版本发送');
  assert.equal(db.read().version, 2);
  assert.deepEqual(ids(db.read().inspirations.find(item => item.id === 'b')), ['remote_b']);
  assert.deepEqual(ids(store.getInspiration('b')), ['remote_b']);
});

test('版本安全：缺失记录和照片的旧版本空操作拒绝，当前版本空操作成功', async () => {
  const db = database();
  let removed = 0;
  const repository = createRepository({ db, now: () => 3, photosEnabled: true,
    validatePhoto: createPhotoValidator(prefix), removeFiles: async () => { removed += 1; return { removed: [] }; } });
  for (const [method, payload] of [
    ['remove', { inspirationId: 'missing' }],
    ['removePhoto', { inspirationId: 'missing', photoId: 'missing_photo' }],
    ['removePhoto', { inspirationId: 'a', photoId: 'missing_photo' }]
  ]) {
    const old = await repository[method](scope, { ...payload, generation: 1, baseVersion: 0 });
    assert.equal(old.ok, false); assert.equal(old.code, 'CONFLICT');
    const current = await repository[method](scope, { ...payload, generation: 1, baseVersion: 1 });
    assert.equal(current.ok, true); assert.equal(current.data.version, 1); assert.equal(current.data.alreadyAbsent, true);
  }
  assert.equal(db.writes(), 0); assert.equal(removed, 0);
  assert.equal(db.read().inspirations.length, 2);
});

test('版本安全：删除成功回执版本跳跃须回读，回读失败保留原版本', async () => {
  const photo = { id: 'p1', createdAt: 1, fileId: prefix + 'linggan/' + scope + '/a/p1' };
  const initial = { cacheScope: scope, generation: 1, version: 1,
    inspirations: [{ ...record('a'), photos: [photo] }, record('b')] };
  const latest = { ...initial, version: 3, inspirations: [record('a'), supplement(record('b'), 'remote_b')] };
  for (const readable of [true, false]) {
    let pulls = 0;
    const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: structuredClone(initial), transport: {
      send: async action => {
        if (action === 'photo.delete') return { ok: true, data: { version: 3 } };
        assert.equal(action, 'snapshot.pull'); pulls += 1;
        if (!readable) throw Error('回读暂不可用');
        return { ok: true, data: structuredClone(latest) };
      }
    } });
    const result = await store.deletePhoto('a', 'p1');
    assert.equal(pulls, 1, '跳跃回执不能直接给旧快照换版本');
    if (readable) {
      assert.deepEqual(result, { ok: true, synced: true });
      assert.equal(store.getConfirmedRevision().baseVersion, 3);
      assert.equal(store.getInspiration('a').photos.length, 0);
      assert.deepEqual(ids(store.getInspiration('b')), ['remote_b']);
    } else {
      assert.equal(result.ok, false); assert.equal(result.code, 'NETWORK');
      assert.equal(store.getConfirmedRevision().baseVersion, 1);
      assert.deepEqual(store.getInspiration('a').photos, [photo]);
      assert.deepEqual(ids(store.getInspiration('b')), []);
    }
  }
});

test('版本安全：排队回读后保存和删除均绑定原版本及代际，变更时不发送', async () => {
  const photo = { id: 'p1', createdAt: 1, fileId: prefix + 'linggan/' + scope + '/a/p1' };
  const initial = { cacheScope: scope, generation: 1, version: 1,
    inspirations: [{ ...record('a'), photos: [photo] }, record('b')] };
  const changes = [
    { snapshot: { ...initial, version: 2 }, code: 'CONFLICT' },
    { snapshot: { ...initial, generation: 2, version: 0, inspirations: [] }, code: 'STALE_GENERATION' }
  ];
  const actions = [
    ['保存', store => store.saveInspiration(supplement(store.getInspiration('b'), 'local_b'))],
    ['删除记录', store => store.deleteInspiration('a')],
    ['删除照片', store => store.deletePhoto('a', 'p1')]
  ];
  for (const change of changes) for (const [label, submit] of actions) {
    let finishPull, sends = 0;
    const gate = new Promise(resolve => { finishPull = resolve; });
    const store = createCloudOnlyStore({ cacheScope: scope, remoteSnapshot: structuredClone(initial), transport: {
      send: async action => {
        if (action === 'snapshot.pull') { await gate; return { ok: true, data: structuredClone(change.snapshot) }; }
        sends += 1; return { ok: true, data: { version: change.snapshot.version + 1 } };
      }
    } });
    const refreshing = store.refresh();
    const saving = submit(store);
    finishPull();
    assert.deepEqual(await refreshing, { ok: true, synced: true });
    const result = await saving;
    assert.equal(result.ok, false); assert.equal(result.code, change.code, label);
    assert.equal(sends, 0, label + ' 不能在回读后改用新版本或新代际发送');
    assert.deepEqual(store.readSnapshot().inspirations, change.snapshot.inspirations);
    assert.deepEqual(store.getConfirmedRevision(), { baseVersion: change.snapshot.version, generation: change.snapshot.generation });
  }
});
