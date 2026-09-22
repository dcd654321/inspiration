'use strict';
// 服务端协议与仓库层的单元测试。
// 对应 inspiration-capture/spec.md 的「账户数据隔离」「记录与补充的持久化」，
// photo-capture/spec.md 的「删除灵感后清理文件」「删除确认失败」「照片不可被他人访问」，
// 以及 tasks.md 6.1—6.4。
//
// 这些逻辑放在 `server/` 而不是 `cloudfunctions/` 里，就是为了能在 Node 里跑——
// 放进云函数目录的话，测试要先把 wx-server-sdk 整套桩起来，实际没人会那么干。

const test = require('node:test');
const assert = require('node:assert');

const { createRepository, CODE } = require('../server/repository');
const { createProtocol, PROTOCOL_CODE } = require('../server/protocol');

const NOW = 1758500000000;

/** 内存版数据库。读写都做深拷贝，模拟真实数据库的序列化边界——
 *  这样「服务端悄悄改了传入对象」这类 bug 会被暴露出来。 */
function createFakeDb() {
  const docs = new Map();
  return {
    docs,
    async get(key) {
      return docs.has(key) ? JSON.parse(JSON.stringify(docs.get(key))) : null;
    },
    async put(key, doc) {
      docs.set(key, JSON.parse(JSON.stringify(doc)));
    }
  };
}

function createFakeStorage(options) {
  const opts = options || {};
  return {
    removed: [],
    async removeFiles(fileIds) {
      if (opts.failRemoval) return { ok: false, removed: [], failed: fileIds };
      this.removed = this.removed.concat(fileIds);
      return { ok: true, removed: fileIds, failed: [] };
    }
  };
}

function setup(options) {
  const opts = options || {};
  const db = createFakeDb();
  const storage = createFakeStorage(opts);
  const repository = createRepository({
    db,
    removeFiles: (ids) => storage.removeFiles(ids),
    now: () => NOW
  });
  const requestCache = new Map();
  const protocol = createProtocol({
    repository,
    requestCache: {
      get: (k) => requestCache.get(k),
      set: (k, v) => requestCache.set(k, v)
    },
    now: () => NOW
  });
  return { db, storage, repository, protocol, requestCache };
}

const CONTEXT = { accountKey: 'acct_dcd' };

function anInspiration(overrides) {
  return Object.assign({
    id: 'insp_lz9k_4f2a',
    text: '做一个记账小程序',
    textHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
    supplements: [],
    photos: [],
    mergedInto: null,
    deletedAt: null
  }, overrides || {});
}

// ---------------------------------------------------------------- 6.1 身份

test('可信上下文缺失时拒绝，不创建也不修改任何数据', async () => {
  const { protocol, db } = setup();

  const result = await protocol.handle({}, { action: 'snapshot.pull' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, PROTOCOL_CODE.unauthenticated);
  assert.strictEqual(db.docs.size, 0);
});

test('请求体里出现身份字段即整请求拒绝', async () => {
  const { protocol, db } = setup();

  for (const field of ['accountKey', 'openid', '_openid', 'appid', 'unionid']) {
    const payload = { upserts: [anInspiration()] };
    payload[field] = 'acct_someone_else';

    const result = await protocol.handle(CONTEXT, { action: 'snapshot.push', payload });

    assert.strictEqual(result.ok, false, `带 ${field} 的请求应被拒绝`);
    assert.strictEqual(result.code, 'IDENTITY_FIELD_REJECTED');
  }
  assert.strictEqual(db.docs.size, 0, '被拒绝的请求不该写入任何数据');
});

test('来源未获准时拒绝', async () => {
  const { protocol } = setup();
  const result = await protocol.handle({ accountKey: 'acct_dcd', sourceAllowed: false }, { action: 'snapshot.pull' });

  assert.strictEqual(result.code, PROTOCOL_CODE.forbiddenSource);
});

test('两个账户各自读写自己的数据', async () => {
  const { protocol } = setup();

  await protocol.handle({ accountKey: 'acct_a' }, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ id: 'insp_a', text: '甲的灵感' })] }
  });
  await protocol.handle({ accountKey: 'acct_b' }, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ id: 'insp_b', text: '乙的灵感' })] }
  });

  const a = await protocol.handle({ accountKey: 'acct_a' }, { action: 'snapshot.pull' });
  const b = await protocol.handle({ accountKey: 'acct_b' }, { action: 'snapshot.pull' });

  assert.deepStrictEqual(a.data.inspirations.map((i) => i.text), ['甲的灵感']);
  assert.deepStrictEqual(b.data.inspirations.map((i) => i.text), ['乙的灵感']);
});

// ---------------------------------------------------------------- 幂等与冲突

test('按 id upsert：同一份数据提交多次只留一条', async () => {
  const { protocol } = setup();
  const payload = { upserts: [anInspiration()] };

  await protocol.handle(CONTEXT, { action: 'snapshot.push', payload });
  await protocol.handle(CONTEXT, { action: 'snapshot.push', payload });
  await protocol.handle(CONTEXT, { action: 'snapshot.push', payload });

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations.length, 1);
});

test('baseVersion 不一致时返回冲突，不覆盖', async () => {
  const { protocol } = setup();
  await protocol.handle(CONTEXT, { action: 'snapshot.push', payload: { upserts: [anInspiration()] } });

  const stale = await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { baseVersion: 0, upserts: [anInspiration({ text: '客户端以为的新内容' })] }
  });

  assert.strictEqual(stale.ok, false);
  assert.strictEqual(stale.code, CODE.conflict);

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations[0].text, '做一个记账小程序', '冲突时不该覆盖服务端数据');
});

// ---------------------------------------------------------------- 6.3 代际

test('代际落后时拒绝写入——已清理的数据不会被离线旧设备回传', async () => {
  const { protocol, db } = setup();

  await protocol.handle(CONTEXT, { action: 'snapshot.push', payload: { upserts: [anInspiration()] } });

  // 模拟数据代际被推高（用户主动清空或代际变更）
  const doc = db.docs.get('acct_dcd');
  doc.generation = 2;
  db.docs.set('acct_dcd', doc);

  const stale = await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { generation: 1, upserts: [anInspiration({ id: 'insp_old', text: '旧设备回传的灵感' })] }
  });

  assert.strictEqual(stale.ok, false);
  assert.strictEqual(stale.code, CODE.staleGeneration);

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations.length, 1, '旧设备的队列不该被写回');
});

// ---------------------------------------------------------------- 原文历史

test('提交中删掉已有的历史版本会被拒绝', async () => {
  const { protocol } = setup();

  await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ textHistory: [{ id: 'tex_1', text: '旧版本', replacedAt: NOW }] })] }
  });

  const truncated = await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ textHistory: [] })] }   // 历史被抹掉了
  });

  assert.strictEqual(truncated.ok, false);
  assert.strictEqual(truncated.code, CODE.immutableViolation);

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations[0].textHistory.length, 1, '历史不该被抹掉');
});

test('历史只增不减的提交可以正常通过', async () => {
  const { protocol } = setup();
  const v1 = { id: 'tex_1', text: '第一版', replacedAt: NOW };

  await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ textHistory: [v1] })] }
  });

  const grown = await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: {
      upserts: [anInspiration({
        text: '第三版',
        textHistory: [v1, { id: 'tex_2', text: '第二版', replacedAt: NOW + 1 }]
      })]
    }
  });

  assert.strictEqual(grown.ok, true);
});

// ---------------------------------------------------------------- 6.4 路径隔离

test('标识含越权字符的提交被拒绝', async () => {
  const { protocol } = setup();
  const unsafe = ['../evil', 'a/b', 'a b', 'a.b', ''];

  for (const id of unsafe) {
    const result = await protocol.handle(CONTEXT, {
      action: 'snapshot.push',
      payload: { upserts: [anInspiration({ id })] }
    });
    assert.strictEqual(result.ok, false, `标识 ${JSON.stringify(id)} 应被拒绝`);
    assert.strictEqual(result.code, CODE.invalidPayload);
  }
});

// ---------------------------------------------------------------- 删除

test('删除：清理云存储后物理移除', async () => {
  const { protocol, storage } = setup();
  await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: {
      upserts: [anInspiration({
        photos: [{ id: 'pho_1', fileId: 'cloud://p1', createdAt: NOW }, { id: 'pho_2', fileId: 'cloud://p2', createdAt: NOW }]
      })]
    }
  });

  const result = await protocol.handle(CONTEXT, {
    action: 'inspiration.delete', payload: { inspirationId: 'insp_lz9k_4f2a' }
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.deletedPhotos, 2);
  assert.deepStrictEqual(storage.removed, ['cloud://p1', 'cloud://p2']);

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations.length, 0);
});

test('删除时清理失败则回滚，灵感与照片全部保留', async () => {
  const { protocol, db } = setup({ failRemoval: true });
  await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ photos: [{ id: 'pho_1', fileId: 'cloud://p1', createdAt: NOW }] })] }
  });

  const result = await protocol.handle(CONTEXT, {
    action: 'inspiration.delete', payload: { inspirationId: 'insp_lz9k_4f2a' }
  });

  assert.strictEqual(result.ok, false);

  const pulled = await protocol.handle(CONTEXT, { action: 'snapshot.pull' });
  assert.strictEqual(pulled.data.inspirations.length, 1, '删除确认失败时灵感必须保留');
  assert.strictEqual(pulled.data.inspirations[0].deletedAt, null, '软删标记应被回滚');
  assert.strictEqual(pulled.data.inspirations[0].photos.length, 1, '照片记录也必须保留');
});

test('删除不存在的灵感返回 NOT_FOUND', async () => {
  const { protocol } = setup();
  const result = await protocol.handle(CONTEXT, { action: 'inspiration.delete', payload: { inspirationId: 'insp_nope' } });

  assert.strictEqual(result.code, CODE.notFound);
});

// ---------------------------------------------------------------- 传输层幂等

test('同一 requestId 重试直接返回上次结果，不重复执行', async () => {
  const { protocol, storage } = setup();
  await protocol.handle(CONTEXT, {
    action: 'snapshot.push',
    payload: { upserts: [anInspiration({ photos: [{ id: 'pho_1', fileId: 'cloud://p1', createdAt: NOW }] })] }
  });

  const request = { action: 'inspiration.delete', payload: { inspirationId: 'insp_lz9k_4f2a' }, requestId: 'req_1' };
  const first = await protocol.handle(CONTEXT, request);
  const second = await protocol.handle(CONTEXT, request);

  assert.deepStrictEqual(first, second, '重试应返回同一结果');
  assert.strictEqual(storage.removed.length, 1, '重试不该真的再删一次');
});

// ---------------------------------------------------------------- 协议

test('未知动作返回明确错误码', async () => {
  const { protocol } = setup();
  const result = await protocol.handle(CONTEXT, { action: 'snapshot.drop' });

  assert.strictEqual(result.code, PROTOCOL_CODE.invalidAction);
});

test('仓库层抛错时收敛成稳定错误码，不透出堆栈', async () => {
  const broken = createProtocol({
    repository: {
      pull: async () => { throw new Error('数据库炸了：内部路径 /var/db/secret'); },
      push: async () => { throw new Error('x'); },
      remove: async () => { throw new Error('x'); }
    },
    now: () => NOW
  });

  const result = await broken.handle(CONTEXT, { action: 'snapshot.pull' });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, PROTOCOL_CODE.internal);
  assert.strictEqual(result.message, '服务暂时不可用', '不该把内部错误信息透给客户端');
});
