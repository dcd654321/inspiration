'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOperationsMonitor } = require('../miniprogram/services/operations-monitor');
const { createCommittedMonitor } = require('../server/operations-monitor');
const { createRepository } = require('../server/repository');
const { createProtocol } = require('../server/protocol');
const { createInspiration, appendSupplement } = require('../miniprogram/core/inspiration');
const { createWxTransport } = require('../miniprogram/services/wx-transport');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const A = 'a'.repeat(32), B = 'b'.repeat(32), USER = 'user_' + 'c'.repeat(24);

function fixture(options = {}) {
  let at = 1000, seq = 0, timer;
  const calls = [];
  const monitor = createOperationsMonitor({ now: () => at, newId: () => 'session_' + (++seq),
    envVersion: 'release', getRoute: () => 'pages/output/index',
    setInterval: (fn, ms) => { assert.equal(ms, 60000); timer = fn; return 1; }, clearInterval: () => { timer = null; },
    getClient: async () => ({ callFunction: async (input) => { calls.push(structuredClone(input)); return { result: { success: true } }; } }), ...options });
  return { monitor, calls, time: (value) => { at = value; }, beat: () => timer && timer() };
}

test('运营会话：前台开始心跳隐藏结束，不累计后台时间', async () => {
  const f = fixture();
  f.monitor.start(); await tick(); assert.equal(f.calls.length, 0);
  f.time(11000); f.monitor.bindAccount(A, 1); await tick();
  f.time(61000); f.beat(); await tick();
  f.time(66000); await f.monitor.end();
  const usage = f.calls.filter((x) => x.data.action === 'trackUsage').map((x) => x.data);
  assert.deepEqual(usage.map((x) => [x.eventType, x.elapsedMs]), [['start', 0], ['heartbeat', 50000], ['end', 55000]]);
  assert.equal(f.calls.find((x) => x.data.type === 'app_start').data.eventId, 'session_1:start');
  f.time(1000000); f.beat(); await tick(); assert.equal(f.calls.length, 4);
  f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
  assert.equal(f.calls[4].data.elapsedMs, 0); assert.equal(f.calls[4].data.sessionId, 'session_2');
  await f.monitor.end();
});

test('运营会话：账户失效阻止迟到发送，每请求最多一次内存重试', async () => {
  let active = true, attempts = 0; const retried = [];
  const f = fixture({ getClient: async () => ({ callFunction: async (input) => { attempts += 1; retried.push(structuredClone(input.data)); throw Error('含用户文字的网络错误'); } }) });
  f.monitor.start(); f.monitor.bindAccount(A, 1, () => active); await tick();
  assert.equal(attempts, 4, 'start 与 app_start 各最多两次');
  assert.ok(retried.every((data) => data.accountGeneration === 1));
  const startRequests = retried.filter((data) => data.action === 'trackUsage');
  assert.deepEqual(startRequests[0], startRequests[1], '重试完整复用绑定时的代际和累计值');
  attempts = 0; await f.monitor.event('output_copied'); assert.equal(attempts, 2);
  active = false; await f.monitor.event('output_copied'); assert.equal(attempts, 2);
  await f.monitor.end();
  const releases = [], delayedCalls = [];
  const delayed = fixture({ getClient: () => new Promise((resolve) => { releases.push(resolve); }) });
  delayed.monitor.start(); delayed.monitor.bindAccount(A, 1); await tick();
  delayed.monitor.start();
  for (const release of releases) release({ callFunction: async (input) => { delayedCalls.push(input); return { result: { success: true } }; } });
  await tick(); await delayed.monitor.end();
  assert.equal(delayedCalls.length, 0);
  const changed = fixture(); changed.monitor.start(); changed.monitor.bindAccount(A, 1); await tick();
  changed.monitor.bindAccount(B, 1); await tick();
  assert.equal(changed.calls.at(-1).data.payload.sessionId, 'session_2');
  changed.monitor.bindAccount(B, 2); await tick();
  assert.equal(changed.calls.at(-1).data.accountGeneration, 2);
  assert.equal(changed.calls.at(-1).data.payload.sessionId, 'session_3');
  await changed.monitor.end();
});

test('运营事件：白名单丢弃个人内容，耗时不递归且回调不影响请求', async () => {
  const f = fixture(); f.monitor.start();
  f.monitor.requestFinished('linggan_api', 12); await tick(); assert.equal(f.calls.length, 0);
  f.monitor.bindAccount(A, 1); await tick();
  assert.equal(f.calls.at(-1).data.type, 'performance'); assert.equal(f.calls.at(-1).data.payload.durationMs, 12);
  await f.monitor.event('error', { text: '私人正文', photoPath: '/private', errorMessage: '私人错误', code: 'bad private error', durationMs: 4.8, route: 'pages/output/index?text=private' });
  const last = f.calls.at(-1).data;
  assert.deepEqual(last.payload, { sessionId: 'session_1', envVersion: 'release', code: 'UNKNOWN', durationMs: 4 });
  assert.ok(!JSON.stringify(last).includes('private'));
  const count = f.calls.length; f.monitor.requestFinished('monitorApi', 1, 'INTERNAL'); await tick(); assert.equal(f.calls.length, count);
  f.monitor.requestFinished('linggan_api', 30, 'CONFLICT'); await tick();
  assert.deepEqual(f.calls.slice(-2).map((x) => x.data.type), ['performance', 'error']);
  const transport = createWxTransport({ functionName: 'linggan_api', callFunction: async () => ({ result: { ok: true, data: {} } }), onRequestFinished() { throw Error('监控失败'); } });
  assert.equal((await transport.send('snapshot.pull', {})).ok, true);
  const malformed = [];
  const broken = createWxTransport({ functionName: 'linggan_api', callFunction: async () => ({ result: {} }), onRequestFinished: (...args) => malformed.push(args) });
  assert.equal((await broken.send('snapshot.pull', {})).ok, false);
  assert.equal(malformed[0][2], 'INTERNAL');
  await f.monitor.end();
});

function repositoryFixture(onCommitted, onMonitorFailure) {
  let document = null, fail = false;
  const repo = createRepository({ now: () => 1700000000000,
    db: { get: async () => document && structuredClone(document), compareAndSwap: async (_key, version, next) => {
      if (fail || (document && document.version !== version)) return false;
      document = structuredClone(next); return true;
    } }, onCommitted, onMonitorFailure });
  return { repo, fail: () => { fail = true; }, read: () => document };
}

function eventDatabase(readAccount, events = new Map(), failWrites = false) {
  const read = () => { const doc = readAccount(); return doc ? { _id: 'account_doc', ...doc } : null; };
  function collection(name) {
    if (name === 'linggan_accounts') return {
      where: () => ({ limit: () => ({ get: async () => ({ data: read() ? [read()] : [] }) }) }),
      doc: () => ({ get: async () => ({ data: read() }), update: async ({ data }) => {
        assert.deepEqual(data, { _monitorFence: { increment: 1 } });
      } })
    };
    assert.equal(name, 'monitor_events');
    return { async add({ data }) {
      if (failWrites) throw Error('私人错误');
      if (events.has(data._id)) { const error = Error('DUPLICATE'); error.code = 'DUPLICATE'; throw error; }
      events.set(data._id, structuredClone(data));
    } };
  }
  return { collection, command: { inc: (increment) => ({ increment }) }, runTransaction: async (work) => work({ collection }) };
}

// 按 CloudBase 官方快照隔离建模：只读不锁定，写集合的版本变化才冲突；
// 冲突事务的账户与事件写入全部回滚，SDK 重试会取得新快照。
function snapshotEventDatabase(account) {
  const accountId = 'account_doc', accountKey = 'linggan_accounts:' + accountId;
  const rows = new Map([[accountKey, structuredClone({ _id: accountId, ...account })]]), revisions = new Map([[accountKey, 1]]);
  let beforeFence, attempts = 0, conflicts = 0;
  const db = {
    command: { inc: (increment) => ({ increment }) }, rows,
    interleave: (action) => { beforeFence = action; },
    changeAccount: (patch) => { rows.set(accountKey, { ...rows.get(accountKey), ...patch }); revisions.set(accountKey, revisions.get(accountKey) + 1); },
    stats: () => ({ attempts, conflicts }),
    collection(name) {
      assert.equal(name, 'linggan_accounts');
      return { where: () => ({ limit: () => ({ get: async () => ({ data: [structuredClone(rows.get(accountKey))] }) }) }) };
    },
    async runTransaction(work) {
      for (let attempt = 0; attempt < 3; attempt++) {
        attempts += 1;
        const snapshot = new Map([...rows].map(([key, data]) => [key, structuredClone(data)]));
        const snapshotRevisions = new Map(revisions), writes = new Map();
        const transaction = { collection(name) {
          return {
            doc(id) { const key = name + ':' + id; return {
              get: async () => ({ data: structuredClone(snapshot.get(key)) }),
              async update({ data }) {
                assert.equal(key, accountKey); assert.deepEqual(data, { _monitorFence: { increment: 1 } });
                if (beforeFence) { const action = beforeFence; beforeFence = null; action(); }
                const original = snapshot.get(key);
                writes.set(key, { ...original, _monitorFence: (original._monitorFence || 0) + data._monitorFence.increment });
              }
            }; },
            async add({ data }) {
              assert.equal(name, 'monitor_events'); const key = name + ':' + data._id;
              if (snapshot.has(key)) { const error = Error('DUPLICATE'); error.code = 'DUPLICATE'; throw error; }
              writes.set(key, structuredClone(data));
            }
          };
        } };
        const result = await work(transaction);
        if ([...writes.keys()].some((key) => (revisions.get(key) || 0) !== (snapshotRevisions.get(key) || 0))) { conflicts += 1; continue; }
        for (const [key, data] of writes) { rows.set(key, data); revisions.set(key, (revisions.get(key) || 0) + 1); }
        return result;
      }
      const error = Error('DATABASE_TRANSACTION_CONFLICT'); error.code = 'DATABASE_TRANSACTION_CONFLICT'; throw error;
    }
  };
  return db;
}

test('运营提交：新记录补充与另存只计一次，编辑和重复保存不计', async () => {
  const events = new Map(); let time = 1700000000000, f;
  const committed = createCommittedMonitor({ now: () => time, db: eventDatabase(() => f.read(), events) });
  f = repositoryFixture(committed); const ctx = { sourceUserId: USER };
  const original = createInspiration({ id: 'ins_a', text: '私人灵感', now: 123 });
  assert.equal((await f.repo.push(A, { generation: 1, baseVersion: 0, upserts: [original] }, ctx)).ok, true);
  assert.deepEqual([...events.values()].map((x) => x.type), ['record_saved']);
  const first = [...events.values()][0];
  assert.equal(first._id, 'evt_' + crypto.createHash('sha256').update('linggan|' + USER + '|' + first.eventId).digest('hex'));
  assert.equal(first.occurredAt.getTime(), time); assert.deepEqual(first.payload, {});
  assert.ok(!JSON.stringify(first).includes('私人灵感'));
  await f.repo.push(A, { generation: 1, baseVersion: 1, upserts: [original] }, ctx);
  const changed = appendSupplement(original, { id: 'sup_a', content: '私人补充', now: 456 });
  await f.repo.push(A, { generation: 1, baseVersion: 1, upserts: [changed] }, ctx);
  assert.deepEqual([...events.values()].map((x) => x.type), ['record_saved', 'supplement_saved']);
  await f.repo.push(A, { generation: 1, baseVersion: 2, upserts: [{ ...changed, tags: ['私密'], updatedAt: 789 }] }, ctx);
  const output = { ...createInspiration({ id: 'ins_b', text: '私人稿件', now: 123 }), templateId: 'free' };
  await f.repo.push(A, { generation: 1, baseVersion: 3, upserts: [output] }, ctx);
  assert.deepEqual([...events.values()].map((x) => x.type), ['record_saved', 'supplement_saved', 'record_saved', 'output_saved']);
  time += 10000;
  await committed({ accountKey: A, sourceUserId: USER, before: { inspirations: [] }, after: { generation: 1, version: 1, inspirations: [original] } });
  assert.equal(events.size, 4); assert.equal(events.get(first._id).occurredAt.getTime(), 1700000000000);
});

test('运营提交：冲突失败不记事件，监控故障不改变保存确认', async () => {
  let calls = 0;
  const f = repositoryFixture(async () => { calls += 1; throw Error('监控异常和私人内容'); });
  const item = createInspiration({ id: 'ins_a', text: '正文', now: 123 });
  const result = await f.repo.push(A, { generation: 1, baseVersion: 0, upserts: [item] }, { sourceUserId: USER });
  assert.equal(result.ok, true); assert.equal(f.read().version, 1); assert.equal(calls, 1);
  assert.equal((await f.repo.push(A, { generation: 1, baseVersion: 0, upserts: [item] }, { sourceUserId: USER })).code, 'CONFLICT');
  f.fail(); await f.repo.push(A, { generation: 1, baseVersion: 1, upserts: [{ ...item, tags: ['标签'] }] }, { sourceUserId: USER });
  assert.equal(calls, 1);
  const codes = [], committed = createCommittedMonitor({ db: eventDatabase(() => ({ accountKey: A, generation: 1 }), new Map(), true), onFailure: (code) => codes.push(code) });
  await committed({ accountKey: A, sourceUserId: USER, before: { inspirations: [] }, after: { generation: 1, inspirations: [item] } });
  assert.deepEqual(codes, ['MONITOR_EVENT_WRITE_FAILED']);
  let source;
  const protocol = createProtocol({ now: Date.now, repository: { push: async (_key, _payload, context) => { source = context.sourceUserId; return { ok: true }; } } });
  await protocol.handle({ accountKey: A, sourceUserId: USER }, { action: 'snapshot.push', payload: { sourceUserId: 'client-forged' } });
  assert.equal(source, USER);
  const staleEvents = new Map();
  const stale = createCommittedMonitor({ db: eventDatabase(() => ({ accountKey: A, generation: 2 }), staleEvents) });
  await stale({ accountKey: A, sourceUserId: USER, before: { inspirations: [] }, after: { generation: 1, version: 1, inspirations: [item] } });
  assert.equal(staleEvents.size, 0, '事务回读拒绝旧代际的已提交回调');
});

test('运营提交：统计一直等待仍及时返回保存确认，迟到异常不改正文', async () => {
  let reject;
  const waiting = new Promise((_resolve, fail) => { reject = fail; }), codes = [];
  const f = repositoryFixture(() => waiting, (code) => codes.push(code));
  const item = createInspiration({ id: 'ins_a', text: '正常保存正文', now: 123 });
  const result = await Promise.race([f.repo.push(A, { generation: 1, baseVersion: 0, upserts: [item] }, { sourceUserId: USER }),
    new Promise((_resolve, fail) => { const timer = setTimeout(() => fail(Error('save blocked by monitor')), 1500); timer.unref(); })]);
  assert.equal(result.ok, true); assert.equal(result.data.version, 1);
  assert.deepEqual(codes, ['MONITOR_WRITE_TIMEOUT']); assert.deepEqual(f.read().inspirations, [item]);
  reject(Error('late private failure')); await tick(); assert.deepEqual(codes, ['MONITOR_WRITE_TIMEOUT']);
  assert.equal((await f.repo.pull(A)).data.inspirations[0].text, '正常保存正文');
});

test('运营会话：慢启动先确认再串行发送，保留成功请求发起时的累计起点', async () => {
  let resolveStart;
  const start = new Promise((resolve) => { resolveStart = resolve; }), calls = [];
  const f = fixture({ getClient: async () => ({ callFunction: async ({ data }) => {
    calls.push(structuredClone(data));
    if (data.action === 'trackUsage' && data.eventType === 'start') await start;
    return { result: { ok: true } };
  } }) });
  f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
  f.time(61000); f.beat(); await tick();
  assert.deepEqual(calls.filter(data => data.action === 'trackUsage').map(data => data.eventType), ['start']);
  resolveStart(); await tick();
  f.time(63000); await f.monitor.end();
  assert.deepEqual(calls.filter(data => data.action === 'trackUsage').map(data => [data.eventType, data.elapsedMs]), [['start', 0], ['heartbeat', 60000], ['end', 62000]]);
});

test('运营会话：首报两次失败后心跳与结束可复用同会话恢复', async () => {
  for (const recoverWith of ['heartbeat', 'end']) {
    let startAttempts = 0; const calls = [];
    const f = fixture({ getClient: async () => ({ callFunction: async ({ data }) => {
      calls.push(structuredClone(data));
      if (data.action === 'trackUsage' && data.eventType === 'start' && ++startAttempts <= 2) throw Error('NETWORK');
      return { result: { ok: true } };
    } }) });
    f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
    assert.equal(startAttempts, 2);
    f.time(61000);
    if (recoverWith === 'heartbeat') {
      f.beat(); await tick();
      f.time(121000); f.beat(); await tick();
      f.time(122000); await f.monitor.end();
    } else await f.monitor.end();
    const usage = calls.filter((data) => data.action === 'trackUsage');
    assert.equal(startAttempts, 3, recoverWith);
    assert.equal(new Set(usage.map((data) => data.sessionId)).size, 1, recoverWith);
    assert.ok(usage.every((data) => data.accountGeneration === 1), recoverWith);
    assert.deepEqual(usage.slice(3).map((data) => [data.eventType, data.elapsedMs]), recoverWith === 'heartbeat'
      ? [['heartbeat', 0], ['heartbeat', 60000], ['end', 61000]] : [['end', 0]], recoverWith);
  }
});

test('运营会话：启动回执丢失后的重复成功使用首次服务端起点', async () => {
  let attempts = 0, f; const calls = [];
  f = fixture({ getClient: async () => ({ callFunction: async ({ data }) => {
    calls.push(structuredClone(data));
    if (data.action === 'trackUsage' && data.eventType === 'start') {
      attempts += 1;
      if (attempts === 1) { f.time(11000); throw Error('ACK_LOST'); }
      return { result: { ok: true, data: { startedAtMs: 1000, observedAtMs: 11000, elapsedMs: 0 } } };
    }
    return { result: { ok: true } };
  } }) });
  f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
  f.time(61000); f.beat(); await tick();
  f.time(66000); await f.monitor.end();
  const usage = calls.filter((data) => data.action === 'trackUsage');
  assert.deepEqual(usage.map((data) => [data.eventType, data.elapsedMs]), [['start', 0], ['start', 0], ['heartbeat', 60000], ['end', 65000]]);
  assert.equal(new Set(usage.map((data) => data.sessionId)).size, 1);
});

test('运营会话：跨午夜慢回执与本机时差保持服务端累计起点', async () => {
  const serverStart = Date.parse('2026-10-12T23:59:50+08:00'), offset = 9 * 3600000;
  let resolveStart; const waiting = new Promise((resolve) => { resolveStart = resolve; }), calls = [];
  const f = fixture({ getClient: async () => ({ callFunction: async ({ data }) => {
    calls.push(structuredClone(data));
    if (data.action === 'trackUsage' && data.eventType === 'start') {
      await waiting;
      return { result: { ok: true, data: { startedAtMs: serverStart, observedAtMs: serverStart, elapsedMs: 0 } } };
    }
    return { result: { ok: true } };
  } }) });
  f.time(serverStart + offset); f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
  f.time(serverStart + offset + 60000); f.beat(); await tick();
  assert.deepEqual(calls.filter((data) => data.action === 'trackUsage').map((data) => data.eventType), ['start']);
  f.time(serverStart + offset + 70000); resolveStart(); await tick();
  await f.monitor.end();
  const usage = calls.filter((data) => data.action === 'trackUsage');
  assert.deepEqual(usage.map((data) => [data.eventType, data.elapsedMs]), [['start', 0], ['heartbeat', 60000], ['end', 70000]]);
  assert.equal(new Date(serverStart + usage.at(-1).elapsedMs).toISOString(), '2026-10-12T16:01:00.000Z');
});

test('运营会话：后台才到达启动回执仅发送隐藏时冻结的累计值', async () => {
  let resolveStart, current = true;
  const waiting = new Promise((resolve) => { resolveStart = resolve; }), calls = [];
  const f = fixture({ getClient: async () => ({ callFunction: async ({ data }) => {
    calls.push(structuredClone(data));
    if (data.action === 'trackUsage' && data.eventType === 'start') {
      await waiting;
      return { result: { ok: true, data: { startedAtMs: 1000, observedAtMs: 1000, elapsedMs: 0 } } };
    }
    return { result: { ok: true } };
  } }) });
  f.monitor.start(); f.monitor.bindAccount(A, 1, () => current); await tick();
  f.time(6000); const ending = f.monitor.end(); current = false;
  f.time(3601000); resolveStart(); await ending;
  assert.deepEqual(calls.filter((data) => data.action === 'trackUsage').map((data) => [data.eventType, data.elapsedMs]), [['start', 0], ['end', 5000]]);
});

test('运营会话：共享客户端等待以实际发起时间起算，后台解除等待不计后台', async () => {
  for (const hidden of [false, true]) {
    let resolveClient;
    const waiting = new Promise((resolve) => { resolveClient = resolve; }), calls = [];
    const f = fixture({ getClient: () => waiting });
    f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
    let ending;
    if (hidden) { f.time(6000); ending = f.monitor.end(); }
    f.time(hidden ? 3601000 : 11000);
    resolveClient({ callFunction: async ({ data }) => { calls.push(structuredClone(data)); return { result: { ok: true } }; } });
    await tick();
    if (hidden) await ending;
    else { f.time(61000); f.beat(); await tick(); f.time(66000); await f.monitor.end(); }
    assert.deepEqual(calls.filter((data) => data.action === 'trackUsage').map((data) => [data.eventType, data.elapsedMs]), hidden
      ? [['start', 0], ['end', 0]] : [['start', 0], ['heartbeat', 50000], ['end', 55000]], String(hidden));
  }
});

test('运营会话：无效服务端时间回执兼容成功请求发起时刻', async () => {
  for (const data of [undefined, { startedAtMs: 2000, observedAtMs: 1000 },
    { startedAtMs: 1, observedAtMs: 36 * 3600000 + 2 }, { startedAtMs: 1.5, observedAtMs: 2000 },
    ...[undefined, -1, 0.5, '0', 36 * 3600000 + 1].map((elapsedMs) => ({ startedAtMs: 1, observedAtMs: 10001, elapsedMs }))]) {
    const calls = [];
    const f = fixture({ getClient: async () => ({ callFunction: async ({ data: request }) => {
      calls.push(structuredClone(request)); return { result: { ok: true, data } };
    } }) });
    f.monitor.start(); f.monitor.bindAccount(A, 1); await tick();
    f.time(61000); f.beat(); await tick(); await f.monitor.end();
    assert.equal(calls.find((request) => request.eventType === 'heartbeat').elapsedMs, 60000, JSON.stringify(data));
  }
});

test('运营提交：快照写冲突重试拒绝旧代际且保留业务内容', async () => {
  const original = createInspiration({ id: 'ins_a', text: '已保存正文', now: 123 });
  const account = { accountKey: A, generation: 1, version: 7, updatedAt: 456, inspirations: [original], photoCleanup: [] };
  const db = snapshotEventDatabase(account), failures = [];
  const committed = createCommittedMonitor({ db, now: () => 1000, onFailure: (code) => failures.push(code) });
  const input = { accountKey: A, sourceUserId: USER, before: { inspirations: [] }, after: account };
  db.interleave(() => db.changeAccount({ generation: 2 }));
  await committed(input);
  assert.deepEqual(db.stats(), { attempts: 2, conflicts: 1 });
  assert.equal([...db.rows.keys()].filter((key) => key.startsWith('monitor_events:')).length, 0);
  assert.deepEqual(db.rows.get('linggan_accounts:account_doc'), { _id: 'account_doc', ...account, generation: 2 }, '冲突全部回滚，不写 fence 或旧事件');
  assert.deepEqual(failures, []);

  const live = snapshotEventDatabase(account);
  live.interleave(() => live.changeAccount({ version: 8, updatedAt: 789 }));
  const writer = createCommittedMonitor({ db: live, now: () => 1000 });
  await writer(input);
  assert.deepEqual(live.stats(), { attempts: 2, conflicts: 1 });
  assert.deepEqual(live.rows.get('linggan_accounts:account_doc'), { _id: 'account_doc', ...account, version: 8, updatedAt: 789, _monitorFence: 1 });
  const events = [...live.rows].filter(([key]) => key.startsWith('monitor_events:'));
  assert.equal(events.length, 1); assert.equal(events[0][1].occurredAt.getTime(), 1000);
  await writer(input);
  assert.equal([...live.rows].filter(([key]) => key.startsWith('monitor_events:')).length, 1);
  assert.equal(live.rows.get('linggan_accounts:account_doc')._monitorFence, 1, '重复 add 回滚账户计数');
});

test('运营输出：实际页面只在复制和 TXT 生成成功后记事件', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition, clipboard, file, current = true;
  const events = [];
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => ({ globalData: {}, operationsMonitor: { event: (type) => { events.push(type); } } });
    global.wx = { env: { USER_DATA_PATH: '/private/path' }, setClipboardData: (value) => { clipboard = value; },
      getFileSystemManager: () => ({ writeFile: (value) => { file = value; }, unlink() {} }) };
    delete require.cache[pagePath]; require(pagePath);
    const page = { ...definition, current: () => current, data: { ...definition.data, draft: '私人稿件', archive: '私人留档' }, setData(next, done) { Object.assign(this.data, next); if (done) done(); } };
    page.onCopyDraft(); clipboard.fail(); assert.deepEqual(events, []);
    page.onCopyDraft(); clipboard.success(); assert.deepEqual(events, ['output_copied']);
    page.onCreateTxt(); file.fail(); assert.deepEqual(events, ['output_copied']);
    page.onCreateTxt(); file.success(); assert.deepEqual(events, ['output_copied', 'output_exported']);
    page.onCreateTxt(); current = false; file.success(); assert.equal(events.length, 2);
    assert.ok(!JSON.stringify(events).includes('私人'));
  } finally { delete require.cache[pagePath]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});

test('运营输出：复制稿件后继续编辑仍计成功，留档同文不计成品复制', () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition, clipboard;
  const events = [], metrics = [], store = {};
  const app = { globalData: { sessionEpoch: 1, store, metrics: { track: (type) => { metrics.push(type); } } },
    operationsMonitor: { event: (type) => { events.push(type); } } };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = { setClipboardData: (value) => { clipboard = value; } };
    delete require.cache[pagePath]; require(pagePath);
    const page = { ...definition, loadedEpoch: 1, loadedStore: store, loadVersion: 1, loading: false, disposed: false,
      data: { ...definition.data, draft: '原稿件', archive: '原稿件' },
      setData(next, done) { Object.assign(this.data, next); if (done) done(); } };
    page.onCopyDraft();
    assert.equal(page.data.busy, false, '复制不阻止继续编辑');
    page.onDraftInput({ detail: { value: '回调前编辑的新稿件' } });
    assert.equal(clipboard.data, '原稿件');
    assert.equal(page.data.draft, '回调前编辑的新稿件');
    clipboard.success();
    assert.match(page.data.notice, /已复制/);
    assert.deepEqual(events, ['output_copied']);
    assert.deepEqual(metrics, ['output_copied']);
    page.setData({ draft: '与留档相同的文字', archive: '与留档相同的文字' });
    page.onCopyArchive(); clipboard.success();
    assert.deepEqual(events, ['output_copied'], '留档复制依据调用类型排除，不以文字相等判断');
    assert.deepEqual(metrics, ['output_copied']);
  } finally { delete require.cache[pagePath]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});

test('运营输出：页面版本或账户失效后的复制成功不记事件与提示', () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition, clipboard;
  const events = [], metrics = [];
  const app = { globalData: { sessionEpoch: 1, store: null, metrics: { track: (type) => { metrics.push(type); } } },
    operationsMonitor: { event: (type) => { events.push(type); } } };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = { setClipboardData: (value) => { clipboard = value; } };
    delete require.cache[pagePath]; require(pagePath);
    for (const invalidation of ['pageVersion', 'sessionEpoch', 'store', 'disposed']) {
      const store = {}; app.globalData.store = store; app.globalData.sessionEpoch = 1;
      const page = { ...definition, loadedEpoch: 1, loadedStore: store, loadVersion: 1, loading: false, disposed: false,
        data: { ...definition.data, draft: '稿件', notice: '新会话提示' },
        setData(next, done) { Object.assign(this.data, next); if (done) done(); } };
      page.onCopyDraft();
      if (invalidation === 'pageVersion') page.loadVersion += 1;
      if (invalidation === 'sessionEpoch') app.globalData.sessionEpoch += 1;
      if (invalidation === 'store') app.globalData.store = {};
      if (invalidation === 'disposed') page.disposed = true;
      clipboard.success();
      assert.equal(page.data.notice, '新会话提示', invalidation);
      assert.deepEqual(events, [], invalidation); assert.deepEqual(metrics, [], invalidation);
    }
  } finally { delete require.cache[pagePath]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});

test('运营输出：统计同步抛错或异步拒绝不改变实际复制与TXT成功状态', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition, clipboard, file, asynchronous = false;
  try {
    global.Page = value => { definition = value; };
    global.getApp = () => ({ globalData: {}, operationsMonitor: { event() {
      if (asynchronous) return Promise.reject(Error('monitor unavailable'));
      throw Error('monitor unavailable');
    } } });
    global.wx = { env: { USER_DATA_PATH: '/private/path' }, setClipboardData: value => { clipboard = value; },
      getFileSystemManager: () => ({ writeFile: value => { file = value; } }) };
    delete require.cache[pagePath]; require(pagePath);
    for (asynchronous of [false, true]) {
      const page = { ...definition, current: () => true, data: { ...definition.data, draft: '可复制稿件', archive: '可留档正文' },
        setData(next, done) { Object.assign(this.data, next); if (done) done(); } };
      page.onCopyDraft(); assert.doesNotThrow(() => clipboard.success());
      assert.equal(page.data.error, ''); assert.match(page.data.notice, /已复制/);
      page.onCreateTxt(); assert.doesNotThrow(() => file.success());
      assert.equal(page.data.error, ''); assert.match(page.data.notice, /TXT 已生成/); assert.ok(page.data.txtPath);
      await tick();
    }
  } finally { delete require.cache[pagePath]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});
