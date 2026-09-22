'use strict';
// 本机状态与持久化的单元测试。
//
// 这些用例覆盖的是**降级路径**——离线、配额耗尽、同步失败。能在这里测，
// 是因为 store 不直接依赖 wx：存储与网络都从外面注入。真机测不了的路径，
// 靠这一层保证。
//
// 对应用 openspec/changes/add-inspiration-mvp/specs/inspiration-capture/spec.md
// 的「记录与补充的持久化」一节，以及 tasks.md 2.1—2.3。

const test = require('node:test');
const assert = require('node:assert');

const { createStore, STORAGE_KEYS } = require('../miniprogram/services/store');
const inspiration = require('../miniprogram/core/inspiration');
const { ERROR_CODES } = require('../miniprogram/core/errors');

const NOW = 1758500000000;

// ---------------------------------------------------------------- 测试替身

/** 内存版键值存储。可以按次数注入写入失败（配额耗尽）。 */
function createFakeStorage() {
  const data = new Map();
  return {
    data,
    failWrites: 0,
    get(key) {
      return data.has(key) ? JSON.parse(data.get(key)) : undefined;
    },
    set(key, value) {
      if (this.failWrites > 0) {
        this.failWrites -= 1;
        const err = new Error('exceed storage max size');
        err.code = 'QUOTA_EXCEEDED';
        throw err;
      }
      data.set(key, JSON.stringify(value));
    },
    remove(key) {
      data.delete(key);
    }
  };
}

/** 假传输层。可以指定下一次调用返回什么错误码，用来测降级。 */
function createFakeTransport() {
  return {
    calls: [],
    failWith: null,
    async send(action, payload, meta) {
      this.calls.push({ action, payload, requestId: meta && meta.requestId });
      if (this.failWith) {
        return { ok: false, code: this.failWith, message: '注入的失败' };
      }
      return { ok: true, data: { version: this.calls.length } };
    }
  };
}

function newStore(overrides) {
  const storage = createFakeStorage();
  const transport = createFakeTransport();
  const store = createStore(Object.assign({
    storage, transport, now: () => NOW
  }, overrides || {}));
  return { store, storage, transport };
}

function anInspiration(overrides) {
  return inspiration.createInspiration(Object.assign({
    text: '做一个记账小程序', id: 'insp_lz9k_4f2a', now: NOW
  }, overrides || {}));
}

// ---------------------------------------------------------------- 2.1 快照

test('读一个空账户拿到初始快照，不是 undefined', () => {
  const { store } = newStore();
  const snapshot = store.readSnapshot();

  assert.deepStrictEqual(snapshot.inspirations, []);
  assert.strictEqual(snapshot.version, 0);
  assert.strictEqual(typeof snapshot.generation, 'number');
});

test('写进去的快照能原样读出来', () => {
  const { store } = newStore();
  const insp = anInspiration();

  store.writeSnapshot(Object.assign(store.readSnapshot(), { inspirations: [insp] }));
  const back = store.readSnapshot();

  assert.strictEqual(back.inspirations.length, 1);
  assert.strictEqual(back.inspirations[0].text, '做一个记账小程序');
  assert.deepStrictEqual(back.inspirations[0], insp, '存回来的对象应与写进去的一致');
});

test('快照损坏时退回初始快照，而不是让整个应用读崩', () => {
  const { store, storage } = newStore();
  storage.data.set(STORAGE_KEYS.snapshot, '{ 这不是合法 JSON');

  assert.deepStrictEqual(store.readSnapshot().inspirations, []);
});

// ---------------------------------------------------------------- 2.1 待同步队列

test('同一 id 重复入队只产生一次效果', () => {
  const { store } = newStore();

  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: { id: 'insp_a' } });
  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: { id: 'insp_a' } });
  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: { id: 'insp_a' } });

  assert.strictEqual(store.readQueue().length, 1, '同一个 id 入队三次变成三条了');
});

test('同一 id 重复入队时以最后一次的内容为准', () => {
  const { store } = newStore();

  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: { text: '第一版' } });
  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: { text: '第二版' } });

  const queue = store.readQueue();
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].payload.text, '第二版', '重试应覆盖同一条，而不是留下旧内容');
});

test('不同 id 各自入队，按入队顺序排列', () => {
  const { store } = newStore();

  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: {} });
  store.enqueue({ id: 'op_2', kind: 'inspiration.upsert', payload: {} });
  store.enqueue({ id: 'op_3', kind: 'inspiration.upsert', payload: {} });

  assert.deepStrictEqual(store.readQueue().map((op) => op.id), ['op_1', 'op_2', 'op_3']);
});

test('入队时记录入队时间，由注入的 now 提供', () => {
  const { store } = newStore();

  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: {} });

  assert.strictEqual(store.readQueue()[0].enqueuedAt, NOW);
});

test('出队按 id 移除，队列为空时读回空数组', () => {
  const { store } = newStore();
  store.enqueue({ id: 'op_1', kind: 'inspiration.upsert', payload: {} });
  store.enqueue({ id: 'op_2', kind: 'inspiration.upsert', payload: {} });

  store.dequeue('op_1');
  assert.deepStrictEqual(store.readQueue().map((op) => op.id), ['op_2']);

  store.clearQueue();
  assert.deepStrictEqual(store.readQueue(), []);
});

// ---------------------------------------------------------------- 2.3 保存的三条路径

test('保存成功：本机写入，云端确认', async () => {
  const { store, transport } = newStore();
  const result = await store.saveInspiration(anInspiration());

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.synced, true);
  assert.strictEqual(store.readSnapshot().inspirations.length, 1, '本机快照里应有这条灵感');
  assert.strictEqual(store.readQueue().length, 0, '同步成功后队列应为空');
  assert.strictEqual(transport.calls.length, 1);
});

test('同步未成功：内容已落本机，进队列等重试', async () => {
  const { store, transport } = newStore();
  transport.failWith = 'INTERNAL';
  const result = await store.saveInspiration(anInspiration());

  assert.strictEqual(result.ok, true, '本机写成功就不该报失败——内容确实已经存下来了');
  assert.strictEqual(result.synced, false);
  assert.strictEqual(result.code, 'INTERNAL');
  assert.strictEqual(store.readSnapshot().inspirations.length, 1, '本机快照里应有这条灵感');
  assert.strictEqual(store.readQueue().length, 1, '同步失败的内容应进队列，等待自动重试');
});

test('本机写入失败：报告失败，且不改动已有的数据', async () => {
  const { store, storage } = newStore();

  storage.failWrites = 1;   // 下一次写入抛配额异常
  const result = await store.saveInspiration(anInspiration());

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'LOCAL_WRITE_FAILED');
  assert.deepStrictEqual(store.readSnapshot().inspirations, [], '写入失败时不该留下半条数据');
});

test('本机写入失败时不去调用云端', async () => {
  const { store, storage, transport } = newStore();
  storage.failWrites = 1;

  await store.saveInspiration(anInspiration());

  assert.strictEqual(transport.calls.length, 0, '本机都没存下来，不该去打扰云端');
});

test('同一 id 重复保存只产生一条灵感', async () => {
  const { store } = newStore();
  const insp = anInspiration();

  await store.saveInspiration(insp);
  await store.saveInspiration(insp);
  await store.saveInspiration(insp);

  assert.strictEqual(store.readSnapshot().inspirations.length, 1, '重试产生了重复的灵感');
});

test('保存同一条的更新版本，是替换而不是新增', async () => {
  const { store } = newStore();
  const first = anInspiration();
  await store.saveInspiration(first);

  const edited = inspiration.appendSupplement(first, { content: '补一句', id: 'sup_1', now: NOW + 1000 });
  await store.saveInspiration(edited);

  const list = store.readSnapshot().inspirations;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].supplements.length, 1);
});

test('保存失败后队列里不会留下重复条目', async () => {
  const { store, transport } = newStore();
  transport.failWith = 'INTERNAL';
  const insp = anInspiration();

  await store.saveInspiration(insp);
  await store.saveInspiration(insp);

  assert.strictEqual(store.readQueue().length, 1, '同一条灵感重试两次，队列里应只有一条待同步');
});

test('队列项带着 requestId，发起同步时用的是同一个', async () => {
  const { store, transport } = newStore();
  transport.failWith = 'INTERNAL';

  await store.saveInspiration(anInspiration());

  const queued = store.readQueue()[0];
  assert.ok(queued.requestId, '队列项应带着 requestId——重试时要复用它，传输层幂等才成立');
  assert.strictEqual(
    transport.calls[0].requestId,
    queued.requestId,
    '发起同步时用的 requestId 应与入队时定下的一致'
  );
});

// ---------------------------------------------------------------- 读取

test('列表按更新时间倒序，已合并与已删除的默认不出现', async () => {
  const { store } = newStore();
  const a = anInspiration({ id: 'insp_a', now: NOW });
  const b = anInspiration({ id: 'insp_b', now: NOW + 1000 });
  const c = anInspiration({ id: 'insp_c', now: NOW + 2000 });

  await store.saveInspiration(a);
  await store.saveInspiration(b);
  await store.saveInspiration(c);
  await store.saveInspiration(inspiration.markDeleted(c, { now: NOW + 3000 }));
  await store.saveInspiration(inspiration.markMerged(b, { targetId: 'insp_a', now: NOW + 4000 }));

  assert.deepStrictEqual(store.listInspirations().map((i) => i.id), ['insp_a']);
});

test('按 id 取一条，取不到返回 null', async () => {
  const { store } = newStore();
  await store.saveInspiration(anInspiration());

  assert.strictEqual(store.getInspiration('insp_lz9k_4f2a').text, '做一个记账小程序');
  assert.strictEqual(store.getInspiration('insp_nope'), null);
});

// ---------------------------------------------------------------- 删除

test('删除：云端确认后从本机物理移除', async () => {
  const { store } = newStore();
  await store.saveInspiration(anInspiration());

  const result = await store.deleteInspiration('insp_lz9k_4f2a');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.synced, true);
  assert.strictEqual(store.readSnapshot().inspirations.length, 0, '确认后应物理移除，不留软删残骸');
});

test('删除同步未成功时保留软删标记，不直接抹掉', async () => {
  const { store, transport } = newStore();
  await store.saveInspiration(anInspiration());
  transport.failWith = 'INTERNAL';

  const result = await store.deleteInspiration('insp_lz9k_4f2a');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.synced, false);
  const kept = store.readSnapshot().inspirations;
  assert.strictEqual(kept.length, 1, '没得到确认就不该物理移除——否则本机删了、云端还在');
  assert.ok(kept[0].deletedAt, '应留下软删标记');
  assert.deepStrictEqual(store.listInspirations(), [], '软删的条目不该出现在列表里');
});

test('删除不存在的灵感返回 NOT_FOUND', async () => {
  const { store } = newStore();
  const result = await store.deleteInspiration('insp_nope');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'NOT_FOUND');
});
