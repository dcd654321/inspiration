const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage, pageGuard, readPageAccount } = require('../../services/page-session');

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
    beginPage(this);
    this.client = this.client || createShareClient();
    this.setData({ busy: false, loading: true, error: '', items: [], nextBefore: null });
    await this.load(true);
  },
  onHide() {
    endPage(this);
    this.setData({ busy: false, loading: false, items: [], nextBefore: null });
  },
  onUnload() { this.onHide(); },
  async load(replace) {
    if (this.visible === false || (!replace && (this.data.loading || !this.data.nextBefore))) return;
    const version = this.listVersion = (this.listVersion || 0) + 1;
    const before = this.data.nextBefore;
    this.setData({ loading: true });
    const account = await readPageAccount(this);
    const isCurrent = () => account.isCurrent() && version === this.listVersion;
    if (!isCurrent()) return;
    if (!account.store) { this.setData({ loading: false, error: '暂时无法确认账户，请稍后重试。' }); return; }
    if (this.sessionStore && this.sessionStore !== account.store) {
      replace = true; this.setData({ items: [] });
    }
    this.sessionStore = account.store;
    this.sessionEpoch = account.epoch;
    let result;
    try { result = await this.client.send('share.listMine', replace ? {} : { before }); }
    catch (err) { result = { ok: false }; }
    if (!isCurrent()) return;
    if (!result.ok) { this.setData({ loading: false, error: '分享记录暂时无法加载。' }); return; }
    const seen = new Set();
    this.setData({ loading: false, error: '',
      items: (replace ? [] : this.data.items).concat(result.data.items.map(decorate))
        .filter((entry) => { if (seen.has(entry.shareId)) return false; seen.add(entry.shareId); return true; }),
      nextBefore: result.data.nextBefore });
  },
  onMore() { return this.load(false); },
  onRetry() { if (!this.data.loading) return this.load(true); },
  onOpenList() { wx.switchTab({ url: '/pages/list/index' }); },
  onReshare(event) {
    if (this.data.busy || this.visible === false) return;
    const id = event.currentTarget.dataset.source;
    if (!id) return;
    wx.navigateTo({ url: '/pages/share-preview/index?id=' + encodeURIComponent(id) });
  },
  onRevoke(event) {
    if (this.data.busy || this.visible === false) return;
    const id = event.currentTarget.dataset.id;
    if (!id || this.sessionStore !== getApp().globalData.store ||
        this.sessionEpoch !== getApp().globalData.sessionEpoch) return;
    const isCurrent = pageGuard(this);
    this.setData({ busy: true, error: '' });
    wx.showModal({
      title: '撤销链接？',
      content: '撤销后，其他人无法再通过这个链接查看内容。已复制的文字和已保存的海报不会被收回。',
      confirmText: '撤销链接',
      cancelText: '保留链接',
      fail: () => { if (isCurrent()) this.setData({ busy: false }); },
      success: async (choice) => {
        if (!isCurrent()) return;
        if (!choice.confirm) { this.setData({ busy: false }); return; }
        let result;
        try { result = await this.client.send('share.revoke', { shareId: id }); }
        catch (err) { result = { ok: false }; }
        if (!isCurrent()) return;
        this.setData({ busy: false });
        if (!result.ok) { this.setData({ error: '撤销没有完成，请稍后重试。' }); return; }
        await this.load(true);
      }
    });
  }
});