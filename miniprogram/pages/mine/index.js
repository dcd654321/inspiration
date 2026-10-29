const { createAppShare, createTimelineShare } = require('../../services/product-presentation');

Page({
  data: {
    expandedInfo: '',
    privacyNotes: [
      '为改善体验，我们会按账户哈希统计使用时长、记录与整理操作数量、故障类型及响应耗时。统计不包含灵感正文、照片或搜索内容。'
    ],
    helpNotes: [
      '在「记录」写下一句话，保存后可到「灵感」查看。',
      '打开一条灵感，继续补充文字或附上照片。',
      '在「灵感」选择素材，手动整理成稿，再复制或导出。',
      '暂时不再整理的灵感可在详情的「更多」中归档，到「已归档」查看或取消归档。'
    ]
  },

  onOpenArchived() { wx.navigateTo({ url: '/pages/archived/index' }); },

  onToggleInfo(event) {
    const section = event && event.currentTarget && event.currentTarget.dataset.section;
    if (section !== 'privacy' && section !== 'help') return;
    this.setData({ expandedInfo: this.data.expandedInfo === section ? '' : section });
  },

  onShareAppMessage() { return createAppShare(); },

  onShareTimeline() { return createTimelineShare(); },

  /**
   * 自建反馈页的入口目前在 WXML 里隐藏（云环境未联通，提交无法落库与查阅）；
   * 方法与页面保留，云环境接通后把按钮加回「意见反馈」区块即可。
   */
  onOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  }
});
