const { formatAbsolute, summarize, countLabel } = require('../../core/format');
const { activeSupplements, isArchived, isDeleted, isMerged } = require('../../core/inspiration');
const { searchInspirations } = require('../../services/discovery');
const { STAGES } = require('../../services/organization');

function syncAccount(page) {
  const { store, sessionEpoch, cacheScope } = getApp().globalData;
  if (page.store !== store || page.epoch !== sessionEpoch || page.scope !== cacheScope || !store) {
    page.setData({ items: [], count: 0, query: '', error: '' });
  }
  page.store = store; page.epoch = sessionEpoch; page.scope = cacheScope;
}

Page({
  data: { items: [], count: 0, query: '', loading: true, error: '' },

  async onShow() {
    this.visible = true;
    const version = this.version = (this.version || 0) + 1;
    syncAccount(this);
    this.setData({ loading: true, error: '' });
    try { await getApp().ensureReady(); } catch (err) { /* 由当前账户状态显示重试。 */ }
    if (!this.visible || this.version !== version) return;
    syncAccount(this); this.load();
  },

  onHide() { this.visible = false; this.version = (this.version || 0) + 1; },
  onUnload() { this.onHide(); },

  load() {
    syncAccount(this);
    if (!this.store) {
      this.setData({ loading: false, error: getApp().globalData.accountError || '请稍后重试。' });
      return;
    }
    try {
      const rows = this.store.readSnapshot().inspirations;
      const count = rows.filter((item) => item && !isDeleted(item) && !isMerged(item) && isArchived(item)).length;
      const items = searchInspirations(rows, { archived: true, query: this.data.query }).map(({ item, matchText, matchSource }) => ({
        id: item.id, excerpt: summarize(item.text, 60), time: formatAbsolute(item.archivedAt),
        stage: (STAGES.find((entry) => entry.id === item.stage) || STAGES[0]).label,
        tags: (item.tags || []).slice(0, 2), supplements: countLabel(activeSupplements(item).length, '条补充'),
        photos: (item.photos || []).length, matchText, matchSource
      }));
      this.setData({ items, count, loading: false, error: '' });
    } catch (err) {
      this.setData({ loading: false, error: this.data.items.length ? '暂时无法更新，仍显示上次读取的内容。' : '请稍后重试。' });
    }
  },

  async onRetry() {
    if (this.data.loading) return;
    syncAccount(this);
    const version = this.version = (this.version || 0) + 1;
    const store = this.store, epoch = this.epoch;
    this.setData({ loading: true, error: '' });
    let result;
    try {
      if (store) result = await store.refresh();
      else { await getApp().refreshAccount(); result = { ok: true }; }
    } catch (err) { result = null; }
    if (!this.visible || this.version !== version) return;
    const app = getApp();
    if (epoch !== app.globalData.sessionEpoch || store && store !== app.globalData.store) {
      syncAccount(this); this.load(); return;
    }
    if (!result || !result.ok) {
      this.setData({ loading: false, error: this.data.items.length ? '暂时无法更新，仍显示上次读取的内容。' : '请稍后重试。' });
      return;
    }
    this.load();
  },

  onSearch(event) { this.setData({ query: event.detail.value }); this.load(); },
  onClearQuery() { this.setData({ query: '' }); this.load(); },
  onOpen(event) {
    const app = getApp();
    if (!this.visible || this.store !== app.globalData.store || this.epoch !== app.globalData.sessionEpoch) {
      syncAccount(this); this.load(); return;
    }
    const id = event.currentTarget.dataset.id;
    const item = this.store && this.store.getInspiration(id);
    if (!item || !isArchived(item) || isDeleted(item) || isMerged(item)) { this.load(); return; }
    const metrics = app.globalData.metrics;
    if (metrics && this.data.query) metrics.track('search_opened');
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
