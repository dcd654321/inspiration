const { listMaterials, buildMaterialDraft, MATERIAL_LIMITS } = require('../../services/material-output');
const { USE_TEMPLATES } = require('../../services/content-output');
const { createInspiration } = require('../../core/inspiration');
const { createId, LIMITS } = require('../../core/limits');
const { formatAbsolute } = require('../../core/format');

function initialData() {
  return { ready: false, phase: 'select', options: [], total: 0, query: '', selectedOnly: false,
    selectedCount: 0, sourceCount: 0, templates: USE_TEMPLATES, templateId: 'free', draft: '', draftEdited: false,
    maxLength: LIMITS.textMaxLength, savedId: '', savedDraft: '', busy: false, error: '', notice: '' };
}

Page({
  data: initialData(),
  onLoad() { return this.load(); },
  onShow() { if (!this.active) return this.load(); },
  onHide() { this.suspend(); },
  onUnload() { this.suspend(); },
  suspend() {
    this.active = false; this.session = (this.session || 0) + 1; this.store = null;
    this.materials = []; this.selected = []; this.pendingSave = null; this.setData(initialData());
  },
  async load() {
    this.active = true; const session = this.session = (this.session || 0) + 1;
    this.materials = []; this.selected = []; this.pendingSave = null; this.selectionVersion = 0; this.setData(initialData());
    const app = getApp();
    try {
      const store = await app.ensureReady();
      if (!this.active || session !== this.session || store !== app.globalData.store) return;
      if (!store) { this.setData({ ready: true, error: '暂时无法读取素材，请联网后重试。' }); return; }
      this.store = store; this.epoch = app.globalData.sessionEpoch;
      this.materials = listMaterials(store.listInspirations());
      this.setData({ ready: true }); this.renderOptions();
    } catch (err) {
      if (this.active && session === this.session) this.setData({ ready: true, error: '暂时无法读取素材，请稍后重试。' });
    }
  },
  current(session = this.session) {
    const app = getApp();
    if (!this.active || session !== this.session || !this.store) return false;
    if (this.store !== app.globalData.store || this.epoch !== app.globalData.sessionEpoch) {
      this.suspend(); this.setData({ ready: true, error: '账户状态已变化，请重新读取素材。' }); return false;
    }
    return true;
  },
  renderOptions() {
    const query = this.data.query.trim().toLocaleLowerCase();
    const order = new Map(this.selected.map((entry, index) => [entry.key, index + 1]));
    const options = this.materials.filter((entry) => (!this.data.selectedOnly || order.has(entry.key)) &&
      (!query || (entry.content + '\n' + entry.sourceText).toLocaleLowerCase().includes(query)))
      .map((entry) => Object.assign({}, entry, { selected: order.has(entry.key), order: order.get(entry.key) || 0, time: formatAbsolute(entry.createdAt) }));
    this.setData({ options, total: this.materials.length, selectedCount: this.selected.length,
      sourceCount: new Set(this.selected.map((entry) => entry.inspirationId)).size });
  },
  onSearch(event) { if (this.current()) { this.setData({ query: event.detail.value }); this.renderOptions(); } },
  onSelectedOnly() { if (this.current()) { this.setData({ selectedOnly: !this.data.selectedOnly }); this.renderOptions(); } },
  onToggle(event) {
    if (!this.current() || this.data.busy) return;
    const key = event.currentTarget.dataset.key;
    const found = this.materials.find((entry) => entry.key === key);
    if (!found) return;
    const exists = this.selected.some((entry) => entry.key === key);
    if (!exists && this.selected.length >= MATERIAL_LIMITS.parts) { this.setData({ error: '每次最多选择四十段素材。' }); return; }
    this.selected = exists ? this.selected.filter((entry) => entry.key !== key) : this.selected.concat([found]);
    this.selectionVersion++; this.setData({ error: '' }); this.renderOptions();
  },
  onTemplate(event) {
    if (!this.current() || this.data.busy) return;
    const templateId = event.currentTarget.dataset.template;
    if (USE_TEMPLATES.some((entry) => entry.id === templateId)) { this.selectionVersion++; this.setData({ templateId }); }
  },
  onRefresh() {
    if (!this.current() || this.data.busy) return;
    const session = this.session;
    wx.showModal({ title: '刷新素材？', content: '将读取最新内容并清空选材，已生成的稿件不会改变。', confirmText: '刷新', cancelText: '取消', success: (result) => {
      if (!result.confirm || !this.current(session)) return;
      try {
        this.materials = listMaterials(this.store.listInspirations()); this.selected = []; this.selectionVersion++;
        this.setData({ error: '' }); this.renderOptions();
      } catch (err) { this.setData({ error: '素材未能刷新，当前稿件仍保留。' }); }
    } });
  },
  onGenerate() {
    if (!this.current() || this.data.busy) return;
    const session = this.session, revision = this.selectionVersion, oldDraft = this.data.draft;
    const apply = () => {
      if (!this.current(session) || revision !== this.selectionVersion || oldDraft !== this.data.draft) return;
      try {
        const result = buildMaterialDraft(this.store.listInspirations(), this.selected, this.data.templateId);
        if (this.pendingSave && this.pendingSave.text !== result.text) this.pendingSave = null;
        this.setData({ phase: 'edit', draft: result.text, draftEdited: false, error: '', notice: '' }, () => this.scrollTop(session));
      } catch (err) { this.setData({ error: err.message }); }
    };
    if (this.data.draftEdited) {
      wx.showModal({ title: '替换当前使用稿？', content: '你编辑过当前稿件。重新生成将替换这些编辑，来源记录不会改变。', confirmText: '替换', cancelText: '保留',
        success: (result) => { if (result.confirm) apply(); } });
    } else apply();
  },
  scrollTop(session) {
    if (this.current(session) && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  onBackToSelection() {
    if (!this.current() || this.data.busy) return;
    const session = this.session; this.setData({ phase: 'select', error: '', notice: '' }, () => this.scrollTop(session));
  },
  onResumeDraft() {
    if (!this.current() || !this.data.draft) return;
    const session = this.session; this.setData({ phase: 'edit', error: '' }, () => this.scrollTop(session));
  },
  onInput(event) { if (this.current() && !this.data.busy) { if (this.pendingSave && this.pendingSave.text !== event.detail.value) this.pendingSave = null; this.setData({ draft: event.detail.value, draftEdited: true, error: '', notice: '' }); } },
  onCopy() {
    if (!this.current() || this.data.busy) return;
    const text = this.data.draft, session = this.session;
    if (!text.trim()) { this.setData({ error: '没有可复制的内容。' }); return; }
    this.setData({ busy: true, error: '', notice: '' });
    const finish = (success) => {
      if (!this.current(session)) return;
      this.setData({ busy: false, error: success ? '' : '复制未完成，稿件仍保留，可重试。', notice: success ? '已复制，可粘贴到需要的地方。' : '' });
      if (success && getApp().globalData.metrics) getApp().globalData.metrics.track('output_copied');
    };
    try { wx.setClipboardData({ data: text, success: () => finish(true), fail: () => finish(false) }); }
    catch (err) { finish(false); }
  },
  async onSave() {
    if (!this.current() || this.data.busy) return;
    const text = this.data.draft, session = this.session, store = this.store;
    if (this.data.savedId && this.data.savedDraft === text) { this.setData({ notice: '这份稿件已另存，可直接查看。' }); return; }
    if (!text.trim() || text.length > LIMITS.textMaxLength) { this.setData({ error: '另存需要 1 至 2000 字。超长稿件可完整复制，或缩短后另存。' }); return; }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const item = this.pendingSave && this.pendingSave.text === text && this.pendingSave.store === store
        ? this.pendingSave.item : createInspiration({ id: createId('ins'), text, now: Date.now() });
      this.pendingSave = { text, store, item };
      const result = await store.saveInspiration(item);
      if (!this.current(session)) return;
      if (!result || !result.ok || result.synced !== true) throw Error('SAVE_FAILED');
      this.setData({ busy: false, savedId: item.id, savedDraft: text,
        notice: '已另存为新灵感，来源记录未改动。' });
      this.pendingSave = null;
      if (getApp().globalData.metrics) getApp().globalData.metrics.track('output_saved');
    } catch (err) {
      if (this.current(session)) this.setData({ busy: false, error: '另存未完成，稿件仍保留，可重试或先复制。' });
    }
  },
  onOpenSaved() { if (this.current() && this.data.savedId) wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.savedId) }); },
  onBack() { wx.navigateBack(); }
});
