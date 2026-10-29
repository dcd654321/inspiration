const { LIMITS, createId } = require('../../core/limits');
const { createInspiration } = require('../../core/inspiration');
const { pageGuard } = require('../../services/page-session');
const { draftContext, sourceVersion } = require('../../services/session-drafts');
const { makeTodo, localDate, dateAfter, isValidDate } = require('../../core/todo');
const { createRequestId } = require('../../services/wx-transport');
const { organize } = require('../../services/organization');
const { loadPrivatePhotos } = require('../../services/private-photos');

const DISPLAY_ERRORS = {
  EMPTY_TEXT: '写点内容再保存',
  TEXT_TOO_LONG: '正文最多 ' + LIMITS.textMaxLength + ' 字符'
};

/** 网络类失败不能推断服务端有没有写入——这类码是「结果未知」，不是「确定没保存」。 */
const UNKNOWN_CODES = ['NETWORK', 'INTERNAL', 'PULL_FAILED'];

async function saveCapture(store, operation) {
  if (operation.attempted) {
    if (typeof store.refresh === 'function') {
      const refreshed = await store.refresh();
      if (!refreshed || !refreshed.ok) return refreshed || { ok: false, code: 'NETWORK' };
    }
    const revision = typeof store.getConfirmedRevision === 'function' ? store.getConfirmedRevision() : null;
    if (operation.revision && revision && operation.revision.generation !== revision.generation) {
      return { ok: false, code: 'STALE_GENERATION', message: '账户状态已变化，请重新核对后保存。' };
    }
    const actual = typeof store.getInspiration === 'function' ? store.getInspiration(operation.item.id) : null;
    if (actual && sourceVersion(actual) === sourceVersion(operation.item)) return { ok: true, synced: true };
    if (operation.revision && revision && operation.revision.baseVersion !== revision.baseVersion) {
      return { ok: false, code: 'CONFLICT', message: '内容已更新，请到灵感列表核对后再保存。' };
    }
  }
  operation.attempted = true;
  return store.saveInspiration(operation.item, { expectedRevision: operation.revision, requestId: operation.requestId });
}

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
    lastSavedExcerpt: '',
    draftRecoveryNotice: '',
    todoEnabled: false,
    todoDueDate: '',
    todayDate: '',
    tomorrowDate: '',
    tagsDraft: '', photoBusy: false, photoError: '', photos: []
  },

  async onShow() {
    this.visible = true;
    this.setData({ todayDate: localDate(), tomorrowDate: dateAfter(1) });
    const version = this.viewVersion = (this.viewVersion || 0) + 1;
    const app = getApp(), revision = this.inputRevision || 0;
    const startIntent = app.globalData.captureStartIntent;
    const entryEpoch = app.globalData.sessionEpoch;
    const validEntryIntent = startIntent && startIntent.epoch === entryEpoch &&
      Number.isFinite(startIntent.expiresAt) && startIntent.expiresAt > Date.now();
    delete app.globalData.captureStartIntent;
    const entryOwner = draftContext(app, app.globalData.store);
    const entrySaved = entryOwner && app.globalData.sessionDrafts && app.globalData.sessionDrafts.get('capture', entryOwner);
    const hadEntryInput = Boolean(this.data.draft || this.data.tagsDraft || this.pendingSave ||
      entrySaved && (entrySaved.data && (entrySaved.data.draft || entrySaved.data.tagsDraft) || entrySaved.pendingSave));
    // 入口模式不等待账户读取，避免用户已开始输入后才被当成一份旧稿。
    if (validEntryIntent && !hadEntryInput) {
      this.setData({ lastSavedId: '', lastSavedExcerpt: '', draftRecoveryNotice: '',
        todoEnabled: startIntent.todo === true, todoDueDate: '' });
    }
    let store, readyEpoch = entryEpoch;
    try {
      const pending = app.ensureReady();
      readyEpoch = app.globalData.sessionEpoch;
      store = await pending;
    } catch (err) { store = null; }
    if (this.visible === false || this.viewVersion !== version ||
        app.globalData.sessionEpoch !== readyEpoch || (store && app.globalData.store !== store)) return;
    const scope = app.globalData.cacheScope;
    if (this.scope && scope && scope !== this.scope) {
      this.pendingSave = null;
      guardDraft(false);
      this.setData({ draft: '', tagsDraft: '', photos: [], photoBusy: false, photoError: '', canSave: false, overBy: 0, nearLimit: false, saving: false, status: '', errorText: '', copyNotice: '', lastSavedId: '', lastSavedExcerpt: '', todoEnabled: false, todoDueDate: '' });
    }
    if (scope) this.scope = scope;
    this.draftOwner = draftContext(app, store);
    const saved = app.globalData.sessionDrafts && this.draftOwner && app.globalData.sessionDrafts.get('capture', this.draftOwner);
    if (saved && revision === (this.inputRevision || 0) && !this.data.draft && !this.data.tagsDraft) {
      this.pendingSave = saved.pendingSave;
      this.setData(Object.assign({}, saved.data, { saving: false, photoBusy: false, photos: [], photoError: '', todayDate: localDate(), tomorrowDate: dateAfter(1),
        draftRecoveryNotice: saved.data.lastSavedId ? '已接续这次已记下的想法。' : '已接续这次未完成的记录。' }));
      if (this.pendingSave && store.getInspiration && sourceVersion(store.getInspiration(this.pendingSave.item.id)) === sourceVersion(this.pendingSave.item)) {
        this.setData({ draft: '', canSave: false, status: '', lastSavedId: this.pendingSave.item.id,
          lastSavedExcerpt: this.pendingSave.text, tagsDraft: '', todoEnabled: false, todoDueDate: '' });
        this.pendingSave = null;
        app.globalData.sessionDrafts.remove('capture', this.draftOwner);
      }
    }
    if (validEntryIntent && startIntent.expiresAt > Date.now() && revision === (this.inputRevision || 0) &&
        !this.data.draft && !this.data.tagsDraft && !this.pendingSave) {
      this.setData({ lastSavedId: '', lastSavedExcerpt: '', draftRecoveryNotice: '',
        todoEnabled: startIntent.todo === true, todoDueDate: '' });
    } else if (validEntryIntent && startIntent.todo === true && hadEntryInput && (this.data.draft || this.pendingSave)) {
      this.setData({ draftRecoveryNotice: '请先保存或清空当前输入，再记待办。' });
    }
    guardDraft(Boolean(this.data.draft || this.data.tagsDraft));
    if (this.data.lastSavedId && typeof this.loadCapturePhotos === 'function') this.loadCapturePhotos();
  },

  onHide() {
    const app = getApp();
    if (this.visible !== false && this.draftOwner && app.globalData.sessionDrafts) {
      const data = Object.assign({}, this.data, { saving: false, inputFocus: false, photos: [], photoBusy: false, photoError: '' });
      if (this.data.saving && this.pendingSave) data.status = 'unknown';
      if (this.data.draft || this.data.tagsDraft || this.pendingSave || this.data.lastSavedId) {
        app.globalData.sessionDrafts.put('capture', this.draftOwner, { data, pendingSave: this.pendingSave });
      } else app.globalData.sessionDrafts.remove('capture', this.draftOwner);
      this.setData({ draft: '', tagsDraft: '', photos: [], photoBusy: false, photoError: '', canSave: false, saving: false, status: '', errorText: '', copyNotice: '', lastSavedId: '', lastSavedExcerpt: '', draftRecoveryNotice: '', todoEnabled: false, todoDueDate: '' });
      this.pendingSave = null; this.scope = ''; this.draftOwner = null;
    }
    this.visible = false;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    this.viewVersion = (this.viewVersion || 0) + 1;
    this.setData({ inputFocus: false, photoBusy: false, photos: [], photoError: '' });
    if (this.data.saving) this.setData({ saving: false, status: 'unknown' });
    guardDraft(false);
  },

  onUnload() { this.onHide(); },

  onInput(event) {
    if (this.data.saving || this.data.photoBusy || this.visible === false) return;
    const value = event.detail.value;
    this.inputRevision = (this.inputRevision || 0) + 1;
    if (this.pendingSave && this.pendingSave.text !== value) this.pendingSave = null;
    const overBy = Math.max(0, value.length - LIMITS.textMaxLength);
    const canEdit = value.trim().length > 0 && overBy === 0;
    // 结果未知时输入框仍然可用：用户改了内容就回到普通编辑态，旧的未确认状态随之撤下
    guardDraft(Boolean(value || this.data.tagsDraft));
    this.setData({
      draft: value,
      canSave: canEdit,
      overBy,
      // 超过上限 90% 时计数器转警示色
      nearLimit: value.length > LIMITS.textMaxLength * 0.9,
      status: '',
      errorText: '',
      copyNotice: '',
      draftRecoveryNotice: '',
      // 用户重新开始输入就清掉上一条成功卡与失败提示——它们还挂着只会让人以为说的是这次
      lastSavedId: '',
      lastSavedExcerpt: '', photos: [], photoError: ''
    });
  },

  onFocus() {
    if (this.data.saving || this.visible === false) return;
    this.setData({ inputFocus: true });
  },

  onBlur() { this.setData({ inputFocus: false }); },

  onTagsInput(event) {
    if (this.data.saving || this.data.photoBusy || this.visible === false) return;
    if (event.detail.value === this.data.tagsDraft) return;
    this.inputRevision = (this.inputRevision || 0) + 1;
    this.pendingSave = null;
    this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    this.setData({ tagsDraft: event.detail.value, status: '', errorText: '', lastSavedId: '', lastSavedExcerpt: '', photos: [], photoError: '', draftRecoveryNotice: '' });
    guardDraft(Boolean(this.data.draft || this.data.tagsDraft));
  },

  onAddPhoto() {
    if (this.visible === false || this.data.saving || this.data.photoBusy) return;
    if (!this.data.draft.trim() && !this.data.lastSavedId) {
      this.setData({ photoError: '先写下一点内容，再添加照片。' }); return;
    }
    const isCurrent = pageGuard(this), revision = this.inputRevision || 0;
    wx.showActionSheet({ itemList: ['拍照', '从相册选择'], success: (result) => {
      if (isCurrent() && revision === (this.inputRevision || 0) && [0, 1].includes(result.tapIndex)) {
        this.addPhotos(result.tapIndex === 0 ? 'camera' : 'album');
      }
    } });
  },

  async addPhotos(source) {
    if (this.visible === false || this.data.saving || this.data.photoBusy || !['camera', 'album'].includes(source)) return;
    const version = this.viewVersion, revision = this.inputRevision || 0;
    if (this.data.draft.trim()) await this.onSave();
    if (this.visible === false || this.viewVersion !== version || revision !== (this.inputRevision || 0)) return;
    const app = getApp(), store = app.globalData.store, service = app.globalData.photos;
    const id = this.data.lastSavedId;
    if (!id || this.data.status) return;
    if (!store || !service || (this.scope && this.scope !== app.globalData.cacheScope)) {
      this.setData({ photoError: '暂时无法添加照片，请稍后重试。' }); return;
    }
    const current = pageGuard(this);
    this.setData({ photoBusy: true, photoError: '' });
    let result;
    try { result = await service.add(id, source); }
    catch (_) { result = { ok: false, message: '尚未确认照片是否添加，请重新读取后查看。' }; }
    if (!current() || app.globalData.photos !== service || this.data.lastSavedId !== id) return;
    this.setData({ photoBusy: false, photoError: result && result.message || '' });
    await this.loadCapturePhotos();
  },

  async loadCapturePhotos() {
    const app = getApp(), store = app.globalData.store, id = this.data.lastSavedId;
    const readVersion = this.photoReadVersion = (this.photoReadVersion || 0) + 1;
    const pageCurrent = pageGuard(this);
    const isCurrent = () => pageCurrent() && this.photoReadVersion === readVersion && this.data.lastSavedId === id;
    if (!id || !store || !isCurrent()) return;
    const item = store.getInspiration(id), originals = item && item.photos || [];
    this.setData({ photos: originals.map(photo => ({ id: photo.id, src: '', failed: false })) });
    const photos = await loadPrivatePhotos(originals, { cacheScope: app.globalData.cacheScope, isCurrent });
    if (isCurrent()) this.setData({ photos });
  },

  onPreviewCapturePhoto(event) {
    if (this.visible === false || this.data.photoBusy || !this.data.lastSavedId) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.photos.some(photo => photo.id === id && photo.src)) return;
    wx.navigateTo({ url: '/pages/photo-viewer/index?id=' + encodeURIComponent(this.data.lastSavedId) + '&photo=' + encodeURIComponent(id) });
  },

  onCapturePhotoError(event) {
    if (this.visible === false) return;
    const { id, src } = event.currentTarget.dataset;
    this.setData({ photos: this.data.photos.map(photo => photo.id === id && photo.src === src ? Object.assign({}, photo, { src: '', failed: true }) : photo) });
  },

  onToggleTodo() {
    if (this.data.saving || this.data.photoBusy || this.data.status === 'unknown' || this.visible === false) return;
    this.inputRevision = (this.inputRevision || 0) + 1;
    this.pendingSave = null;
    this.setData({ todoEnabled: !this.data.todoEnabled, todoDueDate: '', draftRecoveryNotice: '',
      todayDate: localDate(), tomorrowDate: dateAfter(1) });
  },

  onTodoDate(event) {
    if (!this.data.todoEnabled || this.data.saving || this.data.photoBusy || this.data.status === 'unknown' || this.visible === false) return;
    const kind = event.currentTarget.dataset.kind;
    if (!['none', 'today', 'tomorrow'].includes(kind)) return;
    this.inputRevision = (this.inputRevision || 0) + 1;
    this.pendingSave = null;
    this.setData({ todoDueDate: kind === 'none' ? '' : kind === 'today' ? localDate() : dateAfter(1),
      todayDate: localDate(), tomorrowDate: dateAfter(1) });
  },

  onTodoDateChange(event) {
    if (!this.data.todoEnabled || this.data.saving || this.data.photoBusy || this.data.status === 'unknown' || this.visible === false) return;
    const value = event.detail.value;
    if (isValidDate(value)) {
      this.inputRevision = (this.inputRevision || 0) + 1;
      this.pendingSave = null; this.setData({ todoDueDate: value, todayDate: localDate(), tomorrowDate: dateAfter(1) });
    }
  },

  async onSave() {
    if (this.data.saving || this.data.photoBusy || this.visible === false) return;

    const text = this.data.draft;
    if (text.trim().length === 0 || text.length > LIMITS.textMaxLength) return; // 按钮已 disabled，这里是兜底

    const tagsText = this.data.tagsDraft || '';
    const tags = [...new Set(tagsText.split(/[\s,，]+/).filter(Boolean))];
    // 标签在读取账户和发送写入前校验，避免正文已保存而标签随后被拒绝。
    try { organize({ tags: [], stage: 'seed' }, { tags, stage: 'seed', now: 0 }); }
    catch (err) { this.setData({ status: 'rejected', errorText: err.message }); return; }
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
    const owner = draftContext(app, store);
    if (this.pendingSave && this.pendingSave.generation && (!owner || this.pendingSave.generation !== owner.generation)) {
      this.pendingSave = null;
      this.setData({ saving: false, status: 'rejected', errorText: '账户状态已变化，请重新核对后保存。' });
      return;
    }
    if (owner) { this.draftOwner = owner; this.scope = owner.cacheScope; }

    // 当前会话内重试同一内容时复用记录标识；不会把待写内容持久化到设备。
    let inspiration;
    try {
      const now = Date.now();
      const previous = this.pendingSave && this.pendingSave.text === text && (this.pendingSave.tagsText || '') === tagsText && this.pendingSave.scope === app.globalData.cacheScope
        ? this.pendingSave : null;
      inspiration = previous ? previous.item : organize(createInspiration({ text, id: createId('insp'), now,
        todo: this.data.todoEnabled ? makeTodo(now, this.data.todoDueDate || null) : null }), { tags, stage: 'seed', now });
      this.pendingSave = previous || { text, tagsText, scope: app.globalData.cacheScope, generation: owner && owner.generation,
        item: inspiration, revision: typeof store.getConfirmedRevision === 'function' ? store.getConfirmedRevision() : null,
        requestId: createRequestId(), attempted: false };
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
      result = await saveCapture(store, this.pendingSave);
    } catch (err) {
      threw = true;
    }
    if (this.visible === false || this.viewVersion !== version || app.globalData.sessionEpoch !== epoch || app.globalData.store !== store) return;
    this.setData({ saving: false });
    const metrics = app.globalData.store === store && app.globalData.metrics;
    if (metrics) metrics.track(result && result.ok && result.synced === true ? 'record_saved' : 'save_failed');

    if (!threw && result && result.ok && result.synced === true) {
      this.pendingSave = null;
      if (app.globalData.sessionDrafts && this.draftOwner) app.globalData.sessionDrafts.remove('capture', this.draftOwner);
      guardDraft(false);
      this.setData({
        draft: '', canSave: false, overBy: 0, nearLimit: false, inputFocus: false, status: '', errorText: '', copyNotice: '',
        lastSavedId: inspiration.id, lastSavedExcerpt: text, tagsDraft: '', todoEnabled: false, todoDueDate: ''
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

  onOrganizeSaved() {
    if (!this.data.lastSavedId || this.visible === false) return;
    const app = getApp();
    if (this.scope && app.globalData.cacheScope !== this.scope) return;
    wx.navigateTo({ url: '/pages/output/index?id=' + encodeURIComponent(this.data.lastSavedId) });
  },

  onRecordAnother() {
    if (this.data.saving || this.data.photoBusy || this.visible === false || !this.data.lastSavedId || this.data.draft || this.pendingSave) return;
    this.setData({ lastSavedId: '', lastSavedExcerpt: '', tagsDraft: '', photos: [], photoError: '', draftRecoveryNotice: '', inputFocus: true });
  }
});
