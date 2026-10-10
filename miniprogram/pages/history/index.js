const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage, readPageAccount } = require('../../services/page-session');

Page({
  data: { ready: false, missing: false, readError: false, versions: [], versionCount: 0, current: '' },
  async onLoad(query) {
    beginPage(this);
    this.id = (query && query.id) || '';
    await this.load();
  },
  async onShow() {
    const app = getApp();
    if (!this.id || (this.visible && ((this.loadingPage && this.loadingEpoch === app.globalData.sessionEpoch) ||
        (this.loadedEpoch === app.globalData.sessionEpoch && this.sessionStore === app.globalData.store)))) return;
    beginPage(this);
    await this.load();
  },
  onHide() {
    endPage(this);
    this.loadingPage = false;
    this.setData({ ready: false, current: '', versions: [], versionCount: 0 });
  },
  onUnload() { this.onHide(); },
  async load() {
    if (this.visible === false) return;
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.loadingPage = true;
    this.setData({ ready: false, current: '', versions: [], versionCount: 0, readError: false });
    const pending = readPageAccount(this);
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    const account = await pending;
    if (!account.isCurrent() || this.loadVersion !== version) return;
    this.loadingPage = false;
    this.loadedEpoch = account.epoch;
    this.sessionStore = account.store;
    if (!account.store) {
      this.setData({ ready: true, missing: false, readError: true }); return;
    }
    const item = account.store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true, readError: false }); return;
    }
    const history = Array.isArray(item.textHistory) ? item.textHistory : [];
    this.setData({ ready: true, missing: false, readError: false, versionCount: history.length,
      versions: history.slice().reverse().map((version) => ({
        id: version.id, text: version.text, time: formatAbsolute(version.replacedAt)
      })), current: item.text });
  },
  onRetryLoad() { if (!this.loadingPage) return this.load(); },
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.id) });
  },
  onBackToList() { wx.switchTab({ url: '/pages/list/index' }); }
});
