Page({
  onShareAppMessage() {
    return { title: '灵感拾光簿｜让想法慢慢成形', path: '/pages/welcome/index',
      imageUrl: '/assets/brand-mark.png' };
  },
  onShareTimeline() {
    return { title: '灵感拾光簿｜让想法慢慢成形', query: '',
      imageUrl: '/assets/brand-mark.png' };
  },
  onStart() { wx.switchTab({ url: '/pages/capture/index' }); }
});
