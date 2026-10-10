Page({
  data: {
    expandedInfo: '',
    privacyNotes: [
      '灵感默认仅你可见。只有你确认分享的文字才会生成分享链接。',
      '照片和修改记录不会加入文字分享。'
    ],
    helpNotes: [
      '在「记录」写下一句话，保存后可到「灵感」查看。',
      '打开一条灵感，继续补充文字或附上照片。',
      '在「灵感」选择素材，手动整理成稿，再复制、导出或主动分享。'
    ]
  },

  onToggleInfo(event) {
    const section = event && event.currentTarget && event.currentTarget.dataset.section;
    if (section !== 'privacy' && section !== 'help') return;
    this.setData({ expandedInfo: this.data.expandedInfo === section ? '' : section });
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

  /**
   * 自建反馈页的入口目前在 WXML 里隐藏（云环境未联通，提交无法落库与查阅）；
   * 方法与页面保留，云环境接通后把按钮加回「意见反馈」区块即可。
   */
  onOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  }
});
