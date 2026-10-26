'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const todo = require('../miniprogram/core/todo');
const { createCloudOnlyStore } = require('../miniprogram/services/cloud-only-store');
const { prepareTodoOperation, runTodoOperation } = require('../miniprogram/services/todos');
const { createRepository } = require('../server/repository');

const scope = 'a'.repeat(32);
const original = () => core.appendSupplement(core.createInspiration({ id: 'idea', text: '做一次城市漫步', now: 10 }),
  { id: 'route', content: '提前查路线', now: 20 });
function fixture(items = [original()]) {
  let doc = { accountKey: scope, generation: 1, version: 1, inspirations: structuredClone(items), photoCleanup: [] };
  const requests = [];
  const db = { get: async () => structuredClone(doc), compareAndSwap: async (_scope, version, next) => {
    if (version !== doc.version) return false; doc = structuredClone(next); return true;
  } };
  const repository = createRepository({ db, now: () => 100 });
  const transport = { send: async (action, payload, options) => {
    requests.push({ action, payload: structuredClone(payload), options: structuredClone(options) });
    return action === 'snapshot.pull' ? repository.pull(scope) : repository.push(scope, payload);
  } };
  const store = async (options = {}) => createCloudOnlyStore({ cacheScope: scope,
    remoteSnapshot: (await repository.pull(scope)).data, transport, ...options });
  const push = (items, version = doc.version) => repository.push(scope, { baseVersion: version, generation: doc.generation, upserts: items });
  return { repository, transport, requests, store, push, read: () => structuredClone(doc), set: (patch) => { doc = { ...doc, ...structuredClone(patch) }; } };
}

test('待办保存：云确认后变更独立状态，完成撤销保留日期与内容时间', async () => {
  const f = fixture(), store = await f.store();
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', dueDate: '2026-10-21', now: 30 });
  assert.equal(store.getInspiration('idea').todo, null);
  assert.deepEqual(await runTodoOperation(op), { ok: true, synced: true });
  const complete = prepareTodoOperation(store, { inspirationId: 'idea', action: 'complete', now: 40 });
  await runTodoOperation(complete);
  assert.equal(store.getInspiration('idea').todo.completedAt, 40);
  await runTodoOperation(prepareTodoOperation(store, { inspirationId: 'idea', action: 'replace', todo: complete.beforeTodo }));
  assert.deepEqual(store.getInspiration('idea').todo, todo.makeTodo(30, '2026-10-21'));
  assert.equal(store.getInspiration('idea').updatedAt, 20);
  assert.equal(store.getInspiration('idea').supplements[0].todo, null);
});

test('待办兼容：省略正文及按ID补充字段继承，显式空值才清除', async () => {
  let item = todo.updateTodo(original(), { action: 'add', now: 30, dueDate: '2026-10-21' });
  item = todo.updateTodo(item, { supplementId: 'route', action: 'add', now: 31, dueDate: '2026-10-22' });
  const f = fixture([item]);
  const legacy = structuredClone(item); delete legacy.todo; delete legacy.supplements[0].todo;
  assert.equal((await f.push([legacy])).ok, true);
  assert.deepEqual(f.read().inspirations[0], item);
  const partial = structuredClone(item); delete partial.todo.dueDate; delete partial.supplements[0].todo.dueDate;
  assert.equal((await f.push([partial])).ok, true);
  assert.deepEqual(f.read().inspirations[0], item);
  const store = await f.store();
  assert.deepEqual(await store.saveInspiration(legacy), { ok: true, synced: true });
  assert.deepEqual(store.getInspiration('idea'), item);
  const changed = { ...legacy, todo: null, supplements: [{ ...legacy.supplements[0], todo: null }] };
  assert.equal((await store.saveInspiration(changed)).ok, true);
  assert.equal(store.getInspiration('idea').todo, null);
  assert.equal(store.getInspiration('idea').supplements[0].todo, null);
});

test('待办归档：允许含未办直接归档且服务端冻结事项，恢复后可办', async () => {
  const item = todo.updateTodo(original(), { action: 'add', now: 30 }), f = fixture([item]);
  const archived = core.markArchived(item, { now: 40 });
  assert.equal((await f.push([archived])).ok, true);
  for (const meta of [null, { ...item.todo, completedAt: 50 }, { ...item.todo, dueDate: '2026-10-22' }]) {
    assert.equal((await f.push([{ ...archived, todo: meta }])).code, 'INSPIRATION_ARCHIVED');
  }
  const store = await f.store();
  assert.equal(todo.boardView(store.readSnapshot().inspirations).counts.pending, 1);
  assert.throws(() => prepareTodoOperation(store, { inspirationId: 'idea', action: 'complete' }), { code: 'INSPIRATION_ARCHIVED' });
  assert.equal((await runTodoOperation(prepareTodoOperation(store, { inspirationId: 'idea', action: 'unarchive' }))).ok, true);
  assert.equal((await runTodoOperation(prepareTodoOperation(store, { inspirationId: 'idea', action: 'complete', now: 50 }))).ok, true);
});

test('待办未知：丢失成功回执先回读确认，重复点击只发送一次', async () => {
  const f = fixture(); let release;
  const store = await f.store({ transport: { send: async (action, payload, options) => {
    if (action === 'snapshot.push') {
      await new Promise((resolve) => { release = resolve; });
      await f.transport.send(action, payload, options); throw Error('lost receipt');
    }
    return f.transport.send(action, payload, options);
  } } });
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', now: 30 });
  const first = runTodoOperation(op), duplicate = runTodoOperation(op);
  assert.equal(first, duplicate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getInspiration('idea').todo, null);
  release(); assert.equal((await first).ok, true);
  assert.equal(f.requests.filter((row) => row.action === 'snapshot.push').length, 1);
  assert.equal(store.getInspiration('idea').todo.createdAt, 30);
});

test('待办未知：未写入重试固定目标时间版本和请求ID', async () => {
  const f = fixture(); let fail = true, pullFail = true;
  const sent = [];
  const store = await f.store({ transport: { send: async (action, payload, options) => {
    if (action === 'snapshot.push') { sent.push(structuredClone({ payload, options })); if (fail) throw Error('offline'); }
    if (action === 'snapshot.pull' && pullFail) throw Error('offline');
    return f.transport.send(action, payload, options);
  } } });
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', now: 30 });
  assert.equal((await runTodoOperation(op)).ok, false);
  assert.equal(store.getInspiration('idea').todo, null);
  fail = false; pullFail = false;
  assert.equal((await runTodoOperation(op)).ok, true);
  assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
  assert.equal(store.getInspiration('idea').todo.createdAt, 30);
});

test('待办冲突：未知后其他设备更新不得新版本重放旧整条记录', async () => {
  const f = fixture(); let fail = true;
  const store = await f.store({ transport: { send: async (action, payload, options) => {
    if (action === 'snapshot.push' && fail) throw Error('offline');
    return f.transport.send(action, payload, options);
  } } });
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', now: 30 });
  assert.equal((await runTodoOperation(op)).ok, false);
  const fresh = core.appendSupplement(f.read().inspirations[0], { id: 'newstep', content: '另一台设备新增', now: 40 });
  assert.equal((await f.push([fresh])).ok, true); fail = false;
  assert.equal((await runTodoOperation(op)).code, 'CONFLICT');
  assert.equal(store.getInspiration('idea').supplements.length, 2);
  assert.equal(store.getInspiration('idea').todo, null);
  assert.equal(f.requests.filter((row) => row.action === 'snapshot.push').length, 0);
});

test('待办冲突：prepare后排队版本变化直接拒绝且不发送', async () => {
  const f = fixture(), store = await f.store();
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', now: 30 });
  const current = core.appendSupplement(original(), { id: 'newstep', content: '新步骤', now: 40 });
  assert.equal((await store.saveInspiration(current)).ok, true);
  const before = f.requests.length;
  assert.equal((await runTodoOperation(op)).code, 'CONFLICT');
  assert.equal(f.requests.length, before);
  assert.equal(store.getInspiration('idea').supplements.length, 2);
});

test('待办隔离：旧代际相同目标不确认，账户失效迟到回执不落内存', async () => {
  const f = fixture(); let fail = true;
  const store = await f.store({ transport: { send: async (action, payload, options) => {
    if (action === 'snapshot.push' && fail) throw Error('offline');
    return f.transport.send(action, payload, options);
  } } });
  const op = prepareTodoOperation(store, { inspirationId: 'idea', action: 'add', now: 30 });
  await runTodoOperation(op);
  f.set({ generation: 2, inspirations: [op.target] }); fail = false;
  assert.equal((await runTodoOperation(op)).code, 'STALE_GENERATION');
  let active = true, release;
  const other = fixture(), oldStore = await other.store({ isCurrent: () => active,
    transport: { send: () => new Promise((resolve) => { release = resolve; }) } });
  const pending = runTodoOperation(prepareTodoOperation(oldStore, { inspirationId: 'idea', action: 'add', now: 30 }));
  await new Promise((resolve) => setImmediate(resolve)); active = false;
  release({ ok: true, data: { version: 2 } });
  assert.equal((await pending).code, 'ACCOUNT_SESSION_CHANGED');
  assert.equal(oldStore.getInspiration('idea').todo, null);
});
