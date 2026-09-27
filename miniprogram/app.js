const cloudConfig = require('./config/cloud');
const aiConfig = require('./config/ai');
const { createStore, LEGACY_STORAGE_KEYS } = require('./services/store');
const { createCaptureDrafts } = require('./services/capture-drafts');
const { createWxStorage } = require('./services/wx-storage');
const { createWxTransport } = require('./services/wx-transport');

App({
  globalData: {
    cloudEnabled: cloudConfig.enabled,
    aiEnabled: aiConfig.enabled,

    // 全应用共用一个本机状态与一个草稿区，页面通过 getApp().globalData 取用。
    // 草稿只在内存里，进程结束即消失——规范没有承诺它跨会话存在（detailed-design §7.6）。
    store: null,
    drafts: createCaptureDrafts(),
    readyPromise: null,
    accountError: '',
    legacyCachePresent: false,
    sessionEpoch: 0,
    foreground: false
  },

  onLaunch() {
    if (!cloudConfig.enabled) {
      this.globalData.accountError = '当前无法确认账户，请稍后再试。';
      return;
    }
    if (!wx.cloud) {
      this.globalData.accountError = '当前微信版本暂不支持，请升级后重试。';
      return;
    }
    wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
    if (typeof wx.onNetworkStatusChange === 'function') {
      wx.onNetworkStatusChange((status) => {
        if (!status.isConnected || !this.globalData.foreground) return;
        const store = this.globalData.store;
        if (store) store.retryPending().catch(() => {});
        else this.refreshAccount().catch(() => {});
      });
    }
    this.refreshAccount();
  },

  onShow() {
    this.globalData.foreground = true;
    if (cloudConfig.enabled && wx.cloud) this.refreshAccount();
  },

  onHide() {
    this.globalData.foreground = false;
    this.globalData.sessionEpoch += 1;
    this.globalData.store = null;
    this.globalData.readyPromise = null;
  },

  ensureReady() {
    if (this.globalData.readyPromise) return this.globalData.readyPromise;
    if (this.globalData.store) return Promise.resolve(this.globalData.store);
    if (!cloudConfig.enabled || !wx.cloud) return Promise.resolve(null);
    return this.refreshAccount();
  },

  refreshAccount() {
    if (this.globalData.readyPromise) return this.globalData.readyPromise;
    if (!cloudConfig.enabled || !wx.cloud) return Promise.resolve(null);
    // 身份尚未重新确认时绝不展示上一个账户的缓存。
    this.globalData.store = null;
    const epoch = ++this.globalData.sessionEpoch;
    const transport = createWxTransport({ functionName: cloudConfig.apiFunction });
    const pending = (async () => {
      try {
        const storage = createWxStorage();
        try {
          const keys = storage.info().keys || [];
          this.globalData.legacyCachePresent = keys.includes(LEGACY_STORAGE_KEYS.snapshot) || keys.includes(LEGACY_STORAGE_KEYS.queue);
        } catch (err) { /* 不能枚举键时也绝不读取旧内容。 */ }
        const response = await transport.send('snapshot.pull', {});
        if (epoch !== this.globalData.sessionEpoch) return null;
        if (!response || !response.ok) throw new Error('PULL_FAILED');
        const store = createStore({
          storage, transport,
          now: () => Date.now(),
          cacheScope: response.data && response.data.cacheScope,
          remoteSnapshot: response.data
        });
        this.globalData.store = store;
        this.globalData.accountError = '';
        // 一次至多处理三条。失败保留队列，用户可在「我的」页再试。
        store.retryPending().catch(() => {});
        return store;
      } catch (err) {
        if (epoch !== this.globalData.sessionEpoch) return null;
        this.globalData.accountError = err && err.message === 'ACCOUNT_CACHE_DAMAGED'
          ? '记录缓存无法读取，请勿清理小程序数据，先联系维护者。'
          : '暂时无法确认账户，请联网后重试。';
        return null;
      }
    })();
    this.globalData.readyPromise = pending;
    pending.finally(() => {
      if (this.globalData.readyPromise === pending) this.globalData.readyPromise = null;
    });
    return pending;
  }
});
