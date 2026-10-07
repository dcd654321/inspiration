const { LIMITS, createId } = require('../../core/limits');
const inspiration = require('../../core/inspiration');
const { formatRelative, formatAbsolute } = require('../../core/format');
const { buildUseText } = require('../../services/content-output');
const { STAGES, organize } = require('../../services/organization');
const { loadPrivatePhotos } = require('../../services/private-photos');
const { pageGuard, readPageAccount } = require('../../services/page-session');

const DISPLAY_ERRORS = {
  EMPTY_TEXT: '写点内容再保存',
  TEXT_TOO_LONG: '正文最多 ' + LIMITS.textMaxLength + ' 字符',
  EMPTY_SUPPLEMENT: '写点补充再添加',
  SUPPLEMENT_TOO_LONG: '补充最多 ' + LIMITS.supplementMaxLength + ' 字符',
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

/**
 * 补到一半离开时提示一次。会话内的草稿区已经能保住「切走再回来」这种情况，
 * 平台只覆盖指定返回动作，手势返回与退出仍需可见提示；不引入本机持久化。
 * 模块级函数而非页面方法：测试会用一个假 page 对象直接调页面方法，挂在 this 上的辅助方法在那种调用下不存在。
 */
function guardDraft(hasDraft) {
  try {
    if (hasDraft) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '尚未保存的内容会丢失。' });
    } else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  } catch (err) { /* 基础库不支持时只是少一层提醒，不阻断输入 */ }
}

function guardDetailDraft(data) {
  guardDraft(Boolean(data.supplementDraft ||
    (data.editing && data.editDraft !== data.text) ||
    (data.editingSupplementId && data.supplementEditDraft !== data.supplementEditOriginal)));
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
    // 读取失败与「确认不存在」必须分开：网络问题不能说成灵感已被删除
    loadError: false,

    // 原文可直接编辑（2026-09-22 修订，此前是只读的）
    text: '',
    time: '',
    editing: false,
    editDraft: '',
    editError: '',
    editUnknown: false,
    canSaveEdit: false,
    textMax: LIMITS.textMaxLength,

    // 时间线上正常显示的补充
    supplements: [],
    supplementDraft: '',
    supplementMax: LIMITS.supplementMaxLength,
    supplementError: '',
    supplementUnknown: false,
    canAddSupplement: false,
    // 补充输入器：空且未聚焦 64px，聚焦或已有内容 160px；不依赖 auto-height
    composeFocus: false,
    composeRequestedFocus: false,
    // 长正文（超过约 6 行）滚离原文后，给一个可点的「继续补充」浮动按钮
    longText: false,
    floatVisible: false,

    // 因汇总或合并进灵感而收起的补充。**必须能展开、能恢复**——
    // 默认隐藏 + 没有入口 = 删除。
    hidden: [],
    hiddenExpanded: false,

    // 页内「更多」面板：正文编辑、复制、分享、修改记录、删除都从这里进入
    moreVisible: false,

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
    supplementEditUnknown: false,
    canSaveSupplementEdit: false,

    // 删除确认弹窗：灵感与补充共用一套，kind 决定标题与正文
    confirmVisible: false,
    confirmKind: 'supplement',
    confirmTitle: '',
    confirmBody: '',
    confirmQuote: '',
    confirmQuoteTime: '',

    historyCount: 0,
    aiEnabled: false, isAi: false, merged: false, provenance: [],
    tagsDraft: '', stageIndex: 0, stages: STAGES,
    /* 整理标记默认收起：它是整理期才关心的表单，每次都摊开会把补充时间线推得很远 */
    orgOpen: false, orgSummary: '',
    photosEnabled: false, photos: [], photoError: '', photoBusy: false,
    provenanceSupplementId: '', supplementEditMax: LIMITS.supplementMaxLength,
    error: '', pending: ''
  },

  async onLoad(query) {
    this.id = (query && query.id) || '';
    // 「继续补充」是从记录页成功卡跳进来的：定位并聚焦补充输入
    this.focusSupplement = Boolean(query && query.focus === 'supplement');
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
    this.setData({ ready: false, text: '', supplements: [], hidden: [], photos: [], photoBusy: false, photoError: '' });
    await getApp().ensureReady();
    if (!this.visible || this.viewVersion !== version) return;
    if (this.id) this.load();
  },

  onHide() {
    this.visible = false;
    this.viewVersion = (this.viewVersion || 0) + 1;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    this.setData({ photos: [], composeFocus: false, composeRequestedFocus: false, pending: '',
      moreVisible: false, sheetVisible: false, confirmVisible: false, confirmQuote: '', confirmQuoteTime: '' });
    guardDraft(false);
  },

  onUnload() { this.onHide(); },

  load(options) {
    if (this.visible === false) return;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    const photoReadVersion = this.photoReadVersion;
    const opts = options || {};
    const app = getApp();
    const store = app && app.globalData && app.globalData.store;
    if (this.loadedStore && this.loadedStore !== store) {
      this.pendingSupplement = null; this.pendingTextEdit = null; this.pendingSupplementEdit = null;
    }
    if (this.loadedEpoch !== app.globalData.sessionEpoch) opts.resetDraft = true;
    this.loadedEpoch = app.globalData.sessionEpoch;
    this.loadedStore = store;

    if (!store) {
      // 账户还没确认（多为网络）：绝不能把「读不到」说成「这条灵感没了」
      this.setData({ ready: true, missing: false, loadError: true, error: app && app.globalData.accountError || '暂时无法读取灵感，请稍后重试。' });
      return;
    }
    const item = store.getInspiration(this.id);
    if (!item) {
      // 快照来自云端确认结果，里面没有它 = 已确认不存在（删除或本来就无）
      this.setData({ ready: true, missing: true, loadError: false, error: '' });
      return;
    }

    const drafts = app.globalData.drafts;
    const now = Date.now();
    const tags = item.tags || [];
    const stageLabel = (STAGES[Math.max(0, STAGES.findIndex((x) => x.id === item.stage))] || STAGES[0]).label;
    const next = {
      ready: true,
      photosEnabled: Boolean(app.globalData.photos), photos: (item.photos || []).map((photo) => ({ id: photo.id, src: '', failed: false })),
      missing: false,
      loadError: false,
      text: item.text,
      aiEnabled: app.globalData.aiEnabled,
      isAi: item.source === 'ai', merged: Boolean(item.mergedInto),
      tagsDraft: tags.join('，'),
      stageIndex: Math.max(0, STAGES.findIndex((x) => x.id === item.stage)),
      // 收起后仍要看得见当前状态，否则折叠就等于把信息藏起来
      orgSummary: stageLabel + (tags.length ? ' · ' + tags.join('、') : ' · 未加标签'),
      orgOpen: this.data.orgOpen,
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
      next.editUnknown = false;
      next.canSaveEdit = false;
      next.supplementError = '';
      next.supplementUnknown = false; next.supplementEditUnknown = false;
      next.editingSupplementId = ''; next.supplementEditDraft = ''; next.supplementEditOriginal = '';
      next.sheetVisible = false; next.moreVisible = false; next.confirmVisible = false; next.confirmQuote = ''; next.pending = '';
    }

    this.setData(next, () => {
      guardDetailDraft(this.data);
      if (opts.resetDraft && this.focusSupplement && !next.merged) {
        this.focusSupplement = false;
        this.onLocateCompose();
      }
      if (opts.resetDraft) this.measureLongText();
    });
    const epoch = app.globalData.sessionEpoch;
    const isCurrent = () => this.visible !== false && this.photoReadVersion === photoReadVersion && app.globalData.sessionEpoch === epoch && app.globalData.store === store;
    loadPrivatePhotos(item.photos || [], { cacheScope: app.globalData.cacheScope, isCurrent }).then((photos) => {
      if (isCurrent()) this.setData({ photos });
    });
  },

  /** 长正文才给浮动「继续补充」：量原文渲染高度，超过约 6 行算长。量不到就不显示，不阻断页面。 */
  measureLongText() {
    if (typeof wx.createSelectorQuery !== 'function') return;
    const isCurrent = pageGuard(this);
    try {
      wx.createSelectorQuery().select('.origin-text').boundingClientRect((rect) => {
        if (!rect || !isCurrent()) return;
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo()
          : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
        const width = info && info.windowWidth || 375;
        const lineHeight = 38 * (width / 750) * 1.78;
        this.originBottom = rect.top + rect.height;
        this.setData({ longText: rect.height > 6 * lineHeight + 1 });
      }).exec();
    } catch (err) { /* 量不到就不给浮动按钮 */ }
  },

  onPageScroll(event) {
    if (!this.data.longText) {
      if (this.data.floatVisible) this.setData({ floatVisible: false });
      return;
    }
    const show = event.scrollTop > (this.originBottom || 0) && !this.data.composeFocus;
    if (show !== this.data.floatVisible) this.setData({ floatVisible: show });
  },

  onLocateCompose() {
    if (this.data.merged || this.data.pending || this.data.editing || this.data.editingSupplementId) return;
    this.setData({ composeFocus: true, composeRequestedFocus: true, floatVisible: false });
    // 键盘与滚动都交给系统上推/定位；这里只负责把输入框带进视野
    if (typeof wx.pageScrollTo === 'function') {
      try { wx.pageScrollTo({ selector: '.detail-next', duration: 200 }); } catch (err) { /* 老基础库没有 selector 形态，焦点已经到位 */ }
    }
  },

  onRetryLoad() {
    const version = this.viewVersion;
    this.setData({ ready: false, loadError: false, error: '' });
    return readPageAccount(this).then((account) => {
      if (account.isCurrent() && this.viewVersion === version) this.load({ resetDraft: true });
    });
  },

  currentStore() {
    const app = getApp(), store = app.globalData.store;
    return this.visible !== false && store && this.loadedStore === store &&
      this.loadedEpoch === app.globalData.sessionEpoch ? store : null;
  },

  /** 保存并刷新。所有写操作共用这一段，避免每个动作各写一遍成功/失败处理。 */
  async persist(next, failureMessage) {
    const app = getApp();
    const store = app.globalData.store;
    const version = this.viewVersion, epoch = app.globalData.sessionEpoch;
    const isCurrent = () => this.visible !== false && this.viewVersion === version &&
      app.globalData.sessionEpoch === epoch && app.globalData.store === store;
    if (!isCurrent() || !this.currentStore()) return { ok: false, stale: true, message: '账户状态已变化，请返回后重试。' };
    let result;
    try {
      result = await store.saveInspiration(next);
    } catch (err) {
      return { ok: false, stale: !isCurrent(), unknown: true, message: '尚未确认保存，内容还在。请重试，或先复制。' };
    }

    if (!isCurrent()) return { ok: false, stale: true };
    if (!result || !result.ok || result.synced !== true) {
      const unknown = !result || !result.code || ['NETWORK', 'INTERNAL'].includes(result.code);
      return { ok: false, unknown, message: unknown ? '尚未确认保存，内容还在。请重试，或先复制。' : result.code === 'CONFLICT' || result.code === 'STALE_GENERATION' ||
        result.code === 'REQUEST_ID_REUSED'
        ? '内容已在其他设备更新，本次修改未保存。请重新打开后重试。'
        : failureMessage };
    }
    return { ok: true, synced: true };
  },

  onBackToList() {
    wx.switchTab({ url: '/pages/list/index' });
  },

  // ------------------------------------------------------------ 原文编辑

  onStartEdit() {
    if (this.data.pending || this.data.editingSupplementId) return;
    this.setData({ editing: true, editDraft: this.data.text, editError: '', editUnknown: false, canSaveEdit: false });
  },

  onEditInput(event) {
    if (this.data.pending || this.visible === false) return;
    const value = event.detail.value;
    if (this.pendingTextEdit && this.pendingTextEdit.text !== value) this.pendingTextEdit = null;
    this.setData({
      editDraft: value,
      canSaveEdit: value.trim().length > 0 && value !== this.data.text,
      editError: '', editUnknown: false
    });
    guardDetailDraft(this.data);
  },

  onCancelEdit() {
    if (this.data.pending) return;
    this.pendingTextEdit = null;
    this.setData({ editing: false, editDraft: this.data.text, editError: '', editUnknown: false, canSaveEdit: false });
    guardDetailDraft(this.data);
  },

  async onSaveEdit() {
    if (this.data.pending || !this.data.canSaveEdit || this.visible === false) return;
    const store = getApp().globalData.store;
    if (!store || this.loadedStore && this.loadedStore !== store) return;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let edited;
    try {
      // historyId 是必填的：让「改写但不留历史」在调用层面根本写不出来
      const text = this.data.editDraft;
      const retry = this.pendingTextEdit && this.pendingTextEdit.text === text && this.pendingTextEdit.store === store
        ? this.pendingTextEdit : { text, store, historyId: createId('tex'), now: Date.now() };
      edited = current.text === text ? current : inspiration.updateText(current, { text, historyId: retry.historyId, now: retry.now });
      this.pendingTextEdit = retry;
    } catch (err) {
      this.setData({ editError: messageFor(err) });
      return;
    }

    this.setData({ pending: 'text', editError: '', editUnknown: false, error: '' });
    const result = await this.persist(edited, '未能保存修改，内容还在。请检查后重试，或先复制。');
    if (result.stale) return;
    if (!result.ok || result.synced !== true) {
      this.setData({ pending: '', editError: result.message, editUnknown: Boolean(result.unknown) });
      return;
    }

    this.pendingTextEdit = null;
    this.setData({ pending: '', editing: false, editError: '', editUnknown: false, canSaveEdit: false });
    this.load({ resetDraft: true });
  },

  onOpenHistory() {
    if (this.data.pending) return;
    wx.navigateTo({ url: '/pages/history/index?id=' + encodeURIComponent(this.id) });
  },

  copyText(text) {
    if (!text || !this.currentStore()) return;
    const isCurrent = pageGuard(this);
    try {
      wx.setClipboardData({
        data: text,
        success: () => { if (isCurrent()) wx.showToast({ title: '已复制', icon: 'none' }); },
        fail: () => { if (isCurrent()) wx.showModal({ title: '复制未完成', content: '请重试。', showCancel: false }); }
      });
    } catch (err) {
      if (isCurrent()) wx.showModal({ title: '复制未完成', content: '请重试。', showCancel: false });
    }
  },

  onCopyContent() {
    const store = this.currentStore();
    if (!store) return;
    const item = store.getInspiration(this.id);
    if (!item) return;
    const isCurrent = pageGuard(this);
    wx.showActionSheet({
      itemList: ['仅复制正文', '复制正文与当前补充'],
      success: (res) => { if (isCurrent()) this.copyText(res.tapIndex === 0 ? item.text : buildUseText(item)); }
    });
  },

  onOpenOutput() {
    if (this.data.pending || this.data.editing || this.data.editingSupplementId) return;
    wx.navigateTo({ url: '/pages/output/index?id=' + encodeURIComponent(this.id) });
  },

  onOpenShare() {
    if (!this.id || this.data.pending || this.data.editing || this.data.editingSupplementId) return;
    wx.navigateTo({ url: '/pages/share-preview/index?id=' + encodeURIComponent(this.id) });
  },

  // ------------------------------------------------------------ 页内「更多」

  onOpenMore() {
    if (this.data.pending || this.data.editing || this.data.editingSupplementId) return;
    this.setData({ moreVisible: true });
  },

  onCloseMore() {
    if (this.data.pending) return;
    this.setData({ moreVisible: false });
  },

  onMoreEditText() {
    if (this.data.pending) return;
    this.setData({ moreVisible: false });
    this.onStartEdit();
  },

  onMoreCopy() {
    this.setData({ moreVisible: false });
    this.onCopyContent();
  },

  onMoreShare() {
    this.setData({ moreVisible: false });
    this.onOpenShare();
  },

  onMoreHistory() {
    this.setData({ moreVisible: false });
    this.onOpenHistory();
  },

  onMoreDelete() {
    if (this.data.pending) return;
    if (this.data.photoBusy) { this.setData({ moreVisible: false, photoError: '照片正在处理中，请稍后再删除灵感。' }); return; }
    this.setData({
      moreVisible: false,
      confirmVisible: true,
      confirmKind: 'inspiration',
      confirmTitle: '删除灵感',
      confirmBody: '确定删除这条灵感吗？正文、补充和照片会一并删除。',
      confirmQuote: this.data.text,
      confirmQuoteTime: this.data.time
    });
  },

  onAiExpand() { if (!this.data.pending && !this.data.editing && !this.data.editingSupplementId) wx.navigateTo({ url: '/pages/ai-workbench/index?scope=expand&id=' + encodeURIComponent(this.id) }); },
  onAiSummarize() { if (!this.data.pending && !this.data.editing && !this.data.editingSupplementId) wx.navigateTo({ url: '/pages/ai-workbench/index?scope=supplements&id=' + encodeURIComponent(this.id) }); },
  onToggleOrganization() {
    if (this.data.pending) return;
    if (!this.data.orgOpen) {
      // 取消时恢复到展开前的值；保存失败时保留输入（不重置记录）
      this.orgOriginal = { tagsDraft: this.data.tagsDraft, stageIndex: this.data.stageIndex };
    }
    this.setData({ orgOpen: !this.data.orgOpen });
  },
  onTagsInput(event) { if (!this.data.pending) this.setData({ tagsDraft: event.detail.value }); },
  onStageSelect(event) { if (!this.data.pending) this.setData({ stageIndex: Number(event.detail.value) }); },
  onCancelOrganization() {
    if (this.data.pending) return;
    const original = this.orgOriginal || { tagsDraft: this.data.tagsDraft, stageIndex: this.data.stageIndex };
    this.setData({ tagsDraft: original.tagsDraft, stageIndex: original.stageIndex, orgOpen: false, error: '' });
  },
  async onSaveOrganization() {
    if (this.data.pending || !this.currentStore()) return;
    let next;
    try { next = organize(getApp().globalData.store.getInspiration(this.id), { tags: this.data.tagsDraft.split(/[,，]/).map((x) => x.trim()).filter(Boolean), stage: STAGES[this.data.stageIndex].id, now: Date.now() }); }
    catch (err) { this.setData({ error: err.message }); return; }
    this.setData({ pending: 'organize' });
    const result = await this.persist(next, '整理信息未保存，请稍后重试。');
    if (result.stale) return;
    // 保存成功就收起：收起行里已经写着结果，表单没必要继续摊着
    this.setData({ pending: '', error: result.ok ? this.data.error : result.message, orgOpen: result.ok ? false : this.data.orgOpen });
    if (result.ok) this.load();
  },
  async onRestoreInspiration() {
    if (this.data.pending || !this.currentStore()) return;
    this.setData({ pending: 'restore' });
    const item = getApp().globalData.store.getInspiration(this.id);
    const result = await this.persist(inspiration.unmerge(item), '恢复没有完成，请稍后重试。');
    if (result.stale) return;
    this.setData({ pending: '', error: result.ok ? this.data.error : result.message });
    if (result.ok) this.load();
  },
  onOpenSource(event) {
    if (this.data.pending || !this.currentStore()) return;
    const id = event.currentTarget.dataset.id;
    if (id === this.id) this.onOpenHistory();
    else if (getApp().globalData.store.getInspiration(id)) wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(id) });
  },

  onAddPhoto() {
    if (this.data.photoBusy || this.data.pending || !this.currentStore() || !getApp().globalData.photos) return;
    const store = getApp().globalData.store, version = this.viewVersion;
    wx.showActionSheet({ itemList: ['拍照', '从相册选择'], success: (res) => {
      if (this.visible === false || this.viewVersion !== version || getApp().globalData.store !== store) return;
      this.addPhotos(res.tapIndex === 0 ? 'camera' : 'album');
    } });
  },
  async addPhotos(source) {
    const app = getApp(), service = app.globalData.photos, store = app.globalData.store;
    const version = this.viewVersion, epoch = app.globalData.sessionEpoch;
    if (!service || this.data.photoBusy || this.data.pending || this.visible === false) return;
    this.setData({ photoBusy: true, photoError: '' });
    let result;
    try { result = await service.add(this.id, source); }
    catch (err) { result = { ok: false, message: '照片未添加成功，请重新选择后重试。' }; }
    if (this.visible === false || this.viewVersion !== version || app.globalData.sessionEpoch !== epoch ||
        app.globalData.store !== store || app.globalData.photos !== service) return;
    this.setData({ photoBusy: false, photoError: result.message || '' }); this.load();
  },
  onPreviewPhoto(event) {
    if (this.data.pending) return;
    wx.navigateTo({ url: '/pages/photo-viewer/index?id=' + encodeURIComponent(this.id) + '&photo=' + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  onReloadPhoto() { this.load(); },
  onDeletePhoto(event) {
    const store = this.currentStore();
    if (this.data.photoBusy || this.data.pending || !store) return;
    const photoId = event.currentTarget.dataset.id, id = this.id, isCurrent = pageGuard(this);
    this.setData({ photoBusy: true, photoError: '' });
    wx.showModal({ title: '删除照片', content: '照片将从灵感及存储中移除，无法撤销。清理失败时可重试。', confirmText: '删除',
      fail: () => { if (isCurrent()) this.setData({ photoBusy: false }); },
      success: async (res) => {
      if (!isCurrent()) return;
      if (!res.confirm) { this.setData({ photoBusy: false }); return; }
      let result;
      try {
        result = await store.deletePhoto(id, photoId);
      } catch (err) { result = {}; }
      if (!isCurrent()) return;
      this.setData({ photoBusy: false, photoError: result.ok && result.synced === true ? '' : '照片清理尚未完成，记录仍保留，可稍后重试。' });
      this.load();
    } });
  },

  // ------------------------------------------------------------ 追加补充

  onComposeFocus() { this.setData({ composeFocus: true, floatVisible: false }); },
  onComposeBlur() { this.setData({ composeFocus: false, composeRequestedFocus: false }); },

  onSupplementInput(event) {
    if (this.data.pending || this.visible === false) return;
    const value = event.detail.value;
    if (this.pendingSupplement && this.pendingSupplement.text !== value) this.pendingSupplement = null;
    const canEdit = value.trim().length > 0 && value.length <= LIMITS.supplementMaxLength;
    this.setData({
      supplementDraft: value,
      supplementError: '',
      supplementUnknown: false,
      canAddSupplement: canEdit
    });
    guardDetailDraft(this.data);

    // 同步进会话草稿区：写到一半切走，回来时这半句话还在
    const drafts = getApp().globalData.drafts;
    if (drafts) drafts.set(this.id, value);
  },

  async onSubmitSupplement() {
    if (this.data.pending || !this.data.canAddSupplement) return;
    const app = getApp();
    const store = app.globalData.store;
    const epoch = app.globalData.sessionEpoch, version = this.viewVersion;
    if (!store || this.visible === false || this.loadedStore && this.loadedStore !== store) return;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      const retry = this.pendingSupplement && this.pendingSupplement.text === this.data.supplementDraft && this.pendingSupplement.store === store
        ? this.pendingSupplement : null;
      const id = retry ? retry.id : createId('sup'), now = retry ? retry.now : Date.now();
      const existing = (current.supplements || []).find((entry) => entry.id === id);
      if (existing && existing.content !== this.data.supplementDraft) {
        this.setData({ supplementError: '这条补充已更新，请重新打开灵感后核对。' });
        return;
      }
      next = existing ? current : inspiration.appendSupplement(current, {
        content: this.data.supplementDraft,
        id,
        now
      });
      this.pendingSupplement = { text: this.data.supplementDraft, store, id, now };
    } catch (err) {
      this.setData({ supplementError: messageFor(err) });
      return;
    }

    this.setData({ pending: 'supplement', supplementError: '', supplementUnknown: false, error: '' });
    const result = await this.persist(next, '未能保存补充，内容还在。请检查后重试，或先复制。');
    if (result.stale) return;
    if (this.visible === false || this.viewVersion !== version || epoch !== app.globalData.sessionEpoch || store !== app.globalData.store) return;
    if (!result.ok) {
      // 云端未确认：保留当前输入，供用户在本次会话中重试。
      this.setData({ pending: '', supplementError: result.message, supplementUnknown: Boolean(result.unknown) });
      return;
    }

    const drafts = app.globalData.drafts;
    if (drafts) drafts.clear(this.id);

    this.pendingSupplement = null;
    this.setData({ pending: '', supplementDraft: '', canAddSupplement: false, composeFocus: false, composeRequestedFocus: false });
    guardDraft(false);
    this.load({ resetDraft: true });
    wx.showToast({ title: '已添加补充', icon: 'none' });
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
    if (this.data.pending || this.data.editing || this.data.editingSupplementId) return;
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
      supplementEditUnknown: false,
      canSaveSupplementEdit: false
    });
  },

  onSupplementEditInput(event) {
    if (this.data.pending || this.visible === false) return;
    const value = event.detail.value;
    if (this.pendingSupplementEdit && this.pendingSupplementEdit.content !== value) this.pendingSupplementEdit = null;
    this.setData({
      supplementEditDraft: value,
      canSaveSupplementEdit: value.trim().length > 0 && value !== this.data.supplementEditOriginal,
      supplementEditError: '', supplementEditUnknown: false
    });
    guardDetailDraft(this.data);
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
    this.pendingSupplementEdit = null;
    this.setData({
      editingSupplementId: '',
      supplementEditDraft: '',
      supplementEditOriginal: '',
      supplementEditError: '',
      supplementEditUnknown: false,
      canSaveSupplementEdit: false
    });
    guardDetailDraft(this.data);
  },

  async onSupplementEditSave() {
    if (this.data.pending || !this.data.canSaveSupplementEdit || this.visible === false) return;
    const store = getApp().globalData.store;
    if (!store || this.loadedStore && this.loadedStore !== store) return;
    const current = store.getInspiration(this.id);
    if (!current) return;

    let next;
    try {
      const content = this.data.supplementEditDraft, supplementId = this.data.editingSupplementId;
      const retry = this.pendingSupplementEdit && this.pendingSupplementEdit.content === content &&
        this.pendingSupplementEdit.supplementId === supplementId && this.pendingSupplementEdit.store === store
        ? this.pendingSupplementEdit : { content, supplementId, store, historyId: createId('chg'), now: Date.now() };
      const existing = (current.supplements || []).find((entry) => entry.id === supplementId);
      next = existing && existing.content === content ? current : inspiration.editSupplement(current, { content, supplementId, historyId: retry.historyId, now: retry.now });
      this.pendingSupplementEdit = retry;
    } catch (err) {
      this.setData({ supplementEditError: messageFor(err) });
      return;
    }

    this.setData({ pending: 'supplementEdit', supplementEditError: '', supplementEditUnknown: false, error: '' });
    const result = await this.persist(next, '未能保存修改，内容还在。请检查后重试，或先复制。');
    if (result.stale) return;
    if (!result.ok) {
      this.setData({ pending: '', supplementEditError: result.message, supplementEditUnknown: Boolean(result.unknown) });
      return;
    }

    this.pendingSupplementEdit = null;
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

  onCopyUnsaved(event) {
    if (this.data.pending) return;
    const kind = event.currentTarget.dataset.kind;
    this.copyText(kind === 'text' ? this.data.editDraft : kind === 'editSupplement' ? this.data.supplementEditDraft : this.data.supplementDraft);
  },

  /** 合并进灵感：内容追加到原文末尾，本条收起。合并前的原文进历史，一句话都不会消失。 */
  async onSheetFold() {
    if (this.data.pending || !this.currentStore()) return;
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
    if (result.stale) return;
    this.setData({ pending: '', sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  /** 恢复：只清掉收起标记，**原文不回退**——合并进去的内容照常留在原文里。 */
  async onSheetRestore() {
    if (this.data.pending || !this.currentStore()) return;
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
    if (result.stale) return;
    this.setData({ pending: '', sheetVisible: false, sheetTargetId: '' });
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    this.load({ resetDraft: true });
  },

  // ------------------------------------------------------------ 删除补充

  /** 点「删除补充」先落到确认弹窗，不直接删。这是整个产品里唯一不可恢复的操作。 */
  onSheetDelete() {
    if (this.data.pending) return;
    const id = this.data.sheetTargetId;
    const target = this.data.supplements.concat(this.data.hidden).filter((s) => s.id === id)[0];
    if (!target) return;

    this.setData({
      sheetVisible: false,
      confirmVisible: true,
      confirmKind: 'supplement',
      confirmTitle: '删除补充',
      confirmBody: '确定删除这条补充吗？',
      confirmQuote: target.content,
      confirmQuoteTime: target.label.replace('这条补充 · ', '')
    });
  },

  onConfirmDismiss() {
    if (this.data.pending) return;
    this.setData({ confirmVisible: false, confirmKind: 'supplement', confirmQuote: '', confirmQuoteTime: '' });
  },

  async onConfirmDelete() {
    if (this.data.pending || !this.data.confirmVisible || !this.currentStore()) return;
    if (this.data.confirmKind === 'inspiration') return this.performDelete();

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
    if (result.stale) return;
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

  async performDelete() {
    const store = this.currentStore();
    if (this.data.pending || !store || this.data.photoBusy) return;
    const isCurrent = pageGuard(this), id = this.id;
    this.setData({ pending: 'deleteInspiration', error: '' });
    let result;
    try { result = await store.deleteInspiration(id); }
    catch (err) { result = { ok: false, code: 'NETWORK' }; }
    if (!isCurrent()) return;

    if (!result || !result.ok || result.synced !== true) {
      const code = result && result.code;
      this.setData({ pending: '', confirmVisible: false, error: code === 'PHOTO_DELETE_UNAVAILABLE'
        ? '这条含有照片，暂时无法安全删除；记录仍在。'
        : !code || ['NETWORK', 'INTERNAL'].includes(code) ? '尚未确认删除，请重新读取后核对。'
          : '删除未完成，请稍后重试。' });
      return;
    }
    this.setData({ pending: '', confirmVisible: false });
    wx.navigateBack();
  }
});
