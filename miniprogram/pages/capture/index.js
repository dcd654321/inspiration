const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');

const DISPLAY_ERRORS = {
  EMPTY_TEXT: '写点内容再保存',
  TEXT_TOO_LONG: '正文最多 ' + LIMITS.textMaxLength + ' 字'
};

/** 校验失败时把错误码翻成人话。域层已经在 errors.js 里备好了面向用户的文案。 */
function messageFor(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return DISPLAY_ERRORS[err.errors[0].code] || '暂时无法保存，请检查内容后重试。';
  }
  return '暂时无法保存，请稍后重试。';
}

Page({
  data: {
    draft: '',
    maxLength: LIMITS.textMaxLength,
    canSave: false,
    nearLimit: false,
    saving: false,
    error: '',
    success: '',
    lastSavedId: ''
  },

  onInput(event) {
    const value = event.detail.value;
    this.setData({
      draft: value,
      canSave: value.trim().length > 0,
      // 超过上限 90% 时计数器转警示色
      nearLimit: value.length > LIMITS.textMaxLength * 0.9,
      // 用户重新开始输入就清掉上一条失败提示——它还挂着只会让人以为又失败了
      error: '',
      success: '',
      lastSavedId: ''
    });
  },

  async onSave() {
    if (this.data.saving) return;

    const text = this.data.draft;
    if (text.trim().length === 0) return;   // 按钮已 disabled，这里是兜底

    const app = getApp();
    const store = app && await app.ensureReady();
    if (!store) {
      this.setData({ error: app && app.globalData.accountError || '暂时无法确认账户，请联网后重试。' });
      return;
    }

    // 标识由客户端生成：它同时是幂等键，重试不会产生第二条
    let inspiration;
    try {
      inspiration = createInspiration({ text, id: createId('insp'), now: Date.now() });
    } catch (err) {
      this.setData({ error: messageFor(err) });
      return;
    }

    this.setData({ saving: true, error: '', success: '', lastSavedId: '' });
    let result;
    try {
      result = await store.saveInspiration(inspiration);
    } catch (err) {
      this.setData({ saving: false, error: '暂时无法保存，内容还在，请稍后重试。' });
      return;
    }
    this.setData({ saving: false });

    if (!result || !result.ok) {
      // 本机都没存下来。**必须保留输入**——清掉就等于把用户刚写的东西弄丢了。
      this.setData({ error: result.code === 'CONFLICT' || result.code === 'STALE_GENERATION'
        ? '备份出现冲突，内容仍在输入框中。请到「我的」查看备份状态。'
        : '这条暂时没能存下来，内容仍在输入框中。' });
      return;
    }

    // 到这里内容一定已经落在本机了，所以输入框照常清空。
    // 留着反而会让用户重复提交一遍。
    this.setData({ draft: '', canSave: false, nearLimit: false, lastSavedId: inspiration.id });

    if (result.synced) {
      this.setData({ success: '已记下。可以继续记录，或查看刚才的想法。' });
      return;
    }

    // 同步未成功：既不能只说「已保存」（用户会以为云端也有了），
    // 也不能说「没保存成功」（内容确实已经在本机，谎报会让他重打一遍）。
    this.setData({ error: result.code === 'CONFLICT' || result.code === 'STALE_GENERATION'
      ? '已记下在当前设备，但备份发生冲突。请到「我的」查看处理提示，暂勿清理小程序数据。'
      : '已记下，但备份未完成。请暂时不要清理小程序数据。' });
  },

  onViewSaved() {
    if (!this.data.lastSavedId) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.lastSavedId) });
  }
});
