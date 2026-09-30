const { formatAbsolute } = require('../../core/format');

Page({
  data: {
    ready: false,
    missing: false,
    // 读取失败（账户/网络）与「确认不存在」分开
    readError: false,
    versions: [],
    current: ''
  },

  async onLoad(query) {
    this.id = (query && query.id) || '';
    await getApp().ensureReady();
    this.load();
  },

  async onShow() {
    if (!this.id) return;
    this.setData({ ready: false, current: '', versions: [] });
    await getApp().ensureReady();
    this.load();
  },

  load() {
    const app = getApp();
    const store = app && app.globalData && app.globalData.store;
    if (!store) {
      this.setData({ ready: true, missing: false, readError: true, current: '', versions: [] });
      return;
    }
    const item = store.getInspiration(this.id);

    if (!item) {
      this.setData({ ready: true, missing: true, readError: false });
      return;
    }

    const history = Array.isArray(item.textHistory) ? item.textHistory : [];

    this.setData({
      ready: true,
      missing: false,
      readError: false,
      // 倒序：最近被替换掉的排在最上，往上翻就是更早的
      versions: history.slice().reverse().map((version) => ({
        id: version.id,
        text: version.text,
        // 这里用绝对时间而不是相对时间：几个版本放在一起比，谁先谁后要一眼看得出来
        time: formatAbsolute(version.replacedAt)
      })),
      current: item.text
    });
  },

  onRetryLoad() {
    const app = getApp();
    this.setData({ ready: false, readError: false });
    app.refreshAccount().then(() => { this.load(); });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.id) });
  },

  onBackToList() {
    wx.switchTab({ url: '/pages/list/index' });
  }
});
