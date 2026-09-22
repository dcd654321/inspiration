const { LIMITS, createId } = require('../../core/limits');
const inspiration = require('../../core/inspiration');
const { formatRelative, formatAbsolute } = require('../../core/format');
const { ERROR_MESSAGES } = require('../../core/errors');

function messageFor(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return ERROR_MESSAGES[err.errors[0].code] || '内容不合规。';
  }
  return '这条没能存下来。';
}

function decorateSupplement(supplement, now) {
  return {
    id: supplement.id,
    content: supplement.content,
    time: formatRelative(supplement.createdAt, now),
    // 长按面板的标题要标明操作对象，不能让用户猜点的是哪条
    label: '这条补充 · ' + formatAbsolute(supplement.createdAt),
    // AI 产出必须带标记：规范要求如实标注，不得把本地结果说成 AI 生成
    isAi: supplement.source === 'ai',
    // 已并入原文的与已被汇总的，措辞必须不同——只写「合并」两个字用户分不清并到哪去了
    hiddenLabel: supplement.foldedAt ? '已并入灵感' : '已合并'
  };
}

Page({
  data: {
    ready: false,
    missing: false,

    // 原文可直接编辑（2026-09-22 修订，此前是只读的）
    text: '',
    time: '',
    editing: false,
    editDraft: '',
    editError: '',
    textMax: LIMITS.textMaxLength,

    // 时间线上正常显示的补充
    supplements: [],
    supplementDraft: '',
    supplementMax: LIMITS.supplementMaxLength,
    supplementError: '',

    // 因汇总或合并进灵感而收起的补充。**必须能展开、能恢复**——
    // 默认隐藏 + 没有入口 = 删除。
    hidden: [],
    hiddenExpanded: false,

    // 长按操作面板
    sheetVisible: false,
    sheetTargetId: '',
    sheetTargetLabel: '',
    sheetIsHidden: false,

    // 补充的行内修改
    editingSupplementId: '',
    supplementEditDraft: '',
    supplementEditError: '',

    // 删除确认弹窗
    confirmVisible: false,
    confirmQuote: '',
    confirmQuoteTime: '',

    historyCount: 0,
    error: ''
  },

  onLoad(query) {
    this.id = (query && query.id) || '';
    this.load({ resetDraft: true });
  },

  /** 面板本体上的点击不该穿透到遮罩，否则点哪都关。 */
  noop() {},

  // 从历史版本页返回时数据可能已变，重新读一次
  onShow() {
    if (this.id) this.load();
  },

  load(options) {
    const opts = options || {};
    const app = getApp();
    const store = app && app.globalData && app.globalData.store;
    const item = store ? store.getInspiration(this.id) : null;

    if (!item) {
      this.setData({ ready: true, missing: true });
      return;
    }

    const drafts = app.globalData.drafts;
    const now = Date.now();
    const next = {
      ready: true,
      missing: false,
      text: item.text,
      time: formatRelative(item.updatedAt, now),
      supplements: inspiration.activeSupplements(item).map((s) => decorateSupplement(s, now)),
      hidden: inspiration.mergedSupplements(item)
        .concat(inspiration.foldedSupplements(item))
        .map((s) => decorateSupplement(s, now)),
      historyCount: (item.textHistory || []).length
    };

    if (opts.resetDraft) {
      // 草稿从会话草稿区取回：切页回来时输入框里还应该有它
      next.supplementDraft = drafts ? drafts.get(this.id) : '';
      next.editing = false;
      next.editDraft = item.text;
      next.editError = '';
      next.supplementError = '';
    }

    this.setData(next);
  },

  /** 保存并刷新。所有写操作共用这一段，避免每个动作各写一遍成功/失败处理。 */
  async persist(next, failureMessage) {
    const app = getApp();
    const result = await app.globalData.store.saveInspiration(next);

    if (!result.ok) {
      return { ok: false, message: failureMessage };
    }
    if (!result.synced) {
      this.setData({ error: '已保存。还没同步到云端，会自动重试。' });
    }
    return { ok: true };
  },

  // ------------------------------------------------------------ 原文编辑

  onStartEdit() {
    this.setData({ editing: true, editDraft: this.data.text, editError: '' });
  },

  onEditInput(event) {
    this.setData({ editDraft: event.detail.value });
  },

  onCancelEdit() {
    this.setData({ editing: false, editDraft: this.data.text, editError: '' });
  },

  async onSaveEdit() {
    const store = getApp().globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let edited;
    try {
      // historyId 是必填的：让「改写但不留历史」在调用层面根本写不出来
      edited = inspiration.updateText(current, {
        text: this.data.editDraft,
        historyId: createId('tex'),
        now: Date.now()
      });
    } catch (err) {
      this.setData({ editError: messageFor(err) });
      return;
    }

    const result = await this.persist(edited, '存储空间不够了，这次修改没能存下来。');
    if (!result.ok) {
      this.setData({ editError: result.message });
      return;
    }

    this.setData({ editing: false, editError: '' });
    this.load({ resetDraft: true });
  },

  onOpenHistory() {
    wx.navigateTo({ url: '/pages/history/index?id=' + encodeURIComponent(this.id) });
  },

  // ------------------------------------------------------------ 追加补充

  onSupplementInput(event) {
    const value = event.detail.value;
    this.setData({ supplementDraft: value, supplementError: '' });

    // 同步进会话草稿区：写到一半切走，回来时这半句话还在
    const drafts = getApp().globalData.drafts;
    if (drafts) drafts.set(this.id, value);
  },

  async onSubmitSupplement() {
    const app = getApp();
    const store = app.globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      next = inspiration.appendSupplement(current, {
        content: this.data.supplementDraft,
        id: createId('sup'),
        now: Date.now()
      });
    } catch (err) {
      this.setData({ supplementError: messageFor(err) });
      return;
    }

    const result = await this.persist(next, '存储空间不够了，这条补充没能存下来。');
    if (!result.ok) {
      // 本机没存下来：**保留输入**，清掉就等于把用户刚写的补充弄丢了
      this.setData({ supplementError: result.message });
      return;
    }

    const drafts = app.globalData.drafts;
    if (drafts) drafts.clear(this.id);

    this.setData({ supplementDraft: '' });
    this.load({ resetDraft: true });
    wx.showToast({ title: '已提交', icon: 'none' });
  },

  // ------------------------------------------------------------ 长按操作面板

  onSupplementLongPress(event) {
    const id = event.currentTarget.dataset.id;
    const all = this.data.supplements.concat(this.data.hidden);
    const target = all.filter((s) => s.id === id)[0];
    if (!target) return;

    this.setData({
      sheetVisible: true,
      sheetTargetId: id,
      sheetTargetLabel: target.label,
      // 已收起的补充不提供「修改」：它已经不在时间线上正常显示，
      // 先恢复再改，用户才看得清自己在改什么
      sheetIsHidden: this.data.hidden.some((s) => s.id === id)
    });
  },

  onSheetDismiss() {
    this.setData({ sheetVisible: false, sheetTargetId: '', sheetTargetLabel: '', sheetIsHidden: false });
  },

  /** 修改：切到行内编辑。与原文编辑同一套规则，旧内容进这条补充自己的历史。 */
  onSheetEdit() {
    const id = this.data.sheetTargetId;
    const target = this.data.supplements.filter((s) => s.id === id)[0];
    this.setData({
      sheetVisible: false,
      editingSupplementId: id,
      supplementEditDraft: target ? target.content : '',
      supplementEditError: ''
    });
  },

  onSupplementEditInput(event) {
    this.setData({ supplementEditDraft: event.detail.value });
  },

  onSupplementEditCancel() {
    this.setData({ editingSupplementId: '', supplementEditDraft: '', supplementEditError: '' });
  },

  async onSupplementEditSave() {
    const store = getApp().globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      next = inspiration.editSupplement(current, {
        supplementId: this.data.editingSupplementId,
        content: this.data.supplementEditDraft,
        historyId: createId('chg'),
        now: Date.now()
      });
    } catch (err) {
      this.setData({ supplementEditError: messageFor(err) });
      return;
    }

    const result = await this.persist(next, '存储空间不够了，这次修改没能存下来。');
    if (!result.ok) {
      this.setData({ supplementEditError: result.message });
      return;
    }

    this.setData({ editingSupplementId: '', supplementEditDraft: '', supplementEditError: '' });
    this.load({ resetDraft: true });
  },

  /** 合并进灵感：内容追加到原文末尾，本条收起。合并前的原文进历史，一句话都不会消失。 */
  async onSheetFold() {
    const store = getApp().globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      next = inspiration.foldIntoText(current, {
        supplementId: this.data.sheetTargetId,
        historyId: createId('tex'),
        now: Date.now()
      });
    } catch (err) {
      this.setData({ sheetVisible: false, error: messageFor(err) });
      return;
    }

    const result = await this.persist(next, '存储空间不够了，这次操作没能完成。');
    this.setData({ sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  /** 恢复：只清掉收起标记，**原文不回退**——合并进去的内容照常留在原文里。 */
  async onSheetRestore() {
    const store = getApp().globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    const supplementId = this.data.sheetTargetId;
    const hidden = this.data.hidden.filter((s) => s.id === supplementId)[0];
    if (!hidden) return;

    // 「已并入灵感」与「已合并进汇总」是两种不同的收起，恢复方式也不同
    const isFolded = hidden.hiddenLabel === '已并入灵感';
    let next;
    try {
      next = isFolded
        ? inspiration.unfoldSupplement(current, { supplementId })
        : inspiration.unmergeSupplement(current, { supplementId });
    } catch (err) {
      this.setData({ sheetVisible: false, error: messageFor(err) });
      return;
    }

    const result = await this.persist(next, '存储空间不够了，这次恢复没能完成。');
    this.setData({ sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  // ------------------------------------------------------------ 删除补充

  /** 点「删除」先落到确认弹窗，不直接删。这是整个产品里唯一不可恢复的操作。 */
  onSheetDelete() {
    const id = this.data.sheetTargetId;
    const target = this.data.supplements.concat(this.data.hidden).filter((s) => s.id === id)[0];
    if (!target) return;

    this.setData({
      sheetVisible: false,
      confirmVisible: true,
      confirmQuote: target.content,
      confirmQuoteTime: target.label.replace('这条补充 · ', '')
    });
  },

  onConfirmDismiss() {
    this.setData({ confirmVisible: false, confirmQuote: '', confirmQuoteTime: '' });
  },

  async onConfirmDelete() {
    const store = getApp().globalData.store;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      // removeSupplement 会顺带恢复指向这条的补充，不留悬空引用
      next = inspiration.removeSupplement(current, { supplementId: this.data.sheetTargetId });
    } catch (err) {
      this.setData({ confirmVisible: false, error: messageFor(err) });
      return;
    }

    const result = await this.persist(next, '存储空间不够了，删除没能完成。');
    this.setData({ confirmVisible: false, confirmQuote: '', confirmQuoteTime: '', sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  // ------------------------------------------------------------ 收起行

  onToggleHidden() {
    this.setData({ hiddenExpanded: !this.data.hiddenExpanded });
  },

  // ------------------------------------------------------------ 删除灵感

  onDelete() {
    wx.showModal({
      title: '删除灵感',
      content: '这条灵感与它的补充将被移除，此操作无法撤销。',
      confirmText: '删除',
      confirmColor: '#b3382c',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.performDelete();
      }
    });
  },

  async performDelete() {
    const result = await getApp().globalData.store.deleteInspiration(this.id);

    if (!result.ok) {
      this.setData({ error: '删除失败，内容未做改动。' });
      return;
    }
    if (!result.synced) {
      // 本机已标记删除、列表不再显示它，但云端还没确认——如实说明，不假装删干净了
      wx.showToast({ title: '已删除，还没同步到云端', icon: 'none' });
    }
    wx.navigateBack();
  }
});
