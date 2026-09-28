const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');

function decorate(entry) {
  return Object.assign({}, entry, {
    date: formatAbsolute(entry.createdAt),
    statusText: entry.status === 'active' ? '可查看' : entry.status === 'revoked' ? '已撤销' :
      entry.status === 'unavailable' ? '已失效' : '已过期',
    channelText: entry.channelIntent === 'chat' ? '用于聊天' : '用于朋友圈海报',
    title: entry.title || '内容已清理'
  });
}

Page({
  data: { items: [], loading: true, busy: false, error: '', nextBefore: null },
  async onShow() {
    this.client = this.client || createShareClient();
    this.setData({ loading: true, error: '', items: [], nextBefore: null });
    await this.load(true);
  },
  async load(replace) {
    if (!replace && !this.data.nextBefore) return;
    const app = getApp();
    const store = await app.ensureReady();
    if (!store) { this.setData({ loading: false, error: '暂时无法确认账户，请稍后重试。' }); return; }
    const epoch = app.globalData.sessionEpoch;
    let result;
    try { result = await this.client.send('share.listMine', replace ? {} : { before: this.data.nextBefore }); }
    catch (err) { result = { ok: false }; }
    if (epoch !== app.globalData.sessionEpoch) return;
    if (!result.ok) { this.setData({ loading: false, error: '分享记录暂时无法加载。' }); return; }
    this.setData({ loading: false, error: '',
      items: (replace ? [] : this.data.items).concat(result.data.items.map(decorate)),
      nextBefore: result.data.nextBefore });
  },
  onMore() { this.load(false); },
  onRetry() { this.setData({ loading: true }); this.load(true); },
  onReshare(event) {
    const id = event.currentTarget.dataset.source;
    if (!id) return;
    wx.navigateTo({ url: '/pages/share-preview/index?id=' + encodeURIComponent(id) });
  },
  onRevoke(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '撤销这份分享？',
      content: '撤销后，分享链接将无法再次查看；已复制的文字和已发布的海报无法收回。',
      confirmText: '撤销',
      success: async (choice) => {
        if (!choice.confirm) return;
        this.setData({ busy: true, error: '' });
        let result;
        try { result = await this.client.send('share.revoke', { shareId: id }); }
        catch (err) { result = { ok: false }; }
        this.setData({ busy: false });
        if (!result.ok) { this.setData({ error: '撤销没有完成，请稍后重试。' }); return; }
        await this.load(true);
      }
    });
  }
});
