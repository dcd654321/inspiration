Page({
  data: {
    cloudEnabled: false,
    aiEnabled: false,

    // 面向使用者的措辞：不写「不写入日志」这类工程保证——用户读不懂，也不关心实现细节。
    // 也**不写**「数据只存在这台手机上」：那是把实现分层摊给用户看。
    privacyNote: '灵感和补充存在你的账号里，别的微信账户看不到。照片只给你自己看，不会被分享，也不会用于训练。删除灵感时，对应的照片会一起删掉。'
  },

  // 用 onShow 而不是 onLoad：能力开关将来可能变化，每次进页面都按当前值渲染
  onShow() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};

    this.setData({
      cloudEnabled: Boolean(globalData.cloudEnabled),
      aiEnabled: Boolean(globalData.aiEnabled)
    });
  }
});
