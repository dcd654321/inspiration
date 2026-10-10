const { loadPrivatePhotos } = require('../../services/private-photos');
const { beginPage, endPage, readPageAccount } = require('../../services/page-session');
Page({
  data: { photos: [], current: 0, error: '', loading: false },
  async onLoad(query) {
    beginPage(this);
    this.query = query || {};
    this.alive = true;
    const version = this.readVersion = (this.readVersion || 0) + 1;
    this.setData({ photos: [], error: '', loading: true });
    const pending = readPageAccount(this);
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    const account = await pending;
    const isCurrent = () => account.isCurrent() && this.alive && this.readVersion === version;
    if (!isCurrent()) return;
    if (!account.store) {
      this.setData({ error: '暂时无法读取照片，请稍后重试。', loading: false }); return;
    }
    this.epoch = account.epoch;
    this.sessionStore = account.store;
    const item = account.store.getInspiration(this.query.id);
    const photos = await loadPrivatePhotos(item && item.photos || [], {
      cacheScope: account.app.globalData.cacheScope, isCurrent
    });
    if (!isCurrent()) return;
    this.setData({ photos,
      current: Math.max(0, photos.findIndex((x) => x.id === this.query.photo)), loading: false,
      error: !photos.length ? '没有可查看的照片。' : photos.some((photo) => photo.failed) ? '照片未加载' : ''
    });
  },
  onReload() { if (this.query && !this.data.loading) return this.onLoad(this.query); },
  async onShow() {
    const app = getApp();
    if (this.query && (!this.alive || (this.data.loading && this.loadingEpoch !== app.globalData.sessionEpoch) || (this.epoch !== undefined &&
        (this.epoch !== app.globalData.sessionEpoch || this.sessionStore !== app.globalData.store)))) await this.onLoad(this.query);
  },
  onHide() {
    endPage(this);
    this.alive = false;
    this.readVersion = (this.readVersion || 0) + 1;
    this.setData({ photos: [], loading: false });
  },
  onUnload() { this.onHide(); },
  onImageError() { if (this.alive) this.setData({ error: '照片未加载' }); },
  onChange(event) { if (this.alive) this.setData({ current: event.detail.current }); }
});
