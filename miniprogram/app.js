const cloudConfig = require('./config/cloud');
const aiConfig = require('./config/ai');

App({
  globalData: {
    cloudEnabled: cloudConfig.enabled,
    aiEnabled: aiConfig.enabled
  },

  onLaunch() {
    // 骨架版本：云环境与 AI 均未接入。
    // 接入前需取得授权、创建 linggan_* 资源并完成验收，详见 openspec/changes/add-inspiration-mvp/。
    if (!cloudConfig.enabled) {
      console.info('[灵感记录] 云能力未启用，当前仅为工程骨架，业务功能尚未实现。');
      return;
    }
    if (!wx.cloud) {
      console.error('[灵感记录] 当前基础库不支持云开发，请升级微信版本。');
      return;
    }
    wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
  }
});
