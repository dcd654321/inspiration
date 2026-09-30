/**
 * 启动过渡页：冷启动读取云端快照（账号确认 + snapshot.pull）期间的品牌时刻。
 *
 * 三条原则：
 *   1. **读完就走。** 不设最短停留时间——「随手记」的应用不该为了好看拖延可以开始写的时间。
 *   2. **不空转。** 云能力没开（离线样例、旧基础库）就直接进入记录页；读取失败给出原因、
 *      重试与「先进入记录页」两条出路，与「账务未就绪时文字输入仍可用」的既有行为一致。
 *   3. **不假装。** 状态文字只说正在做什么；失败时展示的原因来自既有的账户错误文案，不编造。
 */
Page({
  data: {
    loading: true,
    failed: false,
    // 连接特别慢时把「重试 / 先进入记录页」露出来，不让页面永远转圈
    slow: false,
    error: ''
  },

  onLoad() {
    this.alive = true;
    const app = getApp();
    // 没有可读的云能力时不空转：直接进入记录页
    if (!app.globalData.cloudEnabled || !wx.cloud) { this.enter(); return; }
    this.armSlowTimer();
    return this.settle(app.ensureReady());
  },

  onUnload() { this.alive = false; this.clearSlowTimer(); },

  /** 读取结论：拿到 store 即进入；拿不到（网络/账户失败）落到失败态。 */
  settle(promise) {
    return Promise.resolve(promise).then((store) => {
      if (!this.alive) return;
      if (store) this.enter();
      else this.fail(getApp().globalData.accountError);
    }).catch(() => {
      if (!this.alive) return;
      this.fail(getApp().globalData.accountError);
    });
  },

  enter() {
    if (!this.alive) return;
    this.clearSlowTimer();
    wx.switchTab({ url: '/pages/capture/index' });
  },

  fail(message) {
    if (!this.alive) return;
    this.clearSlowTimer();
    this.setData({ loading: false, failed: true, slow: false,
      error: message || '暂时无法确认账户，请联网后重试。' });
  },

  onRetry() {
    this.setData({ loading: true, failed: false, slow: false, error: '' });
    this.armSlowTimer();
    return this.settle(getApp().refreshAccount());
  },

  onEnterAnyway() { this.enter(); },

  // 慢读取兜底。拆成方法而不是内联箭头：测试可以直接调 markSlow 验证，不用假造计时器。
  armSlowTimer() {
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => this.markSlow(), 8000);
  },

  markSlow() {
    if (this.alive && this.data.loading && !this.data.failed) this.setData({ slow: true });
  },

  clearSlowTimer() {
    if (this.slowTimer) { clearTimeout(this.slowTimer); this.slowTimer = null; }
  }
});
