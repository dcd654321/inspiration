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
      this.setData({ loading: false, error: '请检查网络后重试。', unavailable: false,
        title: '', body: '', date: '' });
      return;
    }
    let result;
    try { result = await this.client.send('share.get', { token: this.token }); }
    catch (err) { result = { ok: false, code: 'INTERNAL' }; }
    if (!result.ok) {
      // 失效与网络错误分开：失效不再给重试（重试也不会变好），网络错误给「重新读取」。
      // 失效原因不推断是撤销还是到期——只说事实与下一步。
      const unavailable = result.code === 'SHARE_UNAVAILABLE';
      this.setData({ loading: false, unavailable,
        error: unavailable ? '分享已失效，可请分享者重新发送。' : '请稍后重试。',
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
