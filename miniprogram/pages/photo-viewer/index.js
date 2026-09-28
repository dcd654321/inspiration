const { loadPrivatePhotos } = require('../../services/private-photos');
Page({
  data: { photos: [], current: 0, error: '' },
  async onLoad(query) {
    this.query = query || {}; this.alive = true;
    const version = this.readVersion = (this.readVersion || 0) + 1;
    const app = getApp(), store = await app.ensureReady();
    if (!this.alive || this.readVersion !== version || !store) return;
    this.epoch = app.globalData.sessionEpoch;
    let item;
    if (/^\d+$/.test(this.query.recovery || '')) {
      const recovery = store.getRecoveries()[Number(this.query.recovery)];
      item = recovery && recovery.snapshot.inspirations.find((x) => x.id === this.query.id);
    } else if (this.query.remote === '1') {
      const conflict = store.getConflict(); item = conflict && conflict.remote && conflict.remote.inspirations.find((x) => x.id === this.query.id);
    } else item = store.getInspiration(this.query.id);
    const source = item && item.photos || [];
    const epoch = this.epoch;
    const isCurrent = () => this.alive && this.readVersion === version && app.globalData.sessionEpoch === epoch && app.globalData.store === store;
    this.setData({ photos: [], error: source.length ? '照片加载中…' : '没有可查看的照片。' });
    const photos = await loadPrivatePhotos(source, { cacheScope: app.globalData.cacheScope, isCurrent });
    if (!isCurrent()) return;
    this.setData({ photos, current: Math.max(0, photos.findIndex((x) => x.id === this.query.photo)), error: !photos.length ? '没有可查看的照片。' : photos.some((photo) => photo.failed) ? '部分照片暂时无法加载，请返回后重试。' : '' });
  },
  async onShow() { if (this.query && !this.alive) await this.onLoad(this.query); },
  onHide() { this.alive = false; this.readVersion = (this.readVersion || 0) + 1; this.setData({ photos: [] }); },
  onUnload() { this.onHide(); },
  onImageError() { this.setData({ error: '照片暂时无法加载，文件可能已被删除或当前没有访问权限。恢复副本只保留原引用，不会重新生成照片。' }); },
  onChange(event) { this.setData({ current: event.detail.current }); }
});
