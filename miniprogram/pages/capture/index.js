const { LIMITS } = require('../../core/limits');

Page({
  data: {
    draft: '',
    maxLength: LIMITS.textMaxLength
  },

  onInput(event) {
    this.setData({ draft: event.detail.value });
  },

  onSave() {
    // 骨架版本：保存链路尚未实现，云环境与集合均未创建。
    // 实施见 openspec/changes/add-inspiration-mvp/tasks.md 第 3.1 与第 6 节。
    wx.showToast({ title: '骨架版本尚未实现保存', icon: 'none' });
  }
});
