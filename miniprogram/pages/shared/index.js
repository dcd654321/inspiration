const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage, pageGuard, readPageAccount } = require('../../services/page-session');

function tokenFrom(options) {
  if (options && typeof options.t === 'string') return options.t;
  if (options && typeof options.scene === 'string') {
    let scene;
    try { scene = decodeURIComponent(options.scene); } catch (err) { return ''; }
    return scene.startsWith('s=') ? scene.slice(2) : '';
  }
  return '';
}

Page({
  data: { loading: true, unavailable: false, error: '', title: '', body: '', date: '' },
  async onLoad(options) {
    beginPage(this);
    this.token = tokenFrom(options);
    this.client = createShareClient();
    await this.load();
  },
  async onShow() {
    const app = getApp();
    if (this.visible && ((this.data.loading && this.loadingEpoch === app.globalData.sessionEpoch) ||
        (this.loadedEpoch === app.globalData.sessionEpoch && this.sessionStore === app.globalData.store))) return;
    beginPage(this);
    await this.load();
  },
  onHide() {
    endPage(this);
    this.setData({ loading: false, title: '', body: '', date: '', error: '' });
  },
  onUnload() { this.onHide(); },
  async load() {
    if (this.visible === false) return;
    const version = this.loadVersion = (this.loadVersion || 0) + 1, token = this.token;
    this.setData({ loading: true, error: '', title: '', body: '', date: '' });
    const pending = readPageAccount(this);
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    const account = await pending;
    const isCurrent = () => account.isCurrent() && this.loadVersion === version && this.token === token;
    if (!isCurrent()) return;
    this.loadedEpoch = account.epoch;
    this.sessionStore = account.store;
    if (!account.store) {
      this.setData({ loading: false, error: '请检查网络后重试。', unavailable: false }); return;
    }
    let result;
    try { result = await this.client.send('share.get', { token }); }
    catch (err) { result = { ok: false, code: 'INTERNAL' }; }
    if (!isCurrent()) return;
    if (!result.ok) {
      const unavailable = result.code === 'SHARE_UNAVAILABLE';
      this.setData({ loading: false, unavailable,
        error: unavailable ? '分享已失效，可请分享者重新发送。' : '请稍后重试。' }); return;
    }
    this.setData({ loading: false, unavailable: false, error: '',
      title: result.data.title, body: result.data.body, date: formatAbsolute(result.data.createdAt) });
  },
  onRetry() { if (!this.data.loading) return this.load(); },
  onCopy() {
    if (this.visible === false || this.data.loading || this.data.error || !this.data.body) return;
    const isCurrent = pageGuard(this);
    wx.setClipboardData({ data: this.data.body,
      success: () => { if (isCurrent()) wx.showToast({ title: '已复制', icon: 'none' }); },
      fail: () => { if (isCurrent()) wx.showToast({ title: '复制未完成', icon: 'none' }); } });
  },
  onReport() {
    if (this.visible === false || !this.token || this.data.unavailable || this.data.loading) return;
    wx.navigateTo({ url: '/pages/feedback/index?t=' + encodeURIComponent(this.token) });
  },
  onStart() { wx.switchTab({ url: '/pages/capture/index' }); }
});

module.exports = { tokenFrom };
