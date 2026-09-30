const { formatRelative, summarize, countLabel } = require('../../core/format');
const { activeSupplements, isDeleted, isMerged } = require('../../core/inspiration');
const { searchInspirations } = require('../../services/discovery');
const { STAGES } = require('../../services/organization');

/** 把一条灵感转成列表项要显示的样子。转换集中在这里，WXML 里就只做渲染。 */
function decorate(inspiration, now) {
  const activeCount = activeSupplements(inspiration).length;
  const merged = Boolean(inspiration.mergedInto);
  const stage = STAGES.find((x) => x.id === inspiration.stage) || STAGES[0];
  const tags = inspiration.tags || [];
  return {
    id: inspiration.id,
    excerpt: summarize(inspiration.text, 60),
    time: formatRelative(inspiration.updatedAt, now),
    supplements: countLabel(activeCount, '条补充'),
    // 默认阶段「想法」不单独占行——它没有区分度，占一行只是噪音
    stageLabel: merged ? '已合并' : (stage.id === STAGES[0].id ? '' : stage.label),
    tags: tags.slice(0, 2),
    tagMore: Math.max(0, tags.length - 2),
    merged
  };
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    query: '',
    // 默认筛选行只放「全部 / 有补充」；七天内、阶段、已合并都进筛选面板
    filter: 'all',
    recentOn: false,
    mergedOn: false,
    stage: '',
    stages: [{ id: '', label: '全部阶段' }].concat(STAGES),
    stageIndex: 0,
    panelOpen: false,
    panelCount: 0,
    activeCount: 0,
    mergedCount: 0,
    aiEnabled: false,
    reviewItem: null,
    reviewExpanded: false,
    reviewError: ''
  },

  // 用 onShow 而不是 onLoad：从详情页返回时列表要跟着更新（改了原文、加了补充）
  async onShow() {
    this.setData({ items: [], reviewItem: null, loading: true, error: '' });
    const app = getApp();
    if (app) await app.ensureReady();
    this.load({ restoreScroll: true });
  },

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
    this.setData({ query: '', filter: 'all', recentOn: false, mergedOn: false, stage: '', stageIndex: 0, panelOpen: false, panelCount: 0 });
  },

  load(options) {
    const opts = options || {};
    const app = getApp();
    if (!app || !app.globalData) return;
    const scope = app.globalData.cacheScope;
    if (this.scope && scope && scope !== this.scope) this.resetViewState();
    if (scope) this.scope = scope;

    const store = app.globalData.store;
    if (!store) {
      this.setData({ loading: false, error: app.globalData.accountError || '请稍后重试。', items: [], activeCount: 0, mergedCount: 0 });
      return;
    }

    try {
      const now = Date.now();
      const snapshot = store.readSnapshot();
      const active = store.listInspirations();
      // 真空态只在「有效记录与已合并记录都为 0、且读取成功」时成立；
      // 有条目但都被合并时，筛选入口必须保留
      const mergedCount = snapshot.inspirations.filter((item) => !isDeleted(item) && isMerged(item)).length;
      const source = this.data.mergedOn ? snapshot.inspirations : active;
      const plainView = !this.data.query && !this.data.recentOn && !this.data.stage && !this.data.mergedOn && this.data.filter === 'all';
      let reviewItem = null;
      let reviewError = '';
      try {
        const review = app.globalData.review;
        // 回顾行串在第一条记录之后；列表不足两条时不占位，不留空容器
        if (review && plainView && active.length >= 2) {
          const item = review.getRecommendation(active);
          reviewItem = item ? decorate(item, now) : null;
        }
      } catch (err) { reviewError = '回顾设置暂时无法保存，请稍后重试。'; }

      this.setData({
        items: searchInspirations(source, {
          query: this.data.query,
          filter: this.data.mergedOn ? 'merged' : this.data.filter,
          recent: this.data.recentOn,
          stage: this.data.stage,
          now
        }).map((result) => Object.assign(decorate(result.item, now), { matchText: result.matchText, matchSource: result.matchSource })),
        activeCount: active.length,
        mergedCount,
        aiEnabled: app.globalData.aiEnabled,
        reviewItem, reviewError,
        panelCount: (this.data.recentOn ? 1 : 0) + (this.data.stage ? 1 : 0) + (this.data.mergedOn ? 1 : 0),
        loading: false,
        error: ''
      }, () => { if (opts.restoreScroll) this.restoreScroll(); });
    } catch (err) {
      // 读失败时**保留已经渲染出来的内容**，不因为刷新失败就把列表清空——
      // 用户看到空白会以为自己的灵感没了。
      this.setData({
        loading: false,
        error: '请稍后重试。'
      });
    }
  },

  async onRetry() {
    const app = getApp();
    if (app) await app.refreshAccount();
    this.load();
  },

  onAdd() {
    wx.switchTab({ url: '/pages/capture/index' });
  },

  onSearch(event) { this.setData({ query: event.detail.value }); this.load(); },
  // 搜索框里的清空只清搜索词，不动筛选条件
  onClearQuery() { this.setData({ query: '' }); this.load(); },
  onFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (!['all', 'supplemented'].includes(filter)) return;
    this.setData({ filter }); this.load();
  },

  /** 面板本体上的点击不该穿透到遮罩，否则点哪都关。 */
  noop() {},

  onOpenPanel() { this.setData({ panelOpen: true }); },
  onClosePanel() { this.setData({ panelOpen: false }); },
  onToggleRecent() { this.setData({ recentOn: !this.data.recentOn }); this.load(); },
  onToggleMerged() { this.setData({ mergedOn: !this.data.mergedOn }); this.load(); },
  onStageFilter(event) { const index = Number(event.detail.value); this.setData({ stageIndex: index, stage: this.data.stages[index].id }); this.load(); },
  // 重置筛选只清面板内的条件，不清搜索词——要全清有「清空搜索和筛选」
  onResetPanel() {
    this.setData({ recentOn: false, mergedOn: false, stage: '', stageIndex: 0, panelOpen: false });
    this.load();
  },
  onClearAll() {
    this.setData({ query: '', filter: 'all', recentOn: false, mergedOn: false, stage: '', stageIndex: 0, panelOpen: false });
    this.load();
  },
  onShowMerged() { this.setData({ mergedOn: true, panelOpen: false }); this.load(); },

  onToggleReview() { this.setData({ reviewExpanded: !this.data.reviewExpanded }); },
  onDismissReview() {
    try { getApp().globalData.review.dismiss(); this.setData({ reviewItem: null, reviewExpanded: false, reviewError: '' }); }
    catch (err) { this.setData({ reviewError: '暂时无法跳过，请稍后重试。' }); }
  },

  onSummarize() { wx.navigateTo({ url: '/pages/ai-workbench/index?scope=inspirations' }); },
  onMaterialOutput() { wx.navigateTo({ url: '/pages/material-output/index' }); },

  onOpen(event) {
    const id = event.currentTarget.dataset.id;
    this.anchorId = id;
    const metrics = getApp().globalData.metrics;
    if (metrics && this.data.query) metrics.track('search_opened');
    if (metrics && event.currentTarget.dataset.review) metrics.track('review_opened');
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
