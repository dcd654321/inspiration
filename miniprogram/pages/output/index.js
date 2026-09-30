const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');
const { formatAbsolute } = require('../../core/format');
const { currentSupplements, buildTemplateText, buildArchiveText, USE_TEMPLATES } = require('../../services/content-output');

Page({
  data: {
    ready: false,
    missing: false,
    // 读取失败（账户/网络）与「确认不存在」分开
    readError: false,
    // edit = 正在编辑稿件；content/format/more = 相应面板；archive = 文字留档
    phase: 'edit',
    options: [],
    // 面板里的暂存副本：确认「应用」才写回 options/templateId，取消不改动任何东西
    stagedOptions: [],
    stagedTemplateId: 'free',
    selectedCount: 0,
    draft: '',
    draftEdited: false,
    canSaveAs: false,
    savedSame: false,
    templateId: 'free',
    templates: USE_TEMPLATES,
    summary: '正文',
    maxLength: LIMITS.textMaxLength,
    archive: '',
    txtPath: '',
    error: '',
    notice: '',
    noticeLink: false,
    savedId: '',
    savedDraft: '',
    busy: false
  },

  async onLoad(query) {
    this.pendingSave = null;
    this.id = (query && query.id) || '';
    this.fileToken = createId('arc');
    this.disposed = false;
    const app = getApp();
    const store = await app.ensureReady();
    this.loadedEpoch = app.globalData.sessionEpoch;
    this.loadedStore = store;
    if (!store) {
      this.setData({ ready: true, missing: false, readError: true, error: app.globalData.accountError || '请稍后重试。' });
      return;
    }
    this.build(store);
  },

  /** 进入即给出一份可编辑的自由稿：不让用户在看到结果之前先做一串选择。 */
  build(store) {
    const item = store && store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true, readError: false });
      return;
    }
    const options = currentSupplements(item).map((supplement) => ({
      id: supplement.id,
      content: supplement.content,
      time: formatAbsolute(supplement.createdAt),
      selected: true
    }));
    const selectedIds = options.filter((entry) => entry.selected).map((entry) => entry.id);
    const draft = buildTemplateText(item, selectedIds, this.data.templateId);
    this.pendingSave = null;
    this.setData({
      ready: true, missing: false, readError: false,
      phase: 'edit',
      options,
      selectedCount: selectedIds.length,
      draft,
      draftEdited: false,
      canSaveAs: this.canSaveAs(draft, ''),
      savedSame: false,
      summary: selectedIds.length ? '正文 + ' + selectedIds.length + '条补充' : '正文',
      archive: buildArchiveText(item, Date.now()),
      error: '', notice: '', noticeLink: false, savedId: '', savedDraft: '', busy: false
    });
  },

  /** 另存按钮的可提交性：空稿、超限、与已另存内容逐字相同都不可提交。 */
  canSaveAs(draft, savedDraft) {
    return Boolean(draft && draft.trim()) && draft.length <= LIMITS.textMaxLength && draft !== savedDraft;
  },

  async onShow() {
    const app = getApp();
    if (!this.id || this.loadedEpoch === app.globalData.sessionEpoch) return;
    this.onUnload();
    this.disposed = false;
    this.setData({ ready: false, draft: '', archive: '', options: [], txtPath: '', savedId: '', savedDraft: '' });
    await this.onLoad({ id: this.id });
  },

  onUnload() {
    this.disposed = true;
    this.pendingSave = null;
    const filePath = this.data.txtPath;
    if (!filePath || typeof wx.getFileSystemManager !== 'function') return;
    try {
      wx.getFileSystemManager().unlink({ filePath, fail() {} });
    } catch (err) {
      // 文件是显式生成的本页临时副本；清理失败不影响原记录。
    }
  },

  onRetryLoad() {
    const app = getApp();
    this.setData({ ready: false, readError: false, error: '' });
    app.refreshAccount().then(() => { if (!this.disposed) this.onLoad({ id: this.id }); });
  },

  onBackToList() { wx.switchTab({ url: '/pages/list/index' }); },

  /** 面板本体上的点击不该穿透到遮罩，否则点哪都关。 */
  noop() {},

  // ------------------------------------------------------------ 面板

  onOpenContent() {
    if (this.data.busy) return;
    this.setData({
      phase: 'content',
      stagedOptions: this.data.options.map((entry) => Object.assign({}, entry)),
      stagedTemplateId: this.data.templateId,
      error: '', notice: ''
    });
  },

  onOpenFormat() {
    if (this.data.busy) return;
    this.setData({
      phase: 'format',
      stagedOptions: this.data.options.map((entry) => Object.assign({}, entry)),
      stagedTemplateId: this.data.templateId,
      error: '', notice: ''
    });
  },

  onOpenMore() {
    if (this.data.busy) return;
    this.setData({ phase: 'more', error: '', notice: '' });
  },

  onOpenArchive() {
    if (this.data.busy) return;
    this.setData({ phase: 'archive', error: '', notice: '' });
  },

  onClosePanel() {
    if (this.data.busy) return;
    // 取消面板不改动稿件的任何字节
    this.setData({ phase: 'edit', error: '', notice: '' });
  },

  onToggleSupplement(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    const base = this.data.stagedOptions.length ? this.data.stagedOptions : this.data.options;
    const stagedOptions = base.map((entry) => (
      entry.id === id ? Object.assign({}, entry, { selected: !entry.selected }) : entry
    ));
    this.setData({ stagedOptions, error: '' });
  },

  onTemplateSelect(event) {
    if (this.data.busy) return;
    const templateId = event.currentTarget.dataset.template;
    if (USE_TEMPLATES.some((template) => template.id === templateId)) this.setData({ stagedTemplateId: templateId, error: '' });
  },

  /**
   * 应用「调整内容」或「选择格式」。手工改过的稿件受替换保护：
   * 取消保留当前文字、光标与选择；确认才替换。
   */
  onApply() {
    if (this.data.busy) return;
    const store = getApp().globalData.store;
    const item = store && store.getInspiration(this.id);
    if (!item) {
      this.setData({ missing: true });
      return;
    }
    const stagedOptions = this.data.stagedOptions.length || !this.data.options.length
      ? this.data.stagedOptions : this.data.options;
    const stagedTemplateId = this.data.stagedTemplateId;
    const selectedIds = stagedOptions.filter((entry) => entry.selected).map((entry) => entry.id);
    let generated;
    try {
      generated = buildTemplateText(item, selectedIds, stagedTemplateId);
    } catch (err) {
      this.setData({ error: err.message });
      return;
    }
    const apply = () => {
      if (this.disposed) return;
      this.pendingSave = null;
      // 确认后才把暂存写回：取消（onClosePanel）不改动 options/templateId
      this.setData({
        phase: 'edit',
        options: stagedOptions,
        templateId: stagedTemplateId,
        selectedCount: selectedIds.length,
        draft: generated,
        draftEdited: false,
        canSaveAs: this.canSaveAs(generated, this.data.savedDraft),
        savedSame: Boolean(this.data.savedId && this.data.savedDraft === generated),
        summary: selectedIds.length ? '正文 + ' + selectedIds.length + '条补充' : '正文',
        error: '', notice: '', noticeLink: false
      });
    };
    if (this.data.draftEdited && this.data.draft !== generated) {
      wx.showModal({
        title: '替换当前稿件？',
        content: '你修改过这份稿件。替换后，这些修改不会保留。',
        confirmText: '替换稿件',
        cancelText: '保留编辑',
        success: (result) => { if (result.confirm) apply(); }
      });
    } else apply();
  },

  // ------------------------------------------------------------ 编辑与出口

  onDraftInput(event) {
    const value = event.detail.value;
    if (this.pendingSave && this.pendingSave.text !== value) this.pendingSave = null;
    this.setData({
      draft: value,
      draftEdited: true,
      canSaveAs: this.canSaveAs(value, this.data.savedDraft),
      // 改回与已另存内容逐字相同也算「已另存」，不产生第二条
      savedSame: Boolean(this.data.savedId && this.data.savedDraft === value),
      error: '', notice: '', noticeLink: false
    });
  },

  copyText(text) {
    const app = getApp(), epoch = app.globalData.sessionEpoch;
    if (!text || !text.trim()) {
      this.setData({ error: '没有可复制的内容。', notice: '' });
      return;
    }
    try {
      wx.setClipboardData({
        data: text,
        success: () => { if (this.disposed || epoch !== app.globalData.sessionEpoch) return; this.setData({ error: '', notice: '已复制，可粘贴到需要的地方。', noticeLink: false }); if (text === this.data.draft && app.globalData.metrics) app.globalData.metrics.track('output_copied'); },
        fail: () => this.setData({ error: '复制未完成，请重试。', notice: '' })
      });
    } catch (err) {
      this.setData({ error: '复制未完成，请重试。', notice: '' });
    }
  },

  onCopyDraft() { this.copyText(this.data.draft); },

  onCopyArchive() { this.copyText(this.data.archive); },

  async onSaveAsNew() {
    if (this.data.busy) return;
    const app = getApp(), store = app.globalData.store, epoch = app.globalData.sessionEpoch;
    if (!store || this.disposed || this.loadedEpoch !== epoch) return;
    const draft = this.data.draft;
    if (this.data.savedId && this.data.savedDraft === draft) {
      this.setData({ notice: '这份稿件已另存，可以直接查看。', noticeLink: true, error: '' });
      return;
    }
    if (!draft.trim()) {
      this.setData({ error: '请先写下要保存的内容。', notice: '' });
      return;
    }
    if (draft.length > LIMITS.textMaxLength) {
      this.setData({ error: '另存最多' + LIMITS.textMaxLength + '字符，当前超出' + (draft.length - LIMITS.textMaxLength) + '字符。可先复制，或缩短后另存。', notice: '' });
      return;
    }

    let next;
    try {
      next = this.pendingSave && this.pendingSave.text === draft && this.pendingSave.store === store
        ? this.pendingSave.item : createInspiration({ id: createId('ins'), text: draft, now: Date.now() });
      this.pendingSave = { text: draft, store, item: next };
    } catch (err) {
      this.setData({ error: '暂时无法另存，请检查内容后重试。', notice: '' });
      return;
    }

    this.setData({ busy: true, error: '', notice: '', noticeLink: false });
    let result;
    try {
      result = await store.saveInspiration(next);
    } catch (err) {
      result = null;
    }
    if (this.disposed || epoch !== app.globalData.sessionEpoch || app.globalData.store !== store) return;
    if (!result || !result.ok || result.synced !== true) {
      this.setData({ busy: false, error: '另存失败，稿件还在，可稍后重试或先复制。' });
      return;
    }
    this.setData({
      busy: false,
      savedId: next.id,
      savedDraft: draft,
      savedSame: true,
      canSaveAs: false,
      notice: '已另存为新灵感',
      noticeLink: true
    });
    this.pendingSave = null;
    if (getApp().globalData.metrics) getApp().globalData.metrics.track('output_saved');
  },

  onOpenSaved() {
    if (!this.data.savedId) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.savedId) });
  },

  // ------------------------------------------------------------ 文字留档

  onCreateTxt() {
    if (this.data.busy) return;
    const base = wx.env && wx.env.USER_DATA_PATH;
    if (!base || typeof wx.getFileSystemManager !== 'function') {
      this.setData({ error: '当前设备暂不支持生成文件，可先复制留档文字。', notice: '' });
      return;
    }
    const filePath = base + '/linggan-archive-' + this.fileToken + '.txt';
    const fileSystem = wx.getFileSystemManager();
    this.setData({ busy: true, error: '', notice: '' });
    try {
      fileSystem.writeFile({
        filePath,
        data: this.data.archive,
        encoding: 'utf8',
        success: () => {
          if (this.disposed) {
            try { fileSystem.unlink({ filePath, fail() {} }); } catch (err) { /* 尽力清理 */ }
            return;
          }
          this.setData({
            busy: false,
            txtPath: filePath,
            notice: 'TXT 已生成。可点击下方按钮，自己选择发送到哪里。'
          });
        },
        fail: () => this.setData({ busy: false, error: '文件生成失败，可先复制留档文字。' })
      });
    } catch (err) {
      this.setData({ busy: false, error: '文件生成失败，可先复制留档文字。' });
    }
  },

  onShareTxt() {
    if (!this.data.txtPath || this.data.busy) return;
    if (typeof wx.shareFileMessage !== 'function') {
      this.setData({ error: '当前设备无法发送 TXT 文件，可复制留档文字。', notice: '' });
      return;
    }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      wx.shareFileMessage({
        filePath: this.data.txtPath,
        fileName: '灵感文字留档.txt',
        success: () => this.setData({ busy: false, notice: 'TXT 已发送。外部副本不会随原记录删除。' }),
        fail: () => this.setData({ busy: false, error: '文件未发送，可重试或复制留档文字。' })
      });
    } catch (err) {
      this.setData({ busy: false, error: '文件未发送，可重试或复制留档文字。' });
    }
  }
});
