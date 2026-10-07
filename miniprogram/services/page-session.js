'use strict';

function beginPage(page) {
  page.visible = true;
  page.viewVersion = (page.viewVersion || 0) + 1;
}

function endPage(page) {
  page.visible = false;
  page.viewVersion = (page.viewVersion || 0) + 1;
}

function pageGuard(page) {
  const app = getApp(), version = page.viewVersion;
  const { sessionEpoch, store } = app.globalData;
  return () => page.visible !== false && page.viewVersion === version &&
    app.globalData.sessionEpoch === sessionEpoch && app.globalData.store === store;
}

async function readPageAccount(page) {
  const app = getApp(), version = page.viewVersion;
  let store = null, epoch = app.globalData.sessionEpoch;
  try {
    const pending = app.ensureReady();
    // ensureReady 可以同步启动新账户会话，绑定该次启动后的版本。
    epoch = app.globalData.sessionEpoch;
    store = await pending;
  } catch (err) { /* 读取错误由调用页面提供重试入口。 */ }
  const isCurrent = () => page.visible !== false && page.viewVersion === version &&
    app.globalData.sessionEpoch === epoch && (!store || app.globalData.store === store);
  return { app, store, epoch, isCurrent };
}

module.exports = { beginPage, endPage, pageGuard, readPageAccount };