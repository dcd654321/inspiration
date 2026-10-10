'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharedCloud = require('./helpers/shared-cloud.cjs');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('应用回到前台先锁住旧账户，可信拉取后才打开新账户分区', async () => {
  const appPath = require.resolve('../miniprogram/app');
  const previous = { App: global.App, wx: global.wx };
  const data = new Map();
  let account = A;
  let generation = 1;
  let definition;
  let networkListener;
  let retryCount = 0;
  let localReads = 0;
  data.set('linggan:v1:snapshot', { inspirations: [{ id: 'old', text: '归属未明' }] });
  try {
    global.App = (value) => { definition = value; };
    global.wx = {
      cloud: {
        init() {},
        async callFunction({ data: request }) {
          assert.equal(request.action, 'snapshot.pull');
          return { result: { ok: true, data: {
            cacheScope: account, generation, version: account === A ? 1 : 0,
            inspirations: account === A ? [{ id: 'a', text: 'A 的内容', updatedAt: 1, deletedAt: null, mergedInto: null }] : []
          } } };
        }
      },
      onNetworkStatusChange(listener) { networkListener = listener; },
      getStorageSync(key) { localReads += 1; return data.get(key); },
      setStorageSync() { throw Error('新会话不得写入微信持久存储'); },
      getStorageInfoSync() { localReads += 1; return { keys: Array.from(data.keys()) }; }
    };
    global.wx.cloud = sharedCloud(global.wx.cloud);
    delete require.cache[appPath];
    require(appPath);
    const app = Object.assign({}, definition, { globalData: Object.assign({}, definition.globalData) });
    app.onLaunch();
    await app.ensureReady();
    assert.equal(app.globalData.store.listInspirations()[0].text, 'A 的内容');
    assert.equal(localReads, 0, '新会话不扫描或读取旧测试缓存');

    app.onShow();
    await app.ensureReady();
    const activeStore = app.globalData.store;
    app.globalData.drafts.set('a', 'A 尚未提交的补充');
    activeStore.refresh = async () => { retryCount += 1; };
    networkListener({ isConnected: true });
    assert.equal(retryCount, 1, '前台网络恢复触发一次云端刷新');

    app.onHide();
    assert.equal(app.globalData.store, null);
    assert.equal(app.globalData.drafts.get('a'), '');
    networkListener({ isConnected: true });
    assert.equal(retryCount, 1, '后台不能触发个人数据重试');
    account = B;
    app.onShow();
    assert.equal(app.globalData.store, null, '重新确认账户前不能读上个账户缓存');
    await app.ensureReady();
    assert.deepEqual(app.globalData.store.listInspirations(), []);
    assert.equal(app.globalData.drafts.get('a'), '', 'B 不读取 A 的内存草稿');
    app.globalData.drafts.set('a', 'B 的草稿');
    app.onHide(); account = A; app.onShow(); await app.ensureReady();
    assert.equal(app.globalData.drafts.get('a'), '', '切换确认账户会清除旧分区，不无限保留账户草稿');
    app.globalData.drafts.set('a', 'A 本次未提交的补充');
    app.onHide(); app.onShow(); await app.ensureReady();
    assert.equal(app.globalData.drafts.get('a'), 'A 本次未提交的补充', '同账户重新确认后接续当前草稿');
    generation = 2; app.onHide(); app.onShow(); await app.ensureReady();
    assert.equal(app.globalData.drafts.get('a'), '', '账户清理后新代际不恢复旧补充草稿');
    assert.equal(data.get('linggan:v1:snapshot').inspirations[0].text, '归属未明');
    assert.equal(localReads, 0, '切换账户也不访问旧测试缓存');
  } finally {
    delete require.cache[appPath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
