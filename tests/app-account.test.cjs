'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('应用回到前台先锁住旧账户，可信拉取后才打开新账户分区', async () => {
  const appPath = require.resolve('../miniprogram/app');
  const previous = { App: global.App, wx: global.wx };
  const data = new Map();
  let account = A;
  let definition;
  let networkListener;
  let retryCount = 0;
  data.set('linggan:v1:snapshot', { inspirations: [{ id: 'old', text: '归属未明' }] });
  try {
    global.App = (value) => { definition = value; };
    global.wx = {
      cloud: {
        init() {},
        async callFunction({ data: request }) {
          assert.equal(request.action, 'snapshot.pull');
          return { result: { ok: true, data: {
            cacheScope: account, generation: 1, version: account === A ? 1 : 0,
            inspirations: account === A ? [{ id: 'a', text: 'A 的内容', updatedAt: 1, deletedAt: null, mergedInto: null }] : []
          } } };
        }
      },
      onNetworkStatusChange(listener) { networkListener = listener; },
      getStorageSync(key) { return data.get(key); },
      setStorageSync(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
      getStorageInfoSync() { return { keys: Array.from(data.keys()) }; }
    };
    delete require.cache[appPath];
    require(appPath);
    const app = Object.assign({}, definition, { globalData: Object.assign({}, definition.globalData) });
    app.onLaunch();
    await app.ensureReady();
    assert.equal(app.globalData.store.listInspirations()[0].text, 'A 的内容');
    assert.equal(app.globalData.legacyCachePresent, true);

    app.onShow();
    await app.ensureReady();
    const activeStore = app.globalData.store;
    activeStore.retryPending = async () => { retryCount += 1; };
    networkListener({ isConnected: true });
    assert.equal(retryCount, 1, '前台网络恢复触发一次有界重试');

    app.onHide();
    assert.equal(app.globalData.store, null);
    networkListener({ isConnected: true });
    assert.equal(retryCount, 1, '后台不能触发个人数据重试');
    account = B;
    app.onShow();
    assert.equal(app.globalData.store, null, '重新确认账户前不能读上个账户缓存');
    await app.ensureReady();
    assert.deepEqual(app.globalData.store.listInspirations(), []);
    assert.equal(data.get('linggan:v1:snapshot').inspirations[0].text, '归属未明');
  } finally {
    delete require.cache[appPath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
