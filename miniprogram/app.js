const cloudConfig = require('./config/cloud');
const { createCloudOnlyStore } = require('./services/cloud-only-store');
const { createCaptureDrafts } = require('./services/capture-drafts');
const { createMemoryStorage } = require('./services/memory-storage');
const { createWxTransport } = require('./services/wx-transport');
const { createReviewService } = require('./services/discovery');
const { createWxPhotos } = require('./services/wx-photo');
const { createUsageMetrics } = require('./services/usage-metrics');
const { getCloudClient } = require('./services/cloud-client');
const { createSessionDrafts, sameContext } = require('./services/session-drafts');

App({
  globalData: {
    cloudEnabled: cloudConfig.enabled,

    // 全应用只持有当前会话的内存视图；持久记录以云端确认结果为准。
    // 草稿只在内存里，进程结束即消失——规范没有承诺它跨会话存在（detailed-design §7.6）。
    store: null,
    review: null,
    photos: null,
    cacheScope: '',
    metrics: null,
    drafts: createCaptureDrafts(),
    sessionDrafts: createSessionDrafts(),
    readyPromise: null,
    accountError: '',
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
    if (typeof wx.onNetworkStatusChange === 'function') {
      wx.onNetworkStatusChange((status) => {
        if (!status.isConnected || !this.globalData.foreground) return;
        const store = this.globalData.store;
        if (store) store.refresh().catch(() => {});
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
    this.globalData.review = null;
    this.globalData.photos = null;
    this.globalData.cacheScope = '';
    this.globalData.metrics = null;
    this.globalData.drafts = createCaptureDrafts();
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
    this.globalData.review = null;
    this.globalData.photos = null;
    this.globalData.cacheScope = '';
    this.globalData.metrics = null;
    const epoch = ++this.globalData.sessionEpoch;
    this.globalData.drafts = createCaptureDrafts();
    const transport = createWxTransport({ functionName: cloudConfig.apiFunction });
    const pending = (async () => {
      try {
        await getCloudClient();
        if (epoch !== this.globalData.sessionEpoch) return null;
        const response = await transport.send('snapshot.pull', {});
        if (epoch !== this.globalData.sessionEpoch) return null;
        if (!response || !response.ok) throw new Error('PULL_FAILED');
        const storage = createMemoryStorage();
        const store = createCloudOnlyStore({
          transport,
          now: () => Date.now(),
          isCurrent: () => epoch === this.globalData.sessionEpoch,
          cacheScope: response.data && response.data.cacheScope,
          remoteSnapshot: response.data
        });
        this.globalData.store = store;
        this.globalData.cacheScope = response.data.cacheScope;
        const context = { cacheScope: response.data.cacheScope, generation: response.data.generation };
        if (!sameContext(this.draftOwner, context)) this.accountDrafts = createCaptureDrafts();
        this.draftOwner = context;
        this.globalData.drafts = this.accountDrafts;
        this.globalData.sessionDrafts.bind(context);
        this.globalData.metrics = createUsageMetrics({ storage, cacheScope: response.data.cacheScope });
        this.globalData.review = createReviewService({ storage, cacheScope: response.data.cacheScope });
        try { this.globalData.photos = response.data.photosEnabled === true ? createWxPhotos({ cacheScope: response.data.cacheScope, store, storagePrefix: response.data.storagePrefix, isCurrent: () => epoch === this.globalData.sessionEpoch }) : null; }
        catch (err) { this.globalData.photos = null; /* 照片配置异常不阻断文字功能。 */ }
        this.globalData.accountError = '';
        return store;
      } catch (err) {
        if (epoch !== this.globalData.sessionEpoch) return null;
        this.globalData.accountError = '暂时无法确认账户，请联网后重试。';
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
