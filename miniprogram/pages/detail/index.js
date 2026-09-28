const { LIMITS, createId } = require('../../core/limits');
const inspiration = require('../../core/inspiration');
const { formatRelative, formatAbsolute } = require('../../core/format');
const { buildUseText } = require('../../services/content-output');
const { STAGES, organize } = require('../../services/organization');
const { loadPrivatePhotos } = require('../../services/private-photos');

const DISPLAY_ERRORS = {
  EMPTY_TEXT: '写点内容再保存',
  TEXT_TOO_LONG: '正文最多 ' + LIMITS.textMaxLength + ' 字',
  EMPTY_SUPPLEMENT: '写点补充再添加',
  SUPPLEMENT_TOO_LONG: '补充最多 ' + LIMITS.supplementMaxLength + ' 字',
  ALREADY_MERGED: '这条补充已经收起，可先恢复后再操作',
  ALREADY_FOLDED: '这条补充已经并入正文，可先恢复后再操作',
  SUPPLEMENT_NOT_FOUND: '这条补充已经不存在，请返回后重试',
  LIMIT_EXCEEDED: '内容超出上限，请缩短后重试'
};

function messageFor(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    return DISPLAY_ERRORS[err.errors[0].code] || '操作没有完成，请返回后重试。';
  }
  return '操作没有完成，请稍后重试。';
}

function decorateSupplement(supplement, now, all) {
  return {
    id: supplement.id,
    content: supplement.content,
    time: formatRelative(supplement.createdAt, now),
    // 操作面板的标题要标明操作对象，不能让用户猜点的是哪条
    label: '这条补充 · ' + formatAbsolute(supplement.createdAt),
    // AI 产出必须带标记：规范要求如实标注，不得把本地结果说成 AI 生成
    isAi: supplement.source === 'ai',
    editMax: supplement.source === 'ai' && (supplement.sourceIds || []).length >= 2 ? LIMITS.summaryMaxLength : LIMITS.supplementMaxLength,
    sources: (supplement.sourceIds || []).map((id) => { const item = (all || []).find((x) => x.id === id); return { id, content: item ? item.content : '来源已删除' }; }),
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
    canSaveEdit: false,
    textMax: LIMITS.textMaxLength,

    // 时间线上正常显示的补充
    supplements: [],
    supplementDraft: '',
    supplementMax: LIMITS.supplementMaxLength,
    supplementError: '',
    canAddSupplement: false,

    // 因汇总或合并进灵感而收起的补充。**必须能展开、能恢复**——
    // 默认隐藏 + 没有入口 = 删除。
    hidden: [],
    hiddenExpanded: false,

    // 补充操作面板
    sheetVisible: false,
    sheetTargetId: '',
    sheetTargetLabel: '',
    sheetIsHidden: false,

    // 补充的行内修改
    editingSupplementId: '',
    supplementEditDraft: '',
    supplementEditOriginal: '',
    supplementEditError: '',
    canSaveSupplementEdit: false,

    // 删除确认弹窗
    confirmVisible: false,
    confirmQuote: '',
    confirmQuoteTime: '',

    historyCount: 0,
    aiEnabled: false, isAi: false, merged: false, provenance: [],
    tagsDraft: '', stageIndex: 0, stages: STAGES,
    photosEnabled: false, photos: [], photoDrafts: [], photoError: '', photoBusy: false,
    provenanceSupplementId: '', supplementEditMax: LIMITS.supplementMaxLength,
    error: '',
    pending: ''
  },

  async onLoad(query) {
    this.id = (query && query.id) || '';
    this.visible = true;
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    await getApp().ensureReady();
    if (!this.visible || this.viewVersion !== version) return;
    this.load({ resetDraft: true });
  },

  /** 面板本体上的点击不该穿透到遮罩，否则点哪都关。 */
  noop() {},

  // 从历史版本页返回时数据可能已变，重新读一次
  async onShow() {
    this.visible = true;
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    this.setData({ ready: false, text: '', supplements: [], hidden: [], photos: [], photoDrafts: [], photoBusy: false });
    await getApp().ensureReady();
    if (!this.visible || this.viewVersion !== version) return;
    if (this.id) this.load();
  },

  load(options) {
    if (this.visible === false) return;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    const photoReadVersion = this.photoReadVersion;
    const opts = options || {};
    const app = getApp();
    const store = app && app.globalData && app.globalData.store;
    if (this.loadedEpoch !== app.globalData.sessionEpoch) opts.resetDraft = true;
    this.loadedEpoch = app.globalData.sessionEpoch;
    this.loadedStore = store;
    const item = store ? store.getInspiration(this.id) : null;

    if (!item) {
      this.setData({ ready: true, missing: true, error: app && app.globalData.accountError || '' });
      return;
    }

    const drafts = app.globalData.drafts;
    let photoDrafts = [];
    try { if (app.globalData.photos) photoDrafts = app.globalData.photos.list(this.id); }
    catch (err) { this.setData({ photoError: '照片暂存记录无法读取，请勿清理小程序数据。' }); }
    const now = Date.now();
    const next = {
      ready: true,
      photosEnabled: Boolean(app.globalData.photos), photos: (item.photos || []).map((photo) => ({ id: photo.id, src: '', failed: false })), photoDrafts,
      missing: false,
      text: item.text,
      aiEnabled: app.globalData.aiEnabled,
      isAi: item.source === 'ai', merged: Boolean(item.mergedInto),
      tagsDraft: (item.tags || []).join('，'),
      stageIndex: Math.max(0, STAGES.findIndex((x) => x.id === item.stage)),
      provenance: (item.summarySources || []).map((id) => { const source = store.getInspiration(id); return { id, exists: Boolean(source), label: source ? (id === item.id ? '此条灵感的旧正文（见修改记录）' : source.text) : '来源已删除' }; }),
      time: formatRelative(item.updatedAt, now),
      supplements: inspiration.activeSupplements(item).map((s) => decorateSupplement(s, now, item.supplements)),
      hidden: inspiration.mergedSupplements(item)
        .concat(inspiration.foldedSupplements(item))
        .map((s) => decorateSupplement(s, now, item.supplements)),
      historyCount: (item.textHistory || []).length
    };

    if (opts.resetDraft) {
      // 草稿从会话草稿区取回：切页回来时输入框里还应该有它
      next.supplementDraft = drafts ? drafts.get(this.id) : '';
      next.canAddSupplement = next.supplementDraft.trim().length > 0;
      next.editing = false;
      next.editDraft = item.text;
      next.editError = '';
      next.canSaveEdit = false;
      next.supplementError = '';
      next.editingSupplementId = ''; next.supplementEditDraft = ''; next.supplementEditOriginal = '';
      next.sheetVisible = false; next.confirmVisible = false; next.confirmQuote = ''; next.pending = '';
    }

    this.setData(next);
    const epoch = app.globalData.sessionEpoch;
    const isCurrent = () => this.visible !== false && this.photoReadVersion === photoReadVersion && app.globalData.sessionEpoch === epoch && app.globalData.store === store;
    loadPrivatePhotos(item.photos || [], { cacheScope: app.globalData.cacheScope, isCurrent }).then((photos) => {
      if (isCurrent()) this.setData({ photos });
    });
  },

  onHide() {
    this.visible = false;
    this.viewVersion = (this.viewVersion || 0) + 1;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    this.setData({ photos: [], photoDrafts: [] });
  },

  onUnload() { this.onHide(); },

  /** 保存并刷新。所有写操作共用这一段，避免每个动作各写一遍成功/失败处理。 */
  async persist(next, failureMessage) {
    const app = getApp();
    const store = app.globalData.store;
    if (!store || this.loadedStore && this.loadedStore !== store) return { ok: false, message: '账户状态已变化，请返回后重试。' };
    let result;
    try {
      result = await store.saveInspiration(next);
    } catch (err) {
      return { ok: false, message: failureMessage };
    }

    if (app.globalData.store !== store) return { ok: false, message: '账户状态已变化，请返回后重试。' };
    if (!result.ok) {
      return { ok: false, message: result.code === 'CONFLICT' || result.code === 'STALE_GENERATION' ||
        result.code === 'REQUEST_ID_REUSED'
        ? '备份出现冲突，本次修改未保存。请到「我的」查看备份状态。'
        : failureMessage };
    }
    if (!result.synced) {
      this.setData({ error: '已保存，但备份未完成。请暂时不要清理小程序数据。' });
    } else {
      this.setData({ error: '' });
    }
    return { ok: true };
  },

  onBackToList() {
    wx.switchTab({ url: '/pages/list/index' });
  },

  // ------------------------------------------------------------ 原文编辑

  onStartEdit() {
    if (this.data.pending) return;
    this.setData({ editing: true, editDraft: this.data.text, editError: '', canSaveEdit: false });
  },

  onEditInput(event) {
    const value = event.detail.value;
    this.setData({
      editDraft: value,
      canSaveEdit: value.trim().length > 0 && value !== this.data.text,
      editError: ''
    });
  },

  onCancelEdit() {
    if (this.data.pending) return;
    this.setData({ editing: false, editDraft: this.data.text, editError: '', canSaveEdit: false });
  },

  async onSaveEdit() {
    if (this.data.pending || !this.data.canSaveEdit) return;
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

    this.setData({ pending: 'text', editError: '', error: '' });
    const result = await this.persist(edited, '存储空间不足，暂时无法保存。内容还在，可清理空间后重试。');
    if (!result.ok) {
      this.setData({ pending: '', editError: result.message });
      return;
    }

    this.setData({ pending: '', editing: false, editError: '', canSaveEdit: false });
    this.load({ resetDraft: true });
  },

  onOpenHistory() {
    wx.navigateTo({ url: '/pages/history/index?id=' + encodeURIComponent(this.id) });
  },

  copyText(text) {
    if (!text) return;
    try {
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制', icon: 'none' }),
        fail: () => wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false })
      });
    } catch (err) {
      wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false });
    }
  },

  onCopyContent() {
    const item = getApp().globalData.store.getInspiration(this.id);
    if (!item) return;
    wx.showActionSheet({
      itemList: ['仅复制正文', '复制正文与当前补充'],
      success: (res) => this.copyText(res.tapIndex === 0 ? item.text : buildUseText(item))
    });
  },

  onOpenOutput() {
    wx.navigateTo({ url: '/pages/output/index?id=' + encodeURIComponent(this.id) });
  },

  onOpenShare() {
    if (!this.id || this.data.pending) return;
    wx.navigateTo({ url: '/pages/share-preview/index?id=' + encodeURIComponent(this.id) });
  },

  onAiExpand() { wx.navigateTo({ url: '/pages/ai-workbench/index?scope=expand&id=' + encodeURIComponent(this.id) }); },
  onAiSummarize() { wx.navigateTo({ url: '/pages/ai-workbench/index?scope=supplements&id=' + encodeURIComponent(this.id) }); },
  onTagsInput(event) { this.setData({ tagsDraft: event.detail.value }); },
  onStageSelect(event) { this.setData({ stageIndex: Number(event.detail.value) }); },
  async onSaveOrganization() {
    if (this.data.pending) return;
    let next;
    try { next = organize(getApp().globalData.store.getInspiration(this.id), { tags: this.data.tagsDraft.split(/[,，]/).map((x) => x.trim()).filter(Boolean), stage: STAGES[this.data.stageIndex].id, now: Date.now() }); }
    catch (err) { this.setData({ error: err.message }); return; }
    this.setData({ pending: 'organize' });
    const result = await this.persist(next, '整理信息未保存，请稍后重试。');
    this.setData({ pending: '', error: result.ok ? this.data.error : result.message });
    if (result.ok) this.load();
  },
  async onRestoreInspiration() {
    if (this.data.pending) return;
    this.setData({ pending: 'restore' });
    const item = getApp().globalData.store.getInspiration(this.id);
    const result = await this.persist(inspiration.unmerge(item), '恢复没有完成，请稍后重试。');
    this.setData({ pending: '', error: result.ok ? this.data.error : result.message });
    if (result.ok) this.load();
  },
  onOpenSource(event) {
    const id = event.currentTarget.dataset.id;
    if (id === this.id) this.onOpenHistory();
    else if (getApp().globalData.store.getInspiration(id)) wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  onAddPhoto() {
    if (this.data.photoBusy || this.data.pending || !getApp().globalData.photos) return;
    wx.showActionSheet({ itemList: ['拍照', '从相册选择'], success: (res) => this.runPhoto('add', res.tapIndex === 0 ? 'camera' : 'album') });
  },
  async runPhoto(action, value) {
    const app = getApp(), service = app.globalData.photos, scope = app.globalData.cacheScope;
    if (!service || this.data.photoBusy) return;
    this.setData({ photoBusy: true, photoError: '' });
    let result;
    try { result = action === 'add' ? await service.add(this.id, value) : await service[action](value); }
    catch (err) { result = { ok: false, message: '照片处理未完成，已保留，请稍后重试。' }; }
    if (getApp().globalData.cacheScope !== scope) return;
    this.setData({ photoBusy: false, photoError: result.message || '' }); this.load();
  },
  onRetryPhoto(event) { this.runPhoto('retry', event.currentTarget.dataset.id); },
  onDiscardPhoto(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({ title: '放弃这张照片', content: '将清理这张暂存照片及已上传的文件，不影响文字。', confirmText: '放弃照片', success: (res) => { if (res.confirm) this.runPhoto('discard', id); } });
  },
  onPreviewPhoto(event) {
    wx.navigateTo({ url: '/pages/photo-viewer/index?id=' + encodeURIComponent(this.id) + '&photo=' + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  onDeletePhoto(event) {
    if (this.data.photoBusy || this.data.pending) return;
    const photoId = event.currentTarget.dataset.id, app = getApp(), store = app.globalData.store;
    wx.showModal({ title: '删除照片', content: '照片将从灵感及存储中移除，无法撤销。清理失败时可重试。', confirmText: '删除', success: async (res) => {
      if (!res.confirm || getApp().globalData.store !== store) return;
      this.setData({ photoBusy: true, photoError: '' });
      let result;
      try {
        const photos = app.globalData.photos;
        if (photos && photos.list(this.id).some((entry) => entry.id === photoId)) {
          await photos.retry(photoId);
          if (photos.list(this.id).some((entry) => entry.id === photoId)) throw Error('PENDING_UPLOAD');
        }
        result = await store.deletePhoto(this.id, photoId);
      } catch (err) { result = {}; }
      if (getApp().globalData.store !== store) return;
      this.setData({ photoBusy: false, photoError: result.synced ? '' : '照片清理尚未完成，记录仍保留，可稍后重试。' });
      this.load();
    } });
  },

  // ------------------------------------------------------------ 追加补充

  onSupplementInput(event) {
    const value = event.detail.value;
    this.setData({
      supplementDraft: value,
      supplementError: '',
      canAddSupplement: value.trim().length > 0
    });

    // 同步进会话草稿区：写到一半切走，回来时这半句话还在
    const drafts = getApp().globalData.drafts;
    if (drafts) drafts.set(this.id, value);
  },

  async onSubmitSupplement() {
    if (this.data.pending || !this.data.canAddSupplement) return;
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

    this.setData({ pending: 'supplement', supplementError: '', error: '' });
    const result = await this.persist(next, '存储空间不足，暂时无法保存。内容还在，可清理空间后重试。');
    if (!result.ok) {
      // 本机没存下来：**保留输入**，清掉就等于把用户刚写的补充弄丢了
      this.setData({ pending: '', supplementError: result.message });
      return;
    }

    const drafts = app.globalData.drafts;
    if (drafts) drafts.clear(this.id);

    this.setData({ pending: '', supplementDraft: '', canAddSupplement: false });
    this.load({ resetDraft: true });
    wx.showToast({ title: '已添加', icon: 'none' });
    if (getApp().globalData.metrics) getApp().globalData.metrics.track('supplement_saved');
  },

  // ------------------------------------------------------------ 补充操作面板

  onSupplementLongPress(event) {
    this.openSupplementActions(event.currentTarget.dataset.id);
  },

  onSupplementAction(event) {
    this.openSupplementActions(event.currentTarget.dataset.id);
  },

  openSupplementActions(id) {
    if (this.data.pending) return;
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
    if (this.data.pending) return;
    this.setData({ sheetVisible: false, sheetTargetId: '', sheetTargetLabel: '', sheetIsHidden: false });
  },

  /** 修改：切到行内编辑。与原文编辑同一套规则，旧内容进这条补充自己的历史。 */
  onSheetEdit() {
    if (this.data.pending) return;
    const id = this.data.sheetTargetId;
    const target = this.data.supplements.filter((s) => s.id === id)[0];
    this.setData({
      sheetVisible: false,
      editingSupplementId: id,
      supplementEditDraft: target ? target.content : '',
      supplementEditMax: target ? target.editMax : LIMITS.supplementMaxLength,
      supplementEditOriginal: target ? target.content : '',
      supplementEditError: '',
      canSaveSupplementEdit: false
    });
  },

  onSupplementEditInput(event) {
    const value = event.detail.value;
    this.setData({
      supplementEditDraft: value,
      canSaveSupplementEdit: value.trim().length > 0 && value !== this.data.supplementEditOriginal,
      supplementEditError: ''
    });
  },

  onSheetCopy() {
    if (this.data.pending) return;
    const target = this.data.supplements.concat(this.data.hidden)
      .filter((s) => s.id === this.data.sheetTargetId)[0];
    this.onSheetDismiss();
    if (target) this.copyText(target.content);
  },

  onSupplementEditCancel() {
    if (this.data.pending) return;
    this.setData({
      editingSupplementId: '',
      supplementEditDraft: '',
      supplementEditOriginal: '',
      supplementEditError: '',
      canSaveSupplementEdit: false
    });
  },

  async onSupplementEditSave() {
    if (this.data.pending || !this.data.canSaveSupplementEdit) return;
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

    this.setData({ pending: 'supplementEdit', supplementEditError: '', error: '' });
    const result = await this.persist(next, '存储空间不足，暂时无法保存。内容还在，可清理空间后重试。');
    if (!result.ok) {
      this.setData({ pending: '', supplementEditError: result.message });
      return;
    }

    this.setData({
      pending: '',
      editingSupplementId: '',
      supplementEditDraft: '',
      supplementEditOriginal: '',
      supplementEditError: '',
      canSaveSupplementEdit: false
    });
    this.load({ resetDraft: true });
  },

  /** 合并进灵感：内容追加到原文末尾，本条收起。合并前的原文进历史，一句话都不会消失。 */
  async onSheetFold() {
    if (this.data.pending) return;
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

    this.setData({ pending: 'fold', error: '' });
    const result = await this.persist(next, '操作没有完成，请稍后重试。');
    this.setData({ pending: '', sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  /** 恢复：只清掉收起标记，**原文不回退**——合并进去的内容照常留在原文里。 */
  async onSheetRestore() {
    if (this.data.pending) return;
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

    this.setData({ pending: 'restore', error: '' });
    const result = await this.persist(next, '恢复没有完成，请稍后重试。');
    this.setData({ pending: '', sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  // ------------------------------------------------------------ 删除补充

  /** 点「删除」先落到确认弹窗，不直接删。这是整个产品里唯一不可恢复的操作。 */
  onSheetDelete() {
    if (this.data.pending) return;
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
    if (this.data.pending) return;
    this.setData({ confirmVisible: false, confirmQuote: '', confirmQuoteTime: '' });
  },

  async onConfirmDelete() {
    if (this.data.pending) return;
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

    this.setData({ pending: 'deleteSupplement', error: '' });
    const result = await this.persist(next, '删除失败，请稍后重试。');
    this.setData({ pending: '', confirmVisible: false, confirmQuote: '', confirmQuoteTime: '', sheetTargetId: '' });
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
  onToggleSupplementSources(event) { const id = event.currentTarget.dataset.id; this.setData({ provenanceSupplementId: this.data.provenanceSupplementId === id ? '' : id }); },

  // ------------------------------------------------------------ 删除灵感

  onDelete() {
    if (this.data.pending) return;
    if (this.data.photoBusy || this.data.photoDrafts.length) { this.setData({ photoError: '请先完成照片处理或放弃暂存照片，再删除灵感。' }); return; }
    wx.showModal({
      title: '删除灵感',
      content: '确定删除灵感吗？正文、补充和照片都会一并移除，此操作无法撤销。',
      confirmText: '删除',
      confirmColor: '#b43c32',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.performDelete();
      }
    });
  },

  async performDelete() {
    if (this.data.pending) return;
    this.setData({ pending: 'deleteInspiration', error: '' });
    const result = await getApp().globalData.store.deleteInspiration(this.id);

    if (!result.ok) {
      this.setData({ pending: '', error: result.code === 'PHOTO_DELETE_UNAVAILABLE'
        ? '这条含有照片，暂时无法安全删除；记录仍在。'
        : '删除未完成，记录仍在，请稍后重试。' });
      return;
    }
    if (!result.synced) {
      this.setData({ pending: '', error: result.code === 'PHOTO_DELETE_UNAVAILABLE'
        ? '这条含有照片，暂时无法安全删除；记录仍在。'
        : result.code === 'CONFLICT' || result.code === 'STALE_GENERATION' ||
          result.code === 'REQUEST_ID_REUSED'
          ? '删除遇到备份冲突，记录仍在。请到「我的」查看。'
          : '删除尚未完成，记录仍在；联网后可在「我的」重试备份。' });
      return;
    }
    this.setData({ pending: '' });
    wx.navigateBack();
  }
});
