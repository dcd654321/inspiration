Page({
  data: {
    usageAvailable: false, usageEnabled: false, usageVisible: false, usageReport: '', usageError: '',
    reviewAvailable: false, reviewEnabled: true, reviewError: '',
    privacyNotes: [
      '灵感默认仅你可见。只有你确认分享的文字才会生成分享链接。',
      '照片和修改记录不会加入文字分享。'
    ]
  },

  async onShow() {
    this.setData({ usageAvailable: false, usageReport: '', usageVisible: false, usageEnabled: false, usageError: '',
      reviewAvailable: false, reviewError: '' });
    const app = getApp();
    const store = app && await app.ensureReady();
    if (!store) return;
    try { this.setData({ usageAvailable: Boolean(app.globalData.metrics), usageEnabled: Boolean(app.globalData.metrics && app.globalData.metrics.read().enabled), usageVisible: false, usageReport: '', usageError: '' }); }
    catch (err) { this.setData({ usageError: '使用统计暂时无法读取。' }); }
    try { this.setData({ reviewAvailable: Boolean(app.globalData.review), reviewEnabled: Boolean(app.globalData.review && app.globalData.review.isEnabled()) }); }
    catch (err) { this.setData({ reviewError: '回顾设置暂时无法读取。' }); }
  },
  onReviewSetting(event) {
    try {
      const review = getApp().globalData.review;
      review.setEnabled(event.detail.value);
      this.setData({ reviewEnabled: review.isEnabled(), reviewError: '' });
    } catch (err) { this.setData({ reviewError: '设置未保存，请稍后重试。' }); }
  },
  onUsageSetting(event) {
    try { const metrics = getApp().globalData.metrics; metrics.setEnabled(event.detail.value); this.setData({ usageEnabled: metrics.read().enabled, usageReport: '', usageVisible: false, usageError: '' }); }
    catch (err) { this.setData({ usageError: '统计设置未保存，请稍后重试。' }); }
  },
  onViewUsage() {
    try { this.setData({ usageReport: getApp().globalData.metrics.report(), usageVisible: true, usageError: '' }); }
    catch (err) { this.setData({ usageError: '统计暂时无法读取。' }); }
  },
  onCopyUsage() { if (this.data.usageReport) this.copyText(this.data.usageReport); },
  copyText(value) {
    try {
      wx.setClipboardData({
        data: value,
        success: () => wx.showToast({ title: '已复制', icon: 'none' }),
        fail: () => wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false })
      });
    } catch (err) {
      wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false });
    }
  },

  onShareAppMessage() {
    return { title: '灵感拾光簿｜让想法慢慢成形', path: '/pages/welcome/index',
      imageUrl: '/assets/brand-mark.png' };
  },

  onShareTimeline() {
    return { title: '灵感拾光簿｜让想法慢慢成形', query: '',
      imageUrl: '/assets/brand-mark.png' };
  },

  onOpenMyShares() {
    wx.navigateTo({ url: '/pages/my-shares/index' });
  },

  onOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  }
});
