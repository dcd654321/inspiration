'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, LEGACY_STORAGE_KEYS } = require('../miniprogram/services/store');
const { createInspiration } = require('../miniprogram/core/inspiration');

const NOW = 1758500000000;
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function storage() {
  const data = new Map();
  return {
    data, failWrites: 0,
    get(key) { return data.has(key) ? JSON.parse(data.get(key)) : undefined; },
    set(key, value) {
      if (this.failWrites-- > 0) throw new Error('quota');
      data.set(key, JSON.stringify(value));
    }
  };
}

function remote(cacheScope, items = [], version = 0, generation = 1) {
  return { cacheScope, inspirations: items, version, generation };
}

function transport(cacheScope = A) {
  return {
    calls: [], failure: null, version: 0, generation: 1, items: [],
    async send(action, payload, meta) {
      this.calls.push({ action, payload, requestId: meta && meta.requestId });
      if (this.failure) return { ok: false, code: this.failure };
      if (action === 'snapshot.pull') return { ok: true, data: remote(cacheScope, this.items, this.version, this.generation) };
      if (payload.baseVersion !== this.version || payload.generation !== this.generation) {
        return { ok: false, code: 'CONFLICT' };
      }
      this.version += 1;
      if (action === 'inspiration.delete') this.items = this.items.filter((item) => item.id !== payload.inspirationId);
      else this.items = this.items.filter((item) => item.id !== payload.upserts[0].id).concat(payload.upserts);
      return { ok: true, data: { version: this.version } };
    }
  };
}

function setup(opts = {}) {
  const local = opts.local || storage();
  const network = opts.network || transport(opts.scope || A);
  const scope = opts.scope || A;
  const store = createStore({
    storage: local, transport: network, now: () => NOW,
    cacheScope: scope,
    remoteSnapshot: opts.remote || remote(scope),
    newRequestId: opts.newRequestId
  });
  return { local, network, store };
}

function item(id = 'insp_a', text = '做一个记账小程序') {
  return createInspiration({ id, text, now: NOW });
}

test('失效账户实例不再发送队列或确认迟到结果，内容留在原账户', async () => {
  const local = storage(); let active = true, complete, calls = 0;
  const store = createStore({ storage: local, cacheScope: A, remoteSnapshot: remote(A), now: () => NOW,
    isCurrent: () => active, transport: { send: () => { calls++; return new Promise((resolve) => { complete = resolve; }); } } });
  const pending = store.saveInspiration(item());
  active = false; complete({ ok: true, data: { version: 1 } });
  assert.equal((await pending).synced, false);
  assert.equal(store.readQueue().length, 1, '不确认旧会话的迟到回执');
  assert.equal((await store.retryPending()).code, 'ACCOUNT_SESSION_CHANGED');
  assert.equal((await store.saveInspiration(item('second'))).code, 'ACCOUNT_SESSION_CHANGED');
  assert.equal((await store.deleteInspiration('insp_a')).code, 'ACCOUNT_SESSION_CHANGED');
  assert.equal(calls, 1);
  assert.equal(local.data.has('linggan:v2:' + B + ':state'), false);
  assert.equal(store.getInspiration('insp_a').text, item().text);
});

test('必须有可信作用域，旧全局缓存不会自动读取或迁移', () => {
  const local = storage();
  local.set(LEGACY_STORAGE_KEYS.snapshot, { inspirations: [item('old', '旧内容')] });
  assert.throws(() => createStore({ storage: local, transport: transport(), now: () => NOW }), /作用域/);
  const { store } = setup({ local });
  assert.deepEqual(store.listInspirations(), []);
  assert.equal(local.get(LEGACY_STORAGE_KEYS.snapshot).inspirations[0].text, '旧内容');
});

test('同一设备切换账户，缓存和队列按可信作用域隔离', async () => {
  const local = storage();
  const first = setup({ local });
  first.network.failure = 'NETWORK';
  await first.store.saveInspiration(item('a'));
  const second = setup({ local, scope: B });
  assert.deepEqual(second.store.listInspirations(), []);
  assert.deepEqual(second.store.readQueue(), []);
  assert.equal(first.store.readQueue().length, 1);
});

test('损坏的账户缓存停写，不用空快照覆盖', () => {
  const local = storage();
  const key = 'linggan:v2:' + A + ':state';
  local.data.set(key, '{bad');
  assert.throws(() => setup({ local }), /ACCOUNT_CACHE_DAMAGED/);
  assert.equal(local.data.get(key), '{bad');
});

test('损坏的恢复副本也停写，不被启动拉取覆盖', () => {
  const local = storage();
  const key = 'linggan:v2:' + A + ':state';
  local.set(key, {
    generation: 1, version: 1, inspirations: [], queue: [], nextSequence: 1,
    recoveries: [{ snapshot: null, pendingOps: [] }]
  });
  assert.throws(() => setup({ local }), /ACCOUNT_CACHE_DAMAGED/);
  assert.equal(local.get(key).recoveries[0].snapshot, null);
});

test('保存原子写入快照与队列，配额失败时不留下半状态', async () => {
  const { local, store, network } = setup();
  local.failWrites = 1;
  const result = await store.saveInspiration(item());
  assert.equal(result.code, 'LOCAL_WRITE_FAILED');
  assert.deepEqual(store.readSnapshot().inspirations, []);
  assert.deepEqual(store.readQueue(), []);
  assert.equal(network.calls.length, 0);
});

test('保存发送版本和代际，云端确认后出队', async () => {
  const { store, network } = setup();
  const result = await store.saveInspiration(item());
  assert.equal(result.synced, true);
  assert.equal(network.calls[0].payload.baseVersion, 0);
  assert.equal(network.calls[0].payload.generation, 1);
  assert.equal(store.readSnapshot().version, 1);
  assert.equal(store.readQueue().length, 0);
});

test('重复保存同一 id 仍只有一条记录，版本顺序递增', async () => {
  const { store, network } = setup();
  await store.saveInspiration(item());
  await store.saveInspiration(item());
  assert.equal(store.listInspirations().length, 1);
  assert.equal(network.items.length, 1);
  assert.deepEqual(network.calls.map((call) => call.payload.baseVersion), [0, 1]);
});

test('断网保留内容和稳定请求标识，恢复时重试同一操作', async () => {
  const { store, network } = setup();
  network.failure = 'NETWORK';
  const saved = await store.saveInspiration(item());
  assert.equal(saved.synced, false);
  const first = network.calls[0];
  const queued = store.readQueue()[0];
  assert.equal(queued.requestId, first.requestId);
  assert.equal(queued.baseVersion, 0);
  network.failure = null;
  await store.retryPending();
  assert.equal(network.calls[1].requestId, first.requestId);
  assert.equal(network.calls[1].payload.baseVersion, 0);
  assert.equal(store.readQueue().length, 0);
  assert.equal(store.readSnapshot().inspirations.length, 1);
});

test('同一账户两份本机状态的请求标识含独立随机量', async () => {
  const first = setup({ newRequestId: () => 'req_device_a' });
  const second = setup({ newRequestId: () => 'req_device_b' });
  first.network.failure = 'NETWORK';
  second.network.failure = 'NETWORK';
  await first.store.saveInspiration(item('a'));
  await second.store.saveInspiration(item('b'));
  assert.notEqual(first.store.readQueue()[0].requestId, second.store.readQueue()[0].requestId);
  assert.equal(first.store.readQueue()[0].requestId, 'req_device_a_1');
  assert.equal(second.store.readQueue()[0].requestId, 'req_device_b_1');
});

test('请求标识被复用时保留本机队列并停止自动重试', async () => {
  const { store, network } = setup();
  network.failure = 'REQUEST_ID_REUSED';
  await store.saveInspiration(item());
  assert.equal(store.getConflict().code, 'REQUEST_ID_REUSED');
  assert.equal(store.readQueue().length, 1);
  const calls = network.calls.length;
  await store.retryPending();
  assert.equal(network.calls.length, calls);
});

test('拉取时有待备份操作不会覆盖本机内容', async () => {
  const local = storage();
  const first = setup({ local });
  first.network.failure = 'NETWORK';
  await first.store.saveInspiration(item());
  const reopened = setup({ local, remote: remote(A, [item('cloud', '云端内容')], 2) });
  assert.equal(reopened.store.getInspiration('insp_a').text, '做一个记账小程序');
  assert.equal(reopened.store.getInspiration('cloud'), null);
  assert.equal(reopened.store.readQueue().length, 1);
});

test('冲突保留本机和远端快照，停止自动写入', async () => {
  const { store, network } = setup();
  network.version = 1;
  network.items = [item('other', '另一设备')];
  const result = await store.saveInspiration(item());
  assert.equal(result.synced, false);
  assert.equal(store.getBackupStatus().state, 'CONFLICT');
  assert.equal(store.getInspiration('insp_a').text, '做一个记账小程序');
  assert.equal(store.getConflict().remote.inspirations[0].text, '另一设备');
  const rejected = await store.saveInspiration(item('new'));
  assert.equal(rejected.code, 'CONFLICT');
  assert.equal(network.items.length, 1);
});

test('用户采用云端版本前先原子留存本机恢复副本，重开后仍可读取', async () => {
  const local = storage();
  const { store, network } = setup({ local });
  network.version = 1;
  network.items = [item('remote', '另一设备的内容')];
  await store.saveInspiration(item('local', '未备份的本机内容'));

  const result = await store.resolveUseRemote();
  assert.equal(result.ok, true);
  assert.deepEqual(store.listInspirations().map((entry) => entry.id), ['remote']);
  assert.equal(store.readQueue().length, 0);
  assert.equal(store.getRecoveries().length, 1);
  assert.equal(store.getRecoveries()[0].snapshot.inspirations[0].text, '未备份的本机内容');
  assert.equal(store.getRecoveries()[0].pendingOps.length, 1);

  const reopened = setup({ local, remote: remote(A, network.items, network.version) });
  assert.equal(reopened.store.getRecoveries()[0].snapshot.inspirations[0].text, '未备份的本机内容');
  assert.equal(reopened.store.getInspiration('remote').text, '另一设备的内容');
  const otherAccount = setup({ local, scope: B });
  assert.equal(otherAccount.store.getRecoveries().length, 0);
});

test('恢复副本写入失败时不切换版本、不清空原队列', async () => {
  const { store, local, network } = setup();
  network.version = 1;
  network.items = [item('remote')];
  await store.saveInspiration(item('local'));
  local.failWrites = 1;
  const result = await store.resolveUseRemote();
  assert.equal(result.code, 'LOCAL_WRITE_FAILED');
  assert.equal(store.getBackupStatus().state, 'CONFLICT');
  assert.equal(store.readQueue().length, 1);
  assert.equal(store.getInspiration('local').text, '做一个记账小程序');
  assert.equal(store.getRecoveries().length, 0);
});

test('没有冲突时不得用恢复动作覆盖当前记录', async () => {
  const { store, network } = setup();
  const before = network.calls.length;
  const result = await store.resolveUseRemote();
  assert.equal(result.code, 'NO_CONFLICT');
  assert.equal(network.calls.length, before);
});

test('含照片的本机冲突不会切换为仅可复制文字的恢复副本', async () => {
  const photoItem = Object.assign({}, item('photo'), { photos: [{ id: 'p', fileId: 'cloud://photo' }] });
  const { store, network } = setup();
  network.version = 1;
  network.items = [item('remote')];
  await store.saveInspiration(photoItem);
  const result = await store.resolveUseRemote();
  assert.equal(result.code, 'PHOTO_RECOVERY_UNAVAILABLE');
  assert.equal(store.getInspiration('photo').id, 'photo');
  assert.equal(store.readQueue().length, 1);
  assert.equal(store.getRecoveries().length, 0);
});

test('代际落后时保留本机内容并停止重试', async () => {
  const { store, network } = setup();
  network.failure = 'STALE_GENERATION';
  await store.saveInspiration(item());
  assert.equal(store.getBackupStatus().state, 'STALE_GENERATION');
  assert.equal(store.readQueue().length, 1);
  assert.equal(store.listInspirations().length, 1);
});

test('删除使用独立动作，未确认前记录仍可见', async () => {
  const { store, network } = setup();
  await store.saveInspiration(item());
  network.failure = 'NETWORK';
  const pending = await store.deleteInspiration('insp_a');
  assert.equal(pending.synced, false);
  assert.equal(store.listInspirations().length, 1);
  assert.equal(network.calls[1].action, 'inspiration.delete');
  network.failure = null;
  await store.retryPending();
  assert.equal(store.listInspirations().length, 0);
});

test('照片删除被拒绝时不假报完成，不隐藏本机记录', async () => {
  const { store, network } = setup();
  await store.saveInspiration(item());
  network.failure = 'PHOTO_DELETE_UNAVAILABLE';
  const result = await store.deleteInspiration('insp_a');
  assert.equal(result.synced, false);
  assert.equal(result.code, 'PHOTO_DELETE_UNAVAILABLE');
  assert.equal(store.listInspirations().length, 1);
});

test('本机已知含照片时不入删除队列，保留原记录', async () => {
  const photoItem = Object.assign({}, item(), { photos: [{ id: 'photo_a', fileId: 'cloud://file' }] });
  const { store, network } = setup({ remote: remote(A, [photoItem], 1) });
  network.version = 1;
  const result = await store.deleteInspiration(photoItem.id);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PHOTO_DELETE_UNAVAILABLE');
  assert.equal(store.readQueue().length, 0);
  assert.equal(store.getInspiration(photoItem.id).text, photoItem.text);
});

test('列表按更新时间排序，已合并与已删除的默认隐藏', () => {
  const hidden = Object.assign({}, item('hidden'), { deletedAt: NOW + 1 });
  const visible = item('visible');
  const { store } = setup({ remote: remote(A, [hidden, visible], 2) });
  assert.deepEqual(store.listInspirations().map((entry) => entry.id), ['visible']);
});
