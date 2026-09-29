const { formatRelative, summarize, countLabel } = require('../../core/format');
const { activeSupplements } = require('../../core/inspiration');
const { searchInspirations } = require('../../services/discovery');
const { STAGES } = require('../../services/organization');

/** 把一条灵感转成列表项要显示的样子。转换集中在这里，WXML 里就只做渲染。 */
function decorate(inspiration, now) {
  const activeCount = activeSupplements(inspiration).length;
  return {
    id: inspiration.id,
    excerpt: summarize(inspiration.text, 60),
    time: formatRelative(inspiration.updatedAt, now),
    supplements: countLabel(activeCount, '条补充')
    , stageLabel: (STAGES.find((x) => x.id === inspiration.stage) || STAGES[0]).label,
    tags: inspiration.tags || [], merged: Boolean(inspiration.mergedInto)
  };
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    query: '',
    filter: 'all',
    stage: '',
    stages: [{ id: '', label: '全部阶段' }].concat(STAGES),
    stageIndex: 0,
    aiEnabled: false,
    total: 0,
    reviewItem: null,
    reviewEnabled: true,
    reviewError: ''
  },

  // 用 onShow 而不是 onLoad：从详情页返回时列表要跟着更新（改了原文、加了补充）
  async onShow() {
    this.setData({ items: [], reviewItem: null, loading: true, error: '' });
    const app = getApp();
    if (app) await app.ensureReady();
    this.load();
  },

  load() {
    const app = getApp();
    if (!app || !app.globalData.store) {
      this.setData({ loading: false, error: app && app.globalData.accountError || '暂时无法确认账户，请联网后重试。' });
      return;
    }

    try {
      const now = Date.now();
      const list = app.globalData.store.listInspirations();
      let reviewItem = null;
      let reviewEnabled = true;
      let reviewError = '';
      try {
        const review = app.globalData.review;
        if (review) {
          reviewEnabled = review.isEnabled();
          const item = review.getRecommendation(list);
          reviewItem = item ? decorate(item, now) : null;
        }
      } catch (err) { reviewError = '回顾设置暂时无法保存，请稍后重试。'; }
      this.setData({
        items: searchInspirations(this.data.filter === 'merged' ? app.globalData.store.readSnapshot().inspirations : list, { query: this.data.query, filter: this.data.filter, stage: this.data.stage, now })
          .map((result) => Object.assign(decorate(result.item, now), { matchText: result.matchText, matchSource: result.matchSource })),
        total: list.length,
        aiEnabled: app.globalData.aiEnabled,
        reviewItem, reviewEnabled, reviewError,
        loading: false,
        error: ''
      });
    } catch (err) {
      // 读失败时**保留已经渲染出来的内容**，不因为刷新失败就把列表清空——
      // 用户看到空白会以为自己的灵感没了。
      this.setData({
        loading: false,
        error: '暂时无法刷新，当前内容仍可查看。'
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
  onClearSearch() { this.setData({ query: '', filter: 'all', stage: '', stageIndex: 0 }); this.load(); },
  onStageFilter(event) { const index = Number(event.detail.value); this.setData({ stageIndex: index, stage: this.data.stages[index].id }); this.load(); },
  onSummarize() { wx.navigateTo({ url: '/pages/ai-workbench/index?scope=inspirations' }); },
  onMaterialOutput() { wx.navigateTo({ url: '/pages/material-output/index' }); },
  onFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (!['all', 'supplemented', 'recent', 'merged'].includes(filter)) return;
    this.setData({ filter }); this.load();
  },
  onDismissReview() {
    try { getApp().globalData.review.dismiss(); this.setData({ reviewItem: null, reviewError: '' }); }
    catch (err) { this.setData({ reviewError: '暂时无法跳过，请稍后重试。' }); }
  },
  onReviewSetting(event) {
    try { getApp().globalData.review.setEnabled(event.detail.value); this.load(); }
    catch (err) { this.setData({ reviewEnabled: this.data.reviewEnabled, reviewError: '设置未保存，请稍后重试。' }); }
  },

  onOpen(event) {
    const id = event.currentTarget.dataset.id;
    const metrics = getApp().globalData.metrics;
    if (metrics && this.data.query) metrics.track('search_opened');
    if (metrics && event.currentTarget.dataset.review) metrics.track('review_opened');
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  }
});
