Page({
  data: {
    inspirations: []
  },

  onAdd() {
    wx.switchTab({ url: '/pages/capture/index' });
  }
});
