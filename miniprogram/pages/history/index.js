const { formatAbsolute } = require('../../core/format');

Page({
  data: {
    ready: false,
    missing: false,
    versions: [],
    current: ''
  },

  onLoad(query) {
    this.id = (query && query.id) || '';
    this.load();
  },

  load() {
    const app = getApp();
    const store = app && app.globalData && app.globalData.store;
    const item = store ? store.getInspiration(this.id) : null;

    if (!item) {
      this.setData({ ready: true, missing: true });
      return;
    }

    const history = Array.isArray(item.textHistory) ? item.textHistory : [];

    this.setData({
      ready: true,
      missing: false,
      // 倒序：最近被替换掉的排在最上，往上翻就是更早的
      versions: history.slice().reverse().map((version) => ({
        id: version.id,
        text: version.text,
        // 这里用绝对时间而不是相对时间：几个版本放在一起比，谁先谁后要一眼看得出来
        time: formatAbsolute(version.replacedAt)
      })),
      current: item.text
    });
  }
});
