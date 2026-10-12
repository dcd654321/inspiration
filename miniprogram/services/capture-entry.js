'use strict';

/** 明确的记录入口消费旧成功卡；未提交输入仍由记录页接续。 */
function startCapture() {
  const app = getApp();
  const intent = { epoch: app.globalData.sessionEpoch, expiresAt: Date.now() + 5 * 60 * 1000 };
  app.globalData.captureStartIntent = intent;
  wx.switchTab({ url: '/pages/capture/index', fail: () => {
    if (app.globalData.captureStartIntent === intent) delete app.globalData.captureStartIntent;
  } });
}

module.exports = { startCapture };
