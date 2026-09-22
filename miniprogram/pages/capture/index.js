const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');
const { ERROR_MESSAGES } = require('../../core/errors');

/** 校验失败时把错误码翻成人话。域层已经在 errors.js 里备好了面向用户的文案。 */
function messageFor(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return ERROR_MESSAGES[err.errors[0].code] || '内容不合规。';
  }
  return '这条没能存下来。';
}

Page({
  data: {
    draft: '',
    maxLength: LIMITS.textMaxLength,
    nearLimit: false,
    saving: false,
    error: ''
  },

  onInput(event) {
    const value = event.detail.value;
    this.setData({
      draft: value,
      // 超过上限 90% 时计数器转警示色
      nearLimit: value.length > LIMITS.textMaxLength * 0.9,
      // 用户重新开始输入就清掉上一条失败提示——它还挂着只会让人以为又失败了
      error: ''
    });
  },

  async onSave() {
    if (this.data.saving) return;

    const text = this.data.draft;
    if (text.trim().length === 0) return;   // 按钮已 disabled，这里是兜底

    const app = getApp();
    if (!app || !app.globalData.store) {
      this.setData({ error: '还没准备好，稍后再试。' });
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

    this.setData({ saving: true, error: '' });
    const result = await app.globalData.store.saveInspiration(inspiration);
    this.setData({ saving: false });

    if (!result.ok) {
      // 本机都没存下来。**必须保留输入**——清掉就等于把用户刚写的东西弄丢了。
      this.setData({ error: '存储空间不够了，这条没能存下来。' });
      return;
    }

    // 到这里内容一定已经落在本机了，所以输入框照常清空。
    // 留着反而会让用户重复提交一遍。
    this.setData({ draft: '', nearLimit: false });

    if (result.synced) {
      wx.showToast({ title: '已保存', icon: 'none' });
      return;
    }

    // 同步未成功：既不能只说「已保存」（用户会以为云端也有了），
    // 也不能说「没保存成功」（内容确实已经在本机，谎报会让他重打一遍）。
    this.setData({ error: '已保存。还没同步到云端，会自动重试。' });
  }
});
