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
    const current = Math.max(0, photos.findIndex((x) => x.id === this.query.photo));
    this.setData({ photos,
      current, loading: false,
      error: !photos.length ? '没有可查看的照片。' : photos[current].failed ? '照片未加载，请重试。' : ''
    });
  },
  onReload() {
    if (this.query && this.alive && !this.data.loading) {
      const photo = this.data.photos[this.data.current];
      return this.onLoad(Object.assign({}, this.query, { photo: photo ? photo.id : this.query.photo }));
    }
  },
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
  onImageError(event) {
    const app = getApp();
    if (!this.alive || this.epoch !== app.globalData.sessionEpoch || this.sessionStore !== app.globalData.store) return;
    const { id, src } = event && event.currentTarget && event.currentTarget.dataset || {};
    if (!this.data.photos.some(photo => photo.id === id && photo.src === src && src)) return;
    const photos = this.data.photos.map(photo => photo.id === id && photo.src === src
      ? Object.assign({}, photo, { src: '', failed: true }) : photo);
    this.setData({ photos, error: photos[this.data.current] && photos[this.data.current].failed ? '照片未加载，请重试。' : '' });
  },
  onChange(event) {
    const app = getApp(), current = event.detail.current;
    if (!this.alive || this.epoch !== app.globalData.sessionEpoch || this.sessionStore !== app.globalData.store ||
        !Number.isInteger(current) || current < 0 || current >= this.data.photos.length) return;
    this.setData({ current, error: this.data.photos[current].failed ? '照片未加载，请重试。' : '' });
  }
});
