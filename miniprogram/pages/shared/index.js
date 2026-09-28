const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');

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
    this.token = tokenFrom(options);
    this.client = createShareClient();
    await this.load();
  },

  async onShow() {
    if (this.loadedEpoch && this.loadedEpoch !== getApp().globalData.sessionEpoch) {
      this.setData({ loading: true, title: '', body: '', date: '' });
      await this.load();
    }
  },

  async load() {
    const app = getApp();
    const store = await app.ensureReady();
    this.loadedEpoch = app.globalData.sessionEpoch;
    if (!store) {
      this.setData({ loading: false, error: '暂时无法查看，请联网后重试。', unavailable: false,
        title: '', body: '', date: '' });
      return;
    }
    let result;
    try { result = await this.client.send('share.get', { token: this.token }); }
    catch (err) { result = { ok: false, code: 'INTERNAL' }; }
    if (!result.ok) {
      this.setData({ loading: false, unavailable: result.code === 'SHARE_UNAVAILABLE',
        error: result.code === 'SHARE_UNAVAILABLE' ? '这份分享已无法查看。' : '暂时无法查看，请稍后重试。',
        title: '', body: '', date: '' });
      return;
    }
    this.setData({ loading: false, unavailable: false, error: '',
      title: result.data.title, body: result.data.body,
      date: formatAbsolute(result.data.createdAt) });
  },

  onRetry() { this.setData({ loading: true, error: '', title: '', body: '', date: '' }); this.load(); },

  onCopy() {
    if (this.data.loading || this.data.error || !this.data.body) return;
    wx.setClipboardData({ data: this.data.body,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制未完成', icon: 'none' }) });
  },

  onReport() {
    if (!this.token || this.data.unavailable) return;
    wx.navigateTo({ url: '/pages/feedback/index?t=' + encodeURIComponent(this.token) });
  },

  onStart() { wx.switchTab({ url: '/pages/capture/index' }); }
});

module.exports = { tokenFrom };
