const { createShareClient, publicTemplate } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage } = require('../../services/page-session');
const { readPublicPage } = require('../../services/public-reader');
const { getCloudConnectionGeneration } = require('../../services/cloud-client');
const { startCapture } = require('../../services/capture-entry');

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
  data: { loading: true, unavailable: false, error: '', title: '', body: '', date: '',
    templateName: '', startLabel: '也整理我的想法', hasTemplate: false },
  async onLoad(options) {
    beginPage(this);
    this.token = tokenFrom(options);
    await this.load();
  },
  async onShow() {
    const app = getApp();
    const generation = getCloudConnectionGeneration();
    if (this.visible && ((this.data.loading && this.loadingEpoch === app.globalData.sessionEpoch &&
          this.loadingGeneration === generation && this.loadingToken === this.token) ||
        (this.publicIsCurrent && this.publicIsCurrent()))) return;
    beginPage(this);
    await this.load();
  },
  onHide() {
    endPage(this);
    this.publicIsCurrent = null;
    this.publicTemplateId = '';
    this.setData({ loading: false, title: '', body: '', date: '', error: '',
      templateName: '', startLabel: '也整理我的想法', hasTemplate: false });
  },
  onUnload() { this.onHide(); },
  async load() {
    if (this.visible === false) return;
    const version = this.loadVersion = (this.loadVersion || 0) + 1, token = this.token;
    this.publicIsCurrent = null;
    this.publicTemplateId = '';
    this.setData({ loading: true, error: '', unavailable: false, title: '', body: '', date: '',
      templateName: '', startLabel: '也整理我的想法', hasTemplate: false });
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    this.loadingGeneration = getCloudConnectionGeneration();
    this.loadingToken = token;
    const connection = await readPublicPage(this);
    const isCurrent = () => connection.isCurrent() && this.loadVersion === version && this.token === token;
    if (!isCurrent()) return;
    this.publicIsCurrent = isCurrent;
    if (!connection.client) {
      this.setData({ loading: false, error: '请检查网络后重试。', unavailable: false }); return;
    }
    const client = createShareClient({ client: connection.client });
    let result;
    try { result = await client.send('share.get', { token }); }
    catch (err) { result = { ok: false, code: 'INTERNAL' }; }
    if (!isCurrent()) return;
    if (!result || !result.ok || !result.data || typeof result.data.title !== 'string' || typeof result.data.body !== 'string') {
      const unavailable = result && result.code === 'SHARE_UNAVAILABLE';
      this.setData({ loading: false, unavailable,
        error: unavailable ? '分享已失效，可请分享者重新发送。' : '请稍后重试。' }); return;
    }
    const template = publicTemplate(result.data.templateId);
    const hasTemplate = Boolean(template && template.id !== 'free');
    this.publicTemplateId = hasTemplate ? template.id : '';
    this.setData({ loading: false, unavailable: false, error: '',
      title: result.data.title, body: result.data.body, date: formatAbsolute(result.data.createdAt),
      templateName: hasTemplate ? template.name : '', hasTemplate,
      startLabel: hasTemplate ? '用这个结构写自己的' : '也整理我的想法' });
  },
  onRetry() { if (!this.data.loading && !this.data.unavailable) return this.load(); },
  onCopy() {
    if (this.visible === false || this.data.loading || this.data.error || !this.data.body) return;
    const isCurrent = this.publicIsCurrent;
    if (!isCurrent || !isCurrent()) return;
    wx.setClipboardData({ data: this.data.body,
      success: () => { if (isCurrent()) wx.showToast({ title: '已复制', icon: 'none' }); },
      fail: () => { if (isCurrent()) wx.showToast({ title: '复制未完成', icon: 'none' }); } });
  },
  onReport() {
    if (this.visible === false || !this.token || this.data.unavailable || this.data.loading || this.data.error ||
        !this.publicIsCurrent || !this.publicIsCurrent()) return;
    wx.navigateTo({ url: '/pages/feedback/index?t=' + encodeURIComponent(this.token) });
  },
  onStart() {
    if (this.visible === false) return;
    const app = getApp();
    delete app.globalData.sharedTemplateIntent;
    if (this.data.hasTemplate && !this.data.loading && !this.data.error &&
        this.publicIsCurrent && this.publicIsCurrent() && publicTemplate(this.publicTemplateId)) {
      app.globalData.sharedTemplateIntent = { templateId: this.publicTemplateId,
        epoch: app.globalData.sessionEpoch, expiresAt: Date.now() + 5 * 60 * 1000 };
    }
    startCapture();
  }
});

module.exports = { tokenFrom };
