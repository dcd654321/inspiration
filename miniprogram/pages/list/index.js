const { formatRelative, summarize, countLabel } = require('../../core/format');
const { activeSupplements } = require('../../core/inspiration');

/** 把一条灵感转成列表项要显示的样子。转换集中在这里，WXML 里就只做渲染。 */
function decorate(inspiration, now) {
  const activeCount = activeSupplements(inspiration).length;
  return {
    id: inspiration.id,
    excerpt: summarize(inspiration.text, 60),
    time: formatRelative(inspiration.updatedAt, now),
    supplements: countLabel(activeCount, '条补充')
  };
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    backupNotice: ''
  },

  // 用 onShow 而不是 onLoad：从详情页返回时列表要跟着更新（改了原文、加了补充）
  async onShow() {
    this.setData({ items: [], loading: true, error: '' });
    const app = getApp();
    if (app) await app.ensureReady();
    this.load();
  },

  load() {
    const app = getApp();
    if (!app || !app.globalData.store) {
      this.setData({ loading: false, error: app && app.globalData.accountError || '暂时无法确认账户，请联网后重试。' });
      return;
    }

    try {
      const now = Date.now();
      const list = app.globalData.store.listInspirations();
      const backup = app.globalData.store.getBackupStatus();
      this.setData({
        items: list.map((item) => decorate(item, now)),
        loading: false,
        error: '',
        backupNotice: backup.state === 'CONFLICT' || backup.state === 'STALE_GENERATION' || backup.state === 'PHOTO_DELETE_UNAVAILABLE'
          ? '备份遇到冲突，内容仍保留在本机。请到「我的」查看。'
          : backup.pendingCount > 0 ? '有内容尚未完成备份，可到「我的」重试。' : ''
      });
    } catch (err) {
      // 读失败时**保留已经渲染出来的内容**，不因为刷新失败就把列表清空——
      // 用户看到空白会以为自己的灵感没了。
      this.setData({
        loading: false,
        error: '暂时无法刷新，当前内容仍可查看。'
      });
    }
  },

  async onRetry() {
    const app = getApp();
    if (app) await app.refreshAccount();
    this.load();
  },

  onAdd() {
    wx.switchTab({ url: '/pages/capture/index' });
  },

  onOpen(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
