const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');
const { pageGuard } = require('../../services/page-session');

const DISPLAY_ERRORS = {
  EMPTY_TEXT: '写点内容再保存',
  TEXT_TOO_LONG: '正文最多 ' + LIMITS.textMaxLength + ' 字符'
};

/** 网络类失败不能推断服务端有没有写入——这类码是「结果未知」，不是「确定没保存」。 */
const UNKNOWN_CODES = ['NETWORK', 'INTERNAL'];

/** 校验失败时把错误码翻成人话。域层已经在 errors.js 里备好了面向用户的文案。 */
function messageFor(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return DISPLAY_ERRORS[err.errors[0].code] || '内容没有被保存，请检查后重试。';
  }
  return '内容没有被保存，请稍后重试。';
}

/**
 * 写了一半被打断是「随手记」的常见情境，而输入只存在会话内存里。
 * 输入和未确认内容开启平台支持的返回提示；提交中以可见状态为主。
 * **不做本机暂存**——那与「云端确认才算保存」的取舍冲突。
 * 写成模块级函数而不是页面方法：测试会用一个假 page 对象直接调 onInput，
 * 挂在 this 上的辅助方法在那种调用方式下不存在。
 */
function guardDraft(hasDraft) {
  try {
    if (hasDraft) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '尚未保存的内容会丢失。' });
    } else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  } catch (err) { /* 基础库不支持时只是少一层提醒，不阻断输入 */ }
}

Page({
  data: {
    draft: '',
    maxLength: LIMITS.textMaxLength,
    canSave: false,
    overBy: 0,
    nearLimit: false,
    saving: false,
    inputFocus: false,
    // '' = 可编辑；'unknown' = 结果未知（超时等）；'rejected' = 确认被拒绝（有确定回执）
    status: '',
    errorText: '',
    copyNotice: '',
    lastSavedId: '',
    lastSavedExcerpt: ''
  },

  async onShow() {
    this.visible = true;
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    const app = getApp(); await app.ensureReady();
    if (this.visible === false || this.viewVersion !== version) return;
    const scope = app.globalData.cacheScope;
    if (this.scope && scope && scope !== this.scope) {
      this.pendingSave = null;
      guardDraft(false);
      this.setData({ draft: '', canSave: false, overBy: 0, nearLimit: false, saving: false, status: '', errorText: '', copyNotice: '', lastSavedId: '', lastSavedExcerpt: '' });
    }
    if (scope) this.scope = scope;
    guardDraft(Boolean(this.data.draft));
  },

  onHide() {
    this.visible = false;
    this.viewVersion = (this.viewVersion || 0) + 1;
    if (this.data.saving) this.setData({ saving: false, status: 'unknown' });
    guardDraft(false);
  },

  onUnload() { this.onHide(); },

  onInput(event) {
    if (this.data.saving || this.visible === false) return;
    const value = event.detail.value;
    if (this.pendingSave && this.pendingSave.text !== value) this.pendingSave = null;
    const overBy = Math.max(0, value.length - LIMITS.textMaxLength);
    const canEdit = value.trim().length > 0 && overBy === 0;
    // 结果未知时输入框仍然可用：用户改了内容就回到普通编辑态，旧的未确认状态随之撤下
    guardDraft(Boolean(value));
    this.setData({
      draft: value,
      canSave: canEdit,
      overBy,
      // 超过上限 90% 时计数器转警示色
      nearLimit: value.length > LIMITS.textMaxLength * 0.9,
      status: '',
      errorText: '',
      copyNotice: '',
      // 用户重新开始输入就清掉上一条成功卡与失败提示——它们还挂着只会让人以为说的是这次
      lastSavedId: '',
      lastSavedExcerpt: ''
    });
  },

  onFocus() { this.setData({ inputFocus: false }); },

  async onSave() {
    if (this.data.saving || this.visible === false) return;

    const text = this.data.draft;
    if (text.trim().length === 0 || text.length > LIMITS.textMaxLength) return; // 按钮已 disabled，这里是兜底

    const app = getApp();
    const version = this.viewVersion, preparationEpoch = app.globalData.sessionEpoch, preparationStore = app.globalData.store;
    const preparationScope = this.scope || app.globalData.cacheScope;
    // 从准备账户开始锁定快照，避免等待 ensureReady 时产生重复提交或新输入。
    this.setData({ saving: true, status: '', errorText: '', copyNotice: '', lastSavedId: '', lastSavedExcerpt: '' });
    let store;
    try { store = app && await app.ensureReady(); } catch (err) { store = null; }
    if (this.visible === false || this.viewVersion !== version ||
        (preparationScope && app.globalData.cacheScope && preparationScope !== app.globalData.cacheScope) ||
        (preparationStore && (app.globalData.sessionEpoch !== preparationEpoch || app.globalData.store !== preparationStore))) {
      if (this.visible !== false && this.viewVersion === version) this.setData({ saving: false });
      return;
    }
    if (!store) {
      this.setData({ saving: false, status: 'rejected', errorText: app && app.globalData.accountError || '暂时无法确认账户，请联网后重试。', copyNotice: '' });
      return;
    }
    const epoch = app.globalData.sessionEpoch;

    // 当前会话内重试同一内容时复用记录标识；不会把待写内容持久化到设备。
    let inspiration;
    try {
      inspiration = this.pendingSave && this.pendingSave.text === text && this.pendingSave.scope === app.globalData.cacheScope
        ? this.pendingSave.item : createInspiration({ text, id: createId('insp'), now: Date.now() });
      this.pendingSave = { text, scope: app.globalData.cacheScope, item: inspiration };
    } catch (err) {
      this.setData({ saving: false, status: 'rejected', errorText: messageFor(err), copyNotice: '' });
      return;
    }

    // 提交中冻结提示层：不再提示「退出会丢」，避免和「正在保存」互相矛盾
    guardDraft(false);
    this.setData({ saving: true, status: '', errorText: '', copyNotice: '', lastSavedId: '', lastSavedExcerpt: '' });
    let result;
    let threw = false;
    try {
      result = await store.saveInspiration(inspiration);
    } catch (err) {
      threw = true;
    }
    if (this.visible === false || this.viewVersion !== version || app.globalData.sessionEpoch !== epoch || app.globalData.store !== store) return;
    this.setData({ saving: false });
    const metrics = app.globalData.store === store && app.globalData.metrics;
    if (metrics) metrics.track(result && result.ok && result.synced === true ? 'record_saved' : 'save_failed');

    if (!threw && result && result.ok && result.synced === true) {
      this.pendingSave = null;
      guardDraft(false);
      this.setData({
        draft: '', canSave: false, overBy: 0, nearLimit: false, status: '', errorText: '', copyNotice: '',
        lastSavedId: inspiration.id, lastSavedExcerpt: text
      });
      return;
    }

    const code = threw ? 'NETWORK' : (result && result.code) || 'NETWORK';
    guardDraft(Boolean(this.data.draft));
    if (UNKNOWN_CODES.includes(code)) {
      // 超时、连接中断：不能宣布失败，也不能假装成功。内容确实还在输入框里。
      this.setData({ status: 'unknown', errorText: '', copyNotice: '' });
      return;
    }
    this.setData({
      status: 'rejected',
      errorText: result && typeof result.message === 'string' && result.message ? result.message : '内容没有被保存，请稍后重试。',
      copyNotice: ''
    });
  },

  /** 重试复用同一记录标识（同上一条 pendingSave），不会因为重试产生第二条记录。 */
  onRetrySave() { return this.onSave(); },

  onCopyDraft() {
    const text = this.data.draft;
    if (!text || this.visible === false) return;
    const isCurrent = pageGuard(this);
    try {
      wx.setClipboardData({
        data: text,
        success: () => { if (isCurrent()) this.setData({ copyNotice: '已复制，可粘贴到需要的地方。' }); },
        fail: () => { if (isCurrent()) this.setData({ copyNotice: '复制未完成，请重试。' }); }
      });
    } catch (err) {
      if (isCurrent()) this.setData({ copyNotice: '复制未完成，请重试。' });
    }
  },

  onContinueSupplement() {
    if (!this.data.lastSavedId) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.lastSavedId) + '&focus=supplement' });
  },

  onRecordAnother() {
    this.setData({ lastSavedId: '', lastSavedExcerpt: '', inputFocus: true });
  }
});
