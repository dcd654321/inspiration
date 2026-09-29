'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const config = require('../miniprogram/config/cloud');
const { createCloudConnection } = require('../miniprogram/services/cloud-client');
const { createWxTransport } = require('../miniprogram/services/wx-transport');
const { createWxStorage } = require('../qa/legacy/wx-storage');
const { createStore } = require('../qa/legacy/store');
const { loadPrivatePhotos } = require('../miniprogram/services/private-photos');
const { PROJECT_APPID, getCallerIdentity } = require('../server/wx-identity');
const scope = 'a'.repeat(32);
const owner = 'wx7ad85943fe81e095';
const contextFor = (openid) => ({ APPID: owner, OPENID: 'resource_user', FROM_APPID: PROJECT_APPID, FROM_OPENID: openid });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('共享初始化并发只建一个实例，成功之前不调用默认云环境', async () => {
  const ready = deferred(); let created = 0, calls = 0;
  const sdk = {
    init() { assert.fail('不能初始化默认实例'); },
    callFunction() { assert.fail('不能调用默认实例'); },
    Cloud: class {
      constructor(options) { created++; assert.deepEqual(options, { resourceAppid: owner, resourceEnv: config.envId }); }
      init() { return ready.promise; }
      callFunction(input) { assert.equal(this instanceof sdk.Cloud, true); calls++; return { result: { ok: true, data: input.data } }; }
    }
  };
  const connect = createCloudConnection({ config, getSdk: () => sdk });
  const first = connect(); assert.equal(connect(), first);
  const result = first.then((client) => client.callFunction({ data: 'ok' }));
  await Promise.resolve(); assert.equal(created, 1); assert.equal(calls, 0);
  ready.resolve(); assert.equal((await result).result.data, 'ok');
  assert.equal(calls, 1); assert.equal(await connect(), await first); assert.equal(created, 1);
});

test('共享初始化失败可重试，缺少共享配置不回退默认实例', async () => {
  let attempts = 0;
  const sdk = { init() { assert.fail('默认实例不可用'); }, Cloud: class { async init() { if (++attempts === 1) throw Error('DENIED'); } } };
  const connect = createCloudConnection({ config, getSdk: () => sdk });
  await assert.rejects(connect(), /DENIED/); await connect(); assert.equal(attempts, 2);
  for (const changed of [{ resourceAppid: '' }, { enabled: false }, { envId: '' }]) {
    await assert.rejects(createCloudConnection({ config: { ...config, ...changed }, getSdk: () => sdk })(), /CLOUD_SHARED_UNAVAILABLE/);
  }
  await assert.rejects(createCloudConnection({ config, getSdk: () => ({ init() { assert.fail(); } }) })(), /CLOUD_SHARED_UNAVAILABLE/);
});

test('共享 SDK 初始化返回错误码时不交付实例，重试后才发业务调用', async () => {
  let attempts = 0, calls = 0;
  const sdk = { Cloud: class {
    async init() { return ++attempts === 1 ? { errCode: 403, errMsg: '共享权限未生效' } : { errCode: 0 }; }
    async callFunction() { calls += 1; return { result: { ok: true } }; }
  } };
  const connect = createCloudConnection({ config, getSdk: () => sdk });
  await assert.rejects(connect(), (error) => error.code === 403 && error.message === 'CLOUD_SHARED_INIT_FAILED');
  assert.equal(calls, 0);
  const client = await connect();
  assert.equal((await client.callFunction()).result.ok, true);
  assert.equal(attempts, 2);
  assert.equal(calls, 1);
});

test('业务传输只走已初始化的共享实例并保留请求标识', async () => {
  const previous = global.wx; let initialized = false;
  try {
    global.wx = { cloud: {
      callFunction() { assert.fail('禁止默认环境调用'); },
      Cloud: class {
        async init() { initialized = true; }
        async callFunction(input) {
          assert.equal(initialized, true); assert.equal(input.name, 'linggan_api');
          assert.equal(input.data.requestId, 'retry_1'); return { result: { ok: true, data: {} } };
        }
      }
    } };
    assert.equal((await createWxTransport({ functionName: 'linggan_api' }).send('snapshot.pull', {}, { requestId: 'retry_1' })).ok, true);
  } finally { global.wx = previous; }
});

test('共享身份仅接受完整本项目来源，不回退资源方且保持账户哈希', () => {
  const a = getCallerIdentity(contextFor('user_a'));
  assert.equal(a.appid, PROJECT_APPID); assert.equal(a.openid, 'user_a');
  assert.equal(a.accountKey, crypto.createHash('sha256').update(PROJECT_APPID + '|user_a').digest('hex').slice(0, 32));
  assert.equal(a.accountKey, getCallerIdentity({ APPID: PROJECT_APPID, OPENID: 'user_a' }).accountKey);
  assert.notEqual(a.accountKey, getCallerIdentity(contextFor('user_b')).accountKey);
  const validLocal = { APPID: PROJECT_APPID, OPENID: 'local_user' };
  for (const value of [null, {}, { APPID: owner, OPENID: 'resource_user' },
    { ...validLocal, FROM_APPID: PROJECT_APPID }, { ...validLocal, FROM_OPENID: 'user_a' },
    { ...validLocal, FROM_APPID: null }, { ...contextFor('user_a'), FROM_APPID: owner },
    { ...contextFor('user_a'), FROM_OPENID: '' }, { ...contextFor('user_a'), FROM_OPENID: 12 }]) {
    assert.equal(getCallerIdentity(value), null);
  }
});

function loadApi(cloud, repository) {
  let sharing; const exports = {};
  const filename = path.resolve(__dirname, '../cloudfunctions/linggan_api/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Buffer, process: { env: {} }, exports,
    require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === './server/wx-identity') return require('../server/wx-identity');
      if (name === './server/protocol') return require('../server/protocol');
      if (name === './server/repository') return { createRepository: () => repository };
      if (name === './server/sharing-feedback') return { createSharingFeedbackService(options) { sharing = options; return {}; } };
      if (name === './server/cloud-sharing-db') return { createCloudSharingDb: () => ({}) };
      if (name === './server/rate-limit') return { createCloudRateLimiter: () => async () => true };
      if (name === './server/photo-lifecycle') return { createPhotoValidator: () => () => false };
      throw Error('Unexpected module ' + name);
    }
  }, { filename });
  return { main: exports.main, sharing };
}

test('共享 API 入口先拒绝其他项目和缺失来源，客户端身份不能授予访问权', async () => {
  let identity = contextFor('user_a'), reads = 0;
  const api = loadApi({ init() {}, database: () => ({}), getWXContext: () => identity }, {
    async pull(accountKey) { reads++; assert.equal(accountKey, getCallerIdentity(contextFor('user_a')).accountKey); return { ok: true, data: {} }; }
  });
  const event = { action: 'snapshot.pull', payload: {}, requestId: 'one' };
  assert.equal((await api.main(event)).ok, true); assert.equal(reads, 1);
  for (identity of [{}, { APPID: owner, OPENID: 'user_a' }, { ...contextFor('user_a'), FROM_APPID: owner },
    { APPID: PROJECT_APPID, OPENID: 'user_a', FROM_APPID: PROJECT_APPID }]) {
    const result = await api.main({ ...event, appid: PROJECT_APPID, openid: 'user_a', accountKey: scope });
    assert.equal(result.code, 'UNAUTHENTICATED'); assert.equal(reads, 1);
  }
});

test('共享审核和小程序码明确使用本项目 AppID，拒绝资源方身份', async () => {
  let identity = contextFor('user_a'); const checked = [], codes = [], appids = [];
  const api = loadApi({ init() {}, database: () => ({}), getWXContext: () => identity,
    openapi(options) { appids.push(options.appid); return {
      security: { async msgSecCheck(input) { checked.push(input); return { errCode: 0, result: { suggest: 'pass' } }; } },
      wxacode: { async getUnlimited(input) { codes.push(input); return { buffer: Buffer.from('synthetic') }; } }
    }; }
  }, {});
  assert.equal(await api.sharing.checkPublicText('合成审核样例'), true);
  assert.equal((await api.sharing.generateCode('synthetic', 'pages/shared/index')).toString(), 'synthetic');
  assert.deepEqual(appids, [PROJECT_APPID, PROJECT_APPID]); assert.equal(checked[0].openid, 'user_a');
  assert.equal(codes[0].envVersion, 'release');
  identity = { APPID: owner, OPENID: 'resource_user' };
  assert.equal(await api.sharing.checkPublicText('不会发送'), false);
  assert.equal(await api.sharing.generateCode('not_sent', 'pages/shared/index'), null); assert.equal(appids.length, 2);
});

test('环境缓存隔离不读取重放或删除旧队列，容量保留平台值', async () => {
  const previous = global.wx, data = new Map(), readKeys = [];
  const key = 'linggan:v2:' + scope + ':state';
  const old = { snapshot: { privateText: '旧环境内容' }, queue: [{ action: 'snapshot.push', requestId: 'old' }] };
  data.set(key, old); data.set('unrelated', 1);
  try {
    global.wx = {
      getStorageSync(k) { readKeys.push(k); return data.get(k); }, setStorageSync(k, v) { data.set(k, v); }, removeStorageSync(k) { data.delete(k); },
      getStorageInfoSync() { return { keys: [...data.keys()], currentSize: 22, limitSize: 999 }; }
    };
    const namespace = 'linggan:env:' + owner + ':' + config.envId + ':';
    const storage = createWxStorage({ namespace }); let sends = 0;
    const store = createStore({ storage, now: () => 1, cacheScope: scope,
      transport: { async send() { sends++; return { ok: false }; } },
      remoteSnapshot: { cacheScope: scope, generation: 1, version: 0, inspirations: [] } });
    await store.retryPending(); assert.equal(sends, 0); assert.deepEqual(store.listInspirations(), []);
    assert.ok(readKeys.every((k) => k.startsWith(namespace))); assert.equal(data.get(key), old);
    storage.set('probe', 1); assert.equal(storage.get('probe'), 1); assert.equal(data.get(namespace + 'probe'), 1);
    assert.deepEqual(storage.info(), { keys: [key, 'probe'], currentSize: 22, limitSize: 999 });
    storage.remove('probe'); assert.equal(data.get(key), old); assert.equal(data.get('unrelated'), 1);
    assert.throws(() => createWxStorage({ namespace: 1 }), /INVALID_STORAGE_NAMESPACE/);
  } finally { global.wx = previous; }
});

test('共享私有照片仅下载当前环境账户文件，失败隔离且不生成公开链接', async () => {
  const prefix = 'cloud://' + config.envId + '.bucket/linggan/' + scope + '/idea/';
  const downloads = [];
  const photos = [{ id: 'p1', fileId: prefix + 'p1' }, { id: 'p2', fileId: prefix + 'p2' },
    { id: 'p3', fileId: prefix.replace(scope, 'b'.repeat(32)) + 'p3' }, { id: 'p4', fileId: 'cloud://old.bucket/linggan/' + scope + '/idea/p4' }];
  const result = await loadPrivatePhotos(photos, { cacheScope: scope, isCurrent: () => true, getClient: async () => ({
    async downloadFile({ fileID }) { downloads.push(fileID); if (fileID.endsWith('p2')) throw Error('DENIED'); return { tempFilePath: 'wxfile://private-temp' }; },
    getTempFileURL() { assert.fail('不能转成公开链接'); }
  }) });
  assert.equal(downloads.length, 2); assert.equal(result[0].src, 'wxfile://private-temp');
  assert.ok(result.slice(1).every((photo) => photo.failed && !photo.src));
  assert.equal('src' in photos[0], false); assert.ok(result.every((photo) => !('fileId' in photo)));
});

test('共享照片下载的迟到结果在页面或会话失效后丢弃', async () => {
  const waiting = deferred(); let current = true;
  const promise = loadPrivatePhotos([{ id: 'p1', fileId: 'cloud://' + config.envId + '.bucket/linggan/' + scope + '/idea/p1' }], {
    cacheScope: scope, isCurrent: () => current, getClient: async () => ({ downloadFile: () => waiting.promise }) });
  await Promise.resolve(); current = false; waiting.resolve({ tempFilePath: 'wxfile://late' });
  assert.deepEqual(await promise, []);
});

test('共享 AI 入口使用同一可信来源并将审核路由到本项目', async () => {
  let identity = contextFor('user_a'), options, received;
  const exports = {}, filename = path.resolve(__dirname, '../cloudfunctions/linggan_ai/index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { process: { env: {} }, exports,
    require(name) {
      if (name === 'wx-server-sdk') return { init() {}, database: () => ({}), getWXContext: () => identity,
        openapi(input) { assert.equal(input.appid, PROJECT_APPID); return { security: { async msgSecCheck(data) {
          assert.equal(data.openid, 'user_a'); return { errCode: 0, result: { suggest: 'pass' } };
        } } }; } };
      if (name === './server/wx-identity') return require('../server/wx-identity');
      if (name === './server/ai-service') return { createAiHandler(value) { options = value; return (context) => { received = context; }; } };
      if (name === './server/ai-quota') return { createCloudAiQuota: () => ({}) };
      if (name === './core/ai-contract') return require('../miniprogram/core/ai-contract');
      throw Error('Unexpected module ' + name);
    }
  }, { filename });
  exports.main({}); assert.deepEqual(received, getCallerIdentity(identity));
  assert.equal(options.enabled, false); assert.equal(await options.moderate('合成样例', received), true);
  identity = { ...contextFor('user_a'), FROM_APPID: owner }; exports.main({ accountKey: scope }); assert.equal(received.accountKey, '');
});

test('照片页面退出后迟到下载不回填，详情等待账户时退出不开始下载', async () => {
  const previous = { wx: global.wx, Page: global.Page, getApp: global.getApp };
  const photo = { id: 'p1', createdAt: 1, fileId: 'cloud://' + config.envId + '.bucket/linggan/' + scope + '/idea/p1' };
  const source = { ...require('../miniprogram/core/inspiration').createInspiration({ id: 'idea', text: '合成记录', now: 1 }), photos: [photo] };
  const store = { getInspiration: () => source };
  const app = { globalData: { store, cacheScope: scope, sessionEpoch: 1 }, ensureReady: async () => store };
  let definition, downloads = 0; const waiting = deferred();
  const viewerFile = require.resolve('../miniprogram/pages/photo-viewer/index');
  const detailFile = require.resolve('../miniprogram/pages/detail/index');
  try {
    global.getApp = () => app; global.Page = (value) => { definition = value; };
    global.wx = { cloud: { Cloud: class { async init() {} downloadFile() { downloads++; return waiting.promise; } } } };
    delete require.cache[viewerFile]; require(viewerFile);
    const viewer = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    const loading = viewer.onLoad({ id: 'idea' }); await new Promise(setImmediate);
    assert.equal(downloads, 1); viewer.onHide(); waiting.resolve({ tempFilePath: 'wxfile://late' }); await loading;
    assert.deepEqual(viewer.data.photos, []);
    const ready = deferred(); app.ensureReady = () => ready.promise;
    delete require.cache[detailFile]; require(detailFile);
    const detail = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    const before = downloads, initial = detail.onLoad({ id: 'idea' }); detail.onHide(); ready.resolve(store); await initial;
    assert.equal(downloads, before); assert.deepEqual(detail.data.photos, []);
  } finally {
    delete require.cache[viewerFile]; delete require.cache[detailFile];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});
