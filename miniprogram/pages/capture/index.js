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

  async onShow() {
    const app = getApp(); await app.ensureReady();
    const scope = app.globalData.cacheScope;
    if (this.scope && scope && scope !== this.scope) {
      this.pendingSave = null;
      this.setData({ draft: '', canSave: false, nearLimit: false, saving: false, lastSavedId: '', success: '', error: '' });
    }
    if (scope) this.scope = scope;
  },

  onInput(event) {
    const value = event.detail.value;
    if (this.pendingSave && this.pendingSave.text !== value) this.pendingSave = null;
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

    // 当前会话内重试同一内容时复用记录标识；不会把待写内容持久化到设备。
    let inspiration;
    try {
      inspiration = this.pendingSave && this.pendingSave.text === text && this.pendingSave.scope === app.globalData.cacheScope
        ? this.pendingSave.item : createInspiration({ text, id: createId('insp'), now: Date.now() });
      this.pendingSave = { text, scope: app.globalData.cacheScope, item: inspiration };
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
    if (app.globalData.store !== store) return;
    const metrics = app.globalData.store === store && app.globalData.metrics;
    if (metrics) metrics.track(result && result.ok && result.synced === true ? 'record_saved' : 'save_failed');
    if (!result || !result.ok || result.synced !== true) {
      this.setData({ error: '保存未完成，内容仍在输入框中。请联网后重试。' });
      return;
    }

    this.pendingSave = null;
    this.setData({ draft: '', canSave: false, nearLimit: false, lastSavedId: inspiration.id });
    this.setData({ success: '已记下。可以继续记录，或查看刚才的想法。' });
  },

  onViewSaved() {
    if (!this.data.lastSavedId) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.lastSavedId) });
  }
});
