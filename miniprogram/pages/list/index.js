const { formatAbsolute, summarize, countLabel } = require('../../core/format');
const { activeSupplements, isDeleted, isMerged, isArchived } = require('../../core/inspiration');
const { searchInspirations } = require('../../services/discovery');
const { STAGES } = require('../../services/organization');
const { startCapture } = require('../../services/capture-entry');
const { todoCounts } = require('../../core/todo');

/** 把一条灵感转成列表项要显示的样子。转换集中在这里，WXML 里就只做渲染。 */
function decorate(inspiration) {
  const activeCount = activeSupplements(inspiration).length;
  const merged = Boolean(inspiration.mergedInto);
  const stage = STAGES.find((x) => x.id === inspiration.stage) || STAGES[0];
  const tags = inspiration.tags || [];
  const todos = todoCounts(inspiration);
  return {
    id: inspiration.id,
    excerpt: summarize(inspiration.text, 60),
    time: formatAbsolute(inspiration.updatedAt),
    supplements: countLabel(activeCount, '条补充'),
    photos: (inspiration.photos || []).length,
    todoSummary: todos.total ? '待办 ' + todos.pending + ' · 已办 ' + todos.done : '',
    // 默认阶段「想法」不单独占行——它没有区分度，占一行只是噪音
    stageLabel: merged ? '已合并' : (stage.id === STAGES[0].id ? '' : stage.label),
    tags: tags.slice(0, 2),
    tagMore: Math.max(0, tags.length - 2),
    merged
  };
}

function syncAccount(page, app) {
  const { store, sessionEpoch, cacheScope } = app.globalData;
  const changed = Object.prototype.hasOwnProperty.call(page, 'listEpoch') &&
    (store !== page.listStore || sessionEpoch !== page.listEpoch || cacheScope !== page.scope);
  if (changed || !store) {
    page.savedScrollTop = 0;
    page.anchorId = '';
    page.setData({ items: [], activeCount: 0, mergedCount: 0, archivedCount: 0,
      error: '', query: '', filter: 'all', recentOn: false, mergedOn: false,
      stage: '', stageIndex: 0 });
  }
  page.listStore = store;
  page.listEpoch = sessionEpoch;
  page.scope = cacheScope;
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    query: '',
    // 条件在顶部直接选择；七天内与阶段可叠加到当前记录类型上。
    filter: 'all',
    recentOn: false,
    mergedOn: false,
    stage: '',
    stages: [{ id: '', label: '全部阶段' }].concat(STAGES),
    stageIndex: 0,
    activeCount: 0,
    mergedCount: 0,
    archivedCount: 0
  },

  // 用 onShow 而不是 onLoad：从详情页返回时列表要跟着更新（改了原文、加了补充）
  async onShow() {
    const app = getApp();
    if (!app || !app.globalData) return;
    this.visible = true;
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    syncAccount(this, app);
    this.setData({ loading: true, error: '' });
    try { await app.ensureReady(); } catch (err) { /* load 按当前可信账户显示恢复入口。 */ }
    if (this.visible === false || version !== this.viewVersion) return;
    this.load({ restoreScroll: true });
  },

  onHide() { this.visible = false; this.viewVersion = (this.viewVersion || 0) + 1; },
  onUnload() { this.onHide(); },

  onPageScroll(event) { this.savedScrollTop = event.scrollTop; },

  /** 同账户返回时回到离开前的阅读位置；首个可见记录由 anchorId 定位，找不到就退回原偏移 */
  restoreScroll() {
    const scrollTop = this.savedScrollTop || 0;
    if (scrollTop <= 0 || typeof wx.pageScrollTo !== 'function') return;
    try {
      if (this.anchorId) wx.pageScrollTo({ selector: '#row-' + this.anchorId, duration: 0 });
      else wx.pageScrollTo({ scrollTop, duration: 0 });
    } catch (err) { /* 定位不到就保持当前滚动位置 */ }
  },

  /** 账户变化：查询、筛选与阅读位置一律清空，不把上一个账户的条件带进新会话 */
  resetViewState() {
    this.savedScrollTop = 0;
    this.anchorId = '';
    this.setData({ query: '', filter: 'all', recentOn: false, mergedOn: false, stage: '', stageIndex: 0 });
  },

  load(options) {
    const opts = options || {};
    const app = getApp();
    if (!app || !app.globalData) return;
    syncAccount(this, app);

    const store = app.globalData.store;
    if (!store) {
      this.setData({ loading: false, error: app.globalData.accountError || '请稍后重试。', items: [], activeCount: 0, mergedCount: 0, archivedCount: 0 });
      return;
    }

    try {
      const now = Date.now();
      const snapshot = store.readSnapshot();
      const active = store.listInspirations().filter((item) => !isArchived(item));
      // 真空态只在「有效记录与已合并记录都为 0、且读取成功」时成立；
      // 有条目但都被合并时，筛选入口必须保留
      const mergedCount = snapshot.inspirations.filter((item) => !isDeleted(item) && isMerged(item) && !isArchived(item)).length;
      const archivedCount = snapshot.inspirations.filter((item) => !isDeleted(item) && !isMerged(item) && isArchived(item)).length;
      const source = this.data.mergedOn ? snapshot.inspirations : active;
      this.setData({
        items: searchInspirations(source, {
          query: this.data.query,
          filter: this.data.mergedOn ? 'merged' : this.data.filter,
          recent: this.data.recentOn,
          stage: this.data.stage,
          now
        }).map((result) => Object.assign(decorate(result.item), { matchText: result.matchText, matchSource: result.matchSource })),
        activeCount: active.length,
        mergedCount,
        archivedCount,
        loading: false,
        error: ''
      }, () => { if (opts.restoreScroll) this.restoreScroll(); });
    } catch (err) {
      // 读失败时**保留已经渲染出来的内容**，不因为刷新失败就把列表清空——
      // 用户看到空白会以为自己的灵感没了。
      this.setData({
        loading: false,
        error: this.data.items.length ? '暂时无法更新，仍显示上次读取的内容。' : '请稍后重试。'
      }, () => { if (opts.restoreScroll) this.restoreScroll(); });
    }
  },

  async onRetry() {
    const app = getApp();
    if (!app || !app.globalData || this.data.loading) return;
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    syncAccount(this, app);
    const store = app.globalData.store, epoch = app.globalData.sessionEpoch;
    this.setData({ loading: true, error: '' });
    let result;
    try {
      if (store && typeof store.refresh === 'function') result = await store.refresh();
      else { await app.refreshAccount(); result = { ok: true }; }
    } catch (err) { result = null; }
    if (this.visible === false || version !== this.viewVersion) return;
    if (store && (store !== app.globalData.store || epoch !== app.globalData.sessionEpoch)) {
      syncAccount(this, app); this.load(); return;
    }
    if (!result || !result.ok) {
      this.setData({ loading: false, error: this.data.items.length
        ? '暂时无法更新，仍显示上次读取的内容。' : '请稍后重试。' });
      return;
    }
    this.load({ restoreScroll: true });
  },

  onAdd() {
    startCapture();
  },

  onSearch(event) { this.setData({ query: event.detail.value }); this.load(); },
  // 搜索框里的清空只清搜索词，不动筛选条件
  onClearQuery() { this.setData({ query: '' }); this.load(); },
  onFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (!['all', 'supplemented'].includes(filter)) return;
    this.setData({ filter, mergedOn: false }); this.load();
  },

  onToggleRecent() { this.setData({ recentOn: !this.data.recentOn }); this.load(); },
  onToggleMerged() { this.setData({ mergedOn: !this.data.mergedOn, filter: 'all' }); this.load(); },
  onStageFilter(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.stages[index]) return;
    this.setData({ stageIndex: index, stage: this.data.stages[index].id }); this.load();
  },
  // 重置所有筛选，保留搜索词。
  onResetFilters() {
    this.setData({ filter: 'all', recentOn: false, mergedOn: false, stage: '', stageIndex: 0 });
    this.load();
  },
  onClearAll() {
    this.setData({ query: '', filter: 'all', recentOn: false, mergedOn: false, stage: '', stageIndex: 0 });
    this.load();
  },
  onShowMerged() { this.setData({ mergedOn: true, filter: 'all' }); this.load(); },

  onShowArchived() { wx.navigateTo({ url: '/pages/archived/index' }); },

  onMaterialOutput() { wx.navigateTo({ url: '/pages/material-output/index' }); },

  onOpen(event) {
    const id = event.currentTarget.dataset.id;
    this.anchorId = id;
    const metrics = getApp().globalData.metrics;
    if (metrics && this.data.query) metrics.track('search_opened');
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
