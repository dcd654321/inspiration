// 身份准备由 App 在后台完成，进入记录页后即可写下文字。
// 保存按钮仍等待可信账户及服务端确认，入口不额外等待 snapshot.pull。
Page({
  data: { loading: true, failed: false, slow: false, error: '' },
  onLoad() { this.alive = true; },
  onReady() { this.enter(); },
  onUnload() { this.alive = false; },
  enter() {
    if (!this.alive || this.entered) return;
    this.entered = true;
    wx.switchTab({ url: '/pages/capture/index', fail: () => {
      if (!this.alive) return;
      this.entered = false;
      this.setData({ loading: false, failed: true, error: '暂时无法打开记录页，请重试。' });
    } });
  },
  onRetry() { this.enter(); },
  onEnterAnyway() { this.enter(); }
});
