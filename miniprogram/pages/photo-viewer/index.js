const { loadPrivatePhotos } = require('../../services/private-photos');
Page({
  data: { photos: [], current: 0, error: '', loading: false },
  async onLoad(query) {
    this.query = query || {}; this.alive = true;
    const version = this.readVersion = (this.readVersion || 0) + 1;
    const app = getApp(), store = await app.ensureReady();
    if (!this.alive || this.readVersion !== version) return;
    if (!store) { this.setData({ photos: [], error: '暂时无法读取照片，请稍后重试。', loading: false }); return; }
    this.epoch = app.globalData.sessionEpoch;
    const item = store.getInspiration(this.query.id);
    const source = item && item.photos || [];
    const epoch = this.epoch;
    const isCurrent = () => this.alive && this.readVersion === version && app.globalData.sessionEpoch === epoch && app.globalData.store === store;
    this.setData({ photos: [], error: '', loading: true });
    const photos = await loadPrivatePhotos(source, { cacheScope: app.globalData.cacheScope, isCurrent });
    if (!isCurrent()) return;
    // 失败原因未知时不写「文件已删除」，只给重试入口
    this.setData({
      photos,
      current: Math.max(0, photos.findIndex((x) => x.id === this.query.photo)),
      loading: false,
      error: !photos.length ? '没有可查看的照片。' : photos.some((photo) => photo.failed) ? '照片未加载' : ''
    });
  },
  onReload() { if (this.query && !this.data.loading) this.onLoad(this.query); },
  async onShow() { if (this.query && !this.alive) await this.onLoad(this.query); },
  onHide() { this.alive = false; this.readVersion = (this.readVersion || 0) + 1; this.setData({ photos: [] }); },
  onUnload() { this.onHide(); },
  onImageError() { this.setData({ error: '照片未加载' }); },
  onChange(event) { this.setData({ current: event.detail.current }); }
});
