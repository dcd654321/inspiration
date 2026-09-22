const { formatRelative, summarize, countLabel } = require('../../core/format');

/** 把一条灵感转成列表项要显示的样子。转换集中在这里，WXML 里就只做渲染。 */
function decorate(inspiration, now) {
  return {
    id: inspiration.id,
    excerpt: summarize(inspiration.text, 60),
    time: formatRelative(inspiration.updatedAt, now),
    supplements: countLabel(inspiration.supplements.length, '条补充'),
    photos: countLabel(inspiration.photos.length, '张照片')
  };
}

Page({
  data: {
    items: [],
    loading: true,
    error: ''
  },

  // 用 onShow 而不是 onLoad：从详情页返回时列表要跟着更新（改了原文、加了补充）
  onShow() {
    this.load();
  },

  load() {
    const app = getApp();
    if (!app || !app.globalData.store) {
      this.setData({ loading: false, error: '还没准备好，稍后再试。' });
      return;
    }

    try {
      const now = Date.now();
      const list = app.globalData.store.listInspirations();
      this.setData({
        items: list.map((item) => decorate(item, now)),
        loading: false,
        error: ''
      });
    } catch (err) {
      // 读失败时**保留已经渲染出来的内容**，不因为刷新失败就把列表清空——
      // 用户看到空白会以为自己的灵感没了。
      this.setData({
        loading: false,
        error: '没能读到最新内容，先显示已经存下来的部分。'
      });
    }
  },

  onRetry() {
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
