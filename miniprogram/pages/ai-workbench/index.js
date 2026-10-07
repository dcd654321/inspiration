const core = require('../../core/inspiration');
const { createId, LIMITS } = require('../../core/limits');
const { buildUseText } = require('../../services/content-output');
const { createWxAi, acceptDraft, acceptSummary } = require('../../services/ai-workflow');
const config = require('../../config/ai');
function guardPreview(hasPreview) {
  try {
    if (hasPreview && typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: 'AI 预览尚未保存，离开后不会保留。' });
    else if (!hasPreview && typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  } catch (err) { /* 页面常驻说明仍可提醒。 */ }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
  return value;
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
Page({
  data: { ready: false, enabled: false, scope: 'expand', options: [], preview: false, entries: [], summary: '',
    mode: '', targetId: '', selectedCount: 0, targets: [], busy: false, busyKind: '', completed: false, error: '', notice: '',
    loadError: false, selectionHint: '', sourceChars: 0, canGenerate: false, acceptedCount: 0, canAccept: false,
    saveUnknown: false, savedId: '', originalExpanded: false, summarySaveMax: LIMITS.summaryMaxLength, acceptHint: '' },
  async onLoad(query) {
    guardPreview(false);
    this.query = query || {};
    this.id = this.query.id || '';
    this.alive = true;
    const load = this.sequence = (this.sequence || 0) + 1;
    this.pendingSave = null; this.snapshot = null;
    this.setData({ ready: false, preview: false, completed: false, entries: [], summary: '', error: '', notice: '', loadError: false,
      busy: false, busyKind: '', saveUnknown: false, savedId: '', mode: '', targetId: '', acceptedCount: 0, acceptHint: '' });
    const app = getApp(); let store;
    try { store = await app.ensureReady(); } catch (err) { store = null; }
    if (!this.alive || load !== this.sequence || store && store !== app.globalData.store) return;
    this.epoch = app.globalData.sessionEpoch;
    this.store = store;
    const scope = ['expand', 'supplements', 'inspirations'].includes(this.query.scope) ? this.query.scope : 'expand';
    const item = store && store.getInspiration(this.id);
    if (!store || scope !== 'inspirations' && (!item || item.deletedAt || item.mergedInto)) {
      this.setData({ ready: true, loadError: true, error: '暂时无法读取内容，请联网后重新读取。' }); return;
    }
    this.ai = createWxAi(config);
    const options = scope === 'inspirations'
      ? store.listInspirations().map((x) => ({ id: x.id, content: buildUseText(x), selected: false }))
      : core.activeSupplements(item).map((x) => ({ id: x.id, content: x.content, selected: false }));
    this.setData({ ready: true, enabled: config.enabled, scope, options, completed: false, notice: '', title: scope === 'expand' ? 'AI 扩展想法' : 'AI 汇总内容', error: '', original: item ? item.text : '', originalExpanded: false,
      summarySaveMax: LIMITS.summaryMaxLength });
    this.updateSelection();
  },
  async onShow() {
    if (this.query && !this.alive) await this.onLoad(this.query);
  },
  onHide() { this.onUnload(); },
  onUnload() {
    guardPreview(false);
    this.alive = false; this.snapshot = null; this.store = null; this.sequence = (this.sequence || 0) + 1;
    this.pendingSave = null;
    this.setData({ ready: false, options: [], entries: [], summary: '', original: '', preview: false, busy: false, targets: [], mode: '', targetId: '', selectedCount: 0 });
  },
  current() { return this.alive && getApp().globalData.sessionEpoch === this.epoch && getApp().globalData.store === this.store; },
  updateSelection() {
    const selected = this.data.options.filter((x) => x.selected);
    const sourceChars = selected.reduce((n, x) => n + x.content.length, this.data.scope === 'expand' ? this.data.original.length : 0);
    let selectionHint = '';
    if (this.data.scope === 'expand' && this.data.original.trim().length < 8) selectionHint = '正文至少需要 8 个字，可返回继续补充。';
    else if (this.data.scope !== 'expand' && selected.length < 2) selectionHint = '请选择至少两条相关内容。';
    else if (selected.length > LIMITS.summaryMaxSourceItems) selectionHint = '每次最多选择 20 条内容。';
    else if (sourceChars > LIMITS.summaryMaxSourceChars) selectionHint = '文字总量超过 12000 字，请减少选择。';
    this.setData({ selectedCount: selected.length, sourceChars, selectionHint, canGenerate: !selectionHint });
  },
  updateAccept() {
    const acceptedCount = this.data.entries.filter((x) => x.selected).length;
    const acceptHint = this.data.scope !== 'expand' && this.data.summary.length > this.data.summarySaveMax
      ? '保存最多 ' + this.data.summarySaveMax + ' 字，当前超出 ' + (this.data.summary.length - this.data.summarySaveMax) + ' 字。请缩短后保存，或先复制。' : '';
    const canAccept = this.data.scope === 'expand' ? acceptedCount > 0 && this.data.entries.filter((x) => x.selected).every((x) => x.content.trim())
      : Boolean(!acceptHint && this.data.summary.trim() && this.data.mode && (this.data.mode !== 'overwrite' || this.data.scope !== 'inspirations' || this.data.targetId));
    this.setData({ acceptedCount, canAccept, acceptHint });
  },
  onToggleOriginal() { if (!this.data.busy) this.setData({ originalExpanded: !this.data.originalExpanded }); },
  onSelect(event) {
    if (!this.current() || this.data.busy || this.data.preview) return;
    const ids = event.detail.value;
    this.setData({ options: this.data.options.map((x) => Object.assign({}, x, { selected: ids.includes(x.id) })), error: '' });
    this.updateSelection();
  },
  sourceSnapshot() {
    const sourceIds = this.data.options.filter((x) => x.selected).map((x) => x.id);
    if (this.data.scope === 'inspirations') return sourceIds.map((id) => this.store.getInspiration(id));
    return [this.store.getInspiration(this.id)];
  },
  async onGenerate() {
    if (!this.current() || this.data.busy || !this.data.enabled || this.data.completed) return;
    if (this.data.preview) return;
    this.updateSelection();
    if (!this.data.canGenerate) { this.setData({ error: this.data.selectionHint }); return; }
    const selected = this.data.options.filter((x) => x.selected);
    if (this.data.scope !== 'expand' && selected.length < 2) { this.setData({ error: '请至少选择两条内容。' }); return; }
    const snapshot = this.sourceSnapshot();
    if (snapshot.some((x) => !x || x.deletedAt || x.mergedInto)) { this.setData({ error: '来源已变化，请返回后重试。' }); return; }
    const latest = this.data.scope === 'inspirations' ? snapshot.map((item) => ({ id: item.id, content: buildUseText(item) }))
      : core.activeSupplements(snapshot[0]);
    if (this.data.scope !== 'inspirations' && snapshot[0].text !== this.data.original ||
        selected.some((option) => !latest.some((item) => item.id === option.id && item.content === option.content))) {
      await this.onLoad(this.query);
      if (this.current()) this.setData({ error: '素材已更新，请重新确认选择。' });
      return;
    }
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.snapshot = JSON.stringify(canonical(snapshot));
    this.setData({ busy: true, busyKind: 'generate', error: '', notice: '' });
    let result;
    try {
      result = this.data.scope === 'expand'
        ? await this.ai.expand({ text: snapshot[0].text, supplements: selected.map((x) => x.content) })
        : await this.ai.summarize({ scope: this.data.scope, items: selected.map(({ id, content }) => ({ id, content })) });
    } catch (err) { result = { ok: false, message: '这次生成没有完成，请稍后重试。' }; }
    if (!this.current() || sequence !== this.sequence) return;
    if (!result || !result.ok) { this.setData({ busy: false, busyKind: '', error: result && result.message || '这次生成没有完成，请稍后重试。' }); return; }
    const entries = [];
    if (this.data.scope === 'expand') {
      for (const [key, label] of [['points', '要点'], ['nextSteps', '下一步'], ['risks', '风险']]) {
        result.value[key].forEach((content, index) => entries.push({ id: key + index, label, sectionStart: index === 0, number: index + 1, content, selected: true }));
      }
    }
    this.pendingSave = null;
    this.setData({ busy: false, busyKind: '', preview: true, entries, summary: result.value.text || '', mode: 'append', targetId: '', saveUnknown: false,
      targets: selected.map(({ id, content }) => ({ id, label: content.slice(0, 40) })) });
    this.updateAccept(); guardPreview(true); this.scrollTop();
  },
  editable() { return this.current() && this.data.preview && !this.data.busy && !this.data.saveUnknown; },
  onEntrySelect(event) { if (!this.editable()) return; this.pendingSave = null; this.setData({ entries: this.data.entries.map((x) => Object.assign({}, x, { selected: event.detail.value.includes(x.id) })), error: '' }); this.updateAccept(); },
  onEntryEdit(event) { if (!this.editable()) return; this.pendingSave = null; this.setData({ entries: this.data.entries.map((x) => x.id === event.currentTarget.dataset.id ? Object.assign({}, x, { content: event.detail.value }) : x), error: '' }); this.updateAccept(); },
  onSummaryEdit(event) { if (!this.editable()) return; this.pendingSave = null; this.setData({ summary: event.detail.value, error: '' }); this.updateAccept(); },
  onMode(event) { if (!this.editable()) return; this.pendingSave = null; this.setData({ mode: event.detail.value, targetId: '', error: '' }); this.updateAccept(); },
  onTarget(event) { if (!this.editable()) return; this.pendingSave = null; this.setData({ targetId: event.detail.value, error: '' }); this.updateAccept(); },
  onDiscard() {
    if (!this.current() || this.data.busy) return;
    const clear = () => {
      this.pendingSave = null; this.snapshot = null; guardPreview(false);
      this.setData({ preview: false, entries: [], summary: '', error: '', notice: '', mode: '', targetId: '', saveUnknown: false }); this.scrollTop();
    };
    if (!this.data.preview) { clear(); return; }
    this.confirmLeave('重新选择素材？', clear);
  },
  confirmLeave(title, action) {
    const sequence = this.sequence;
    const content = this.data.saveUnknown ? '本次保存结果尚未确认。离开后预览不会保留，可先重试确认或复制。' : '这份 AI 预览还没有保存，离开后不会保留。';
    wx.showModal({ title, content, confirmText: '继续离开', cancelText: '保留预览', success: (result) => {
      if (result.confirm && this.current() && sequence === this.sequence && !this.data.busy) { guardPreview(false); action(); }
    } });
  },
  scrollTop() { if (this.current() && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },
  onCopy() {
    if (!this.current() || this.data.busy || !this.data.preview) return;
    const text = this.data.scope === 'expand' ? this.data.entries.filter((x) => x.selected).map((x) => x.label + '：' + x.content).join('\n\n') : this.data.summary;
    if (!text.trim()) { this.setData({ error: '请先选择需要复制的内容。' }); return; }
    const sequence = this.sequence;
    const finish = (ok) => { if (this.current() && sequence === this.sequence) this.setData({ notice: ok ? '已复制，可粘贴到需要的地方。' : '', error: ok ? this.data.error : '复制未完成，请重试。' }); };
    try { wx.setClipboardData({ data: text, success: () => finish(true), fail: () => finish(false) }); } catch (err) { finish(false); }
  },
  completeSave(items) {
    this.pendingSave = null; this.snapshot = null; guardPreview(false);
    this.setData({ busy: false, busyKind: '', completed: true, preview: false, entries: [], summary: '', error: '', saveUnknown: false,
      savedId: this.data.scope === 'expand' || this.data.scope === 'supplements' ? this.id : this.data.mode === 'overwrite' ? this.data.targetId : items[0].id,
      notice: this.data.scope === 'expand' ? '已添加为补充' : this.data.scope === 'supplements' ? '已保存汇总补充' : '已保存汇总灵感' });
    this.scrollTop();
  },
  async onAccept() {
    if (!this.current() || this.data.busy || !this.data.preview) return;
    const sequence = this.sequence;
    if (this.pendingSave && this.pendingSave.items.every((item) => same(this.store.getInspiration(item.id), item))) { this.completeSave(this.pendingSave.items); return; }
    if (JSON.stringify(canonical(this.sourceSnapshot())) !== this.snapshot) { this.setData({ error: '来源内容已变化，请重新选择素材后生成。' }); return; }
    this.updateAccept();
    if (!this.data.canAccept) { this.setData({ error: this.data.acceptHint || (this.data.scope === 'expand' ? '请至少保留一条有内容的结果。' : '请核对汇总内容和保存目标。') }); return; }
    if (this.data.mode === 'overwrite' && !this.pendingSave) {
      this.setData({ busy: true, busyKind: 'confirm' });
      const confirmed = await new Promise((resolve) => wx.showModal({ title: '保存并收起来源？', content: this.data.scope === 'supplements' ? '所选补充将被收起，可在详情中恢复。' : '汇总将写入所选灵感，其余来源将被收起，可在详情中恢复。', confirmText: '确认保存', cancelText: '继续核对', success: (r) => resolve(r.confirm === true), fail: () => resolve(false) }));
      if (!this.current() || sequence !== this.sequence) return;
      this.setData({ busy: false, busyKind: '' });
      if (!confirmed) return;
      if (JSON.stringify(canonical(this.sourceSnapshot())) !== this.snapshot) { this.setData({ error: '来源内容已变化，请重新选择素材后生成。' }); return; }
    }
    let items;
    try {
      const context = { newId: createId, now: Date.now() };
      items = this.pendingSave ? this.pendingSave.items : this.data.scope === 'expand' ? acceptDraft(this.store.getInspiration(this.id), this.data.entries, context)
        : acceptSummary(this.store.readSnapshot().inspirations, Object.assign(context, { scope: this.data.scope, id: this.id,
          sourceIds: this.data.options.filter((x) => x.selected).map((x) => x.id), mode: this.data.mode, targetId: this.data.targetId, text: this.data.summary }));
    } catch (err) { this.setData({ error: err.message && !err.errors ? err.message : '请核对保存方式、目标与内容长度。' }); return; }
    this.pendingSave = { items };
    this.setData({ busy: true, busyKind: 'save', error: '', notice: '' });
    let result;
    try { result = await this.store.saveInspirations(items); } catch (err) { result = { ok: false }; }
    if (!this.current() || sequence !== this.sequence) return;
    if (!result || !result.ok || result.synced !== true) {
      const unknown = !result || !result.code || ['NETWORK', 'INTERNAL'].includes(result.code);
      this.setData({ busy: false, busyKind: '', saveUnknown: unknown, error: unknown ? '尚未确认保存，预览还在。请重试确认，或先复制。' : '保存没有完成，预览还在。请核对后重试，或先复制。' }); return;
    }
    this.completeSave(items);
  },
  onOpenSaved() { if (this.current() && this.data.savedId) wx.redirectTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.savedId) }); },
  onManual() { if (!this.current() || this.data.busy) return; if (this.data.scope === 'inspirations') wx.redirectTo({ url: '/pages/material-output/index' }); else wx.redirectTo({ url: '/pages/output/index?id=' + encodeURIComponent(this.id) }); },
  onRetryLoad() { if (!this.data.busy) return this.onLoad(this.query); },
  onBack() {
    if (this.data.busy) return;
    const back = () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/list/index' }) });
    if (this.data.preview) this.confirmLeave('离开 AI 预览？', back); else back();
  },
  /** 能力关闭时没有可返回的页面栈（旧链接直达），给一个明确的 tab 出口 */
  onBackToList() { wx.switchTab({ url: '/pages/list/index' }); }
});
