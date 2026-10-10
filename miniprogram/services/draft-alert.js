// 仅覆盖平台支持的页面返回；常驻页面说明承担手势返回和退出的风险提示。
function setDraftLeaveAlert(hasDraft) {
  try {
    if (hasDraft && typeof wx.enableAlertBeforeUnload === 'function') {
      wx.enableAlertBeforeUnload({ message: '这份稿件还没有另存，退出小程序后可能丢失。' });
    } else if (!hasDraft && typeof wx.disableAlertBeforeUnload === 'function') {
      wx.disableAlertBeforeUnload();
    }
  } catch (err) { /* 能力不可用时不阻断编辑，页面仍有可见说明。 */ }
}

module.exports = { setDraftLeaveAlert };
