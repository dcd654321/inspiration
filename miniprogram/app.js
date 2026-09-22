const cloudConfig = require('./config/cloud');
const aiConfig = require('./config/ai');
const { createStore } = require('./services/store');
const { createCaptureDrafts } = require('./services/capture-drafts');
const { createWxStorage } = require('./services/wx-storage');
const { createWxTransport } = require('./services/wx-transport');

App({
  globalData: {
    cloudEnabled: cloudConfig.enabled,
    aiEnabled: aiConfig.enabled,

    // 全应用共用一个本机状态与一个草稿区，页面通过 getApp().globalData 取用。
    // 草稿只在内存里，进程结束即消失——规范没有承诺它跨会话存在（detailed-design §7.6）。
    store: null,
    drafts: createCaptureDrafts()
  },

  onLaunch() {
    // 时间从这一层注入：core 与 services 内部都不调用 Date.now()，
    // 这样它们的测试才能用固定时间戳稳定断言。读时钟是应用入口的特权。
    this.globalData.store = createStore({
      storage: createWxStorage(),
      // 云未启用时传 null：保存跳过同步，照常成功（detailed-design §3.4）。
      // 启用后换成真实传输层——它是 store 里唯一跨出本机的那条路径。
      transport: cloudConfig.enabled
        ? createWxTransport({ functionName: cloudConfig.apiFunction })
        : null,
      now: () => Date.now()
    });

    // 云环境接入前需取得授权、创建 linggan_* 资源并完成验收，
    // 详见 openspec/changes/add-inspiration-mvp/。以下日志仅供开发者排查，不面向使用者。
    if (!cloudConfig.enabled) {
      console.info('[灵感拾光簿] 云能力未启用。');
      return;
    }
    if (!wx.cloud) {
      console.error('[灵感拾光簿] 当前基础库不支持云开发，请升级微信版本。');
      return;
    }
    wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
  }
});
