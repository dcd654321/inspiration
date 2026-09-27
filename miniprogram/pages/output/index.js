const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');
const { formatAbsolute } = require('../../core/format');
const { currentSupplements, buildUseText, buildArchiveText } = require('../../services/content-output');

Page({
  data: {
    ready: false,
    missing: false,
    mode: 'organize',
    phase: 'select',
    options: [],
    selectedCount: 0,
    draft: '',
    maxLength: LIMITS.textMaxLength,
    archive: '',
    txtPath: '',
    error: '',
    notice: '',
    savedId: '',
    busy: false
  },

  async onLoad(query) {
    this.id = (query && query.id) || '';
    this.fileToken = createId('arc');
    this.disposed = false;
    const app = getApp();
    const store = await app.ensureReady();
    this.loadedEpoch = app.globalData.sessionEpoch;
    const item = store && store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true });
      return;
    }
    const options = currentSupplements(item).map((supplement) => ({
      id: supplement.id,
      content: supplement.content,
      time: formatAbsolute(supplement.createdAt),
      selected: true
    }));
    this.setData({
      ready: true,
      options,
      selectedCount: options.length,
      archive: buildArchiveText(item, Date.now())
    });
  },

  async onShow() {
    const app = getApp();
    if (!this.id || this.loadedEpoch === app.globalData.sessionEpoch) return;
    this.onUnload();
    this.setData({ ready: false, draft: '', archive: '', options: [], txtPath: '' });
    await this.onLoad({ id: this.id });
  },

  onUnload() {
    this.disposed = true;
    const filePath = this.data.txtPath;
    if (!filePath || typeof wx.getFileSystemManager !== 'function') return;
    try {
      wx.getFileSystemManager().unlink({ filePath, fail() {} });
    } catch (err) {
      // 文件是显式生成的本页临时副本；清理失败不影响原记录。
    }
  },

  onModeChange(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode !== 'organize' && mode !== 'archive') return;
    this.setData({ mode, error: '', notice: '' });
  },

  onToggleSupplement(event) {
    const id = event.currentTarget.dataset.id;
    const options = this.data.options.map((entry) => (
      entry.id === id ? Object.assign({}, entry, { selected: !entry.selected }) : entry
    ));
    this.setData({
      options,
      selectedCount: options.filter((entry) => entry.selected).length,
      error: ''
    });
  },

  onGenerate() {
    const store = getApp().globalData.store;
    const item = store && store.getInspiration(this.id);
    if (!item) {
      this.setData({ missing: true });
      return;
    }
    const ids = this.data.options.filter((entry) => entry.selected).map((entry) => entry.id);
    this.setData({
      phase: 'edit',
      draft: buildUseText(item, ids),
      error: '',
      notice: '',
      savedId: ''
    });
  },

  onBackToSelection() {
    if (this.data.busy) return;
    this.setData({ phase: 'select', error: '', notice: '' });
  },

  onDraftInput(event) {
    this.setData({ draft: event.detail.value, error: '', notice: '', savedId: '' });
  },

  copyText(text) {
    if (!text || !text.trim()) {
      this.setData({ error: '没有可复制的内容。', notice: '' });
      return;
    }
    try {
      wx.setClipboardData({
        data: text,
        success: () => this.setData({ error: '', notice: '已复制，可粘贴到需要的地方。' }),
        fail: () => this.setData({ error: '复制未完成，请稍后重试。', notice: '' })
      });
    } catch (err) {
      this.setData({ error: '复制未完成，请稍后重试。', notice: '' });
    }
  },

  onCopyDraft() {
    this.copyText(this.data.draft);
  },

  onCopyArchive() {
    this.copyText(this.data.archive);
  },

  async onSaveAsNew() {
    if (this.data.busy) return;
    const draft = this.data.draft;
    if (!draft.trim()) {
      this.setData({ error: '请先写下要保存的内容。', notice: '' });
      return;
    }
    if (draft.length > LIMITS.textMaxLength) {
      this.setData({ error: '使用稿超过 ' + LIMITS.textMaxLength + ' 字，可先复制，或缩短后另存。', notice: '' });
      return;
    }

    let next;
    try {
      next = createInspiration({ id: createId('ins'), text: draft, now: Date.now() });
    } catch (err) {
      this.setData({ error: '暂时无法另存，请检查内容后重试。', notice: '' });
      return;
    }

    this.setData({ busy: true, error: '', notice: '' });
    let result;
    try {
      result = await getApp().globalData.store.saveInspiration(next);
    } catch (err) {
      result = null;
    }
    if (!result || !result.ok) {
      this.setData({ busy: false, error: '另存失败，使用稿还在，可稍后重试或先复制。' });
      return;
    }
    this.setData({
      busy: false,
      savedId: next.id,
      notice: result.synced
        ? '已另存为新灵感，原记录未改动。'
        : '已另存，但备份未完成。请暂时不要清理小程序数据。'
    });
  },

  onOpenSaved() {
    if (!this.data.savedId) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.savedId) });
  },

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
