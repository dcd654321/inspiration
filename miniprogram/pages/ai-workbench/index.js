const core = require('../../core/inspiration');
const { createId } = require('../../core/limits');
const { buildUseText } = require('../../services/content-output');
const { createWxAi, acceptDraft, acceptSummary } = require('../../services/ai-workflow');
const config = require('../../config/ai');
Page({
  data: { ready: false, enabled: false, scope: 'expand', options: [], preview: false, entries: [], summary: '',
    mode: '', targetId: '', selectedCount: 0, targets: [], busy: false, completed: false, error: '', notice: '' },
  async onLoad(query) {
    this.query = query || {};
    this.id = this.query.id || '';
    this.alive = true;
    const app = getApp(), store = await app.ensureReady();
    if (!this.alive) return;
    this.epoch = app.globalData.sessionEpoch;
    this.store = store;
    const scope = ['expand', 'supplements', 'inspirations'].includes(this.query.scope) ? this.query.scope : 'expand';
    const item = store && store.getInspiration(this.id);
    if (!store || scope !== 'inspirations' && (!item || item.deletedAt || item.mergedInto)) {
      this.setData({ ready: true, error: '暂时无法读取内容，请返回后重试。' }); return;
    }
    this.ai = createWxAi(config);
    const options = scope === 'inspirations'
      ? store.listInspirations().map((x) => ({ id: x.id, content: buildUseText(x), selected: false }))
      : core.activeSupplements(item).map((x) => ({ id: x.id, content: x.content, selected: false }));
    this.setData({ ready: true, enabled: config.enabled, scope, options, completed: false, notice: '', title: scope === 'expand' ? '扩展想法' : '汇总内容', error: '', original: item ? item.text : '' });
  },
  async onShow() {
    if (this.query && !this.alive) await this.onLoad(this.query);
  },
  onHide() { this.onUnload(); },
  onUnload() {
    this.alive = false; this.snapshot = null; this.store = null; this.sequence = (this.sequence || 0) + 1;
    this.setData({ ready: false, options: [], entries: [], summary: '', original: '', preview: false, busy: false, targets: [], mode: '', targetId: '', selectedCount: 0 });
  },
  current() { return this.alive && getApp().globalData.sessionEpoch === this.epoch && getApp().globalData.store === this.store; },
  onSelect(event) {
    if (this.data.busy) return;
    const ids = event.detail.value;
    this.setData({ options: this.data.options.map((x) => Object.assign({}, x, { selected: ids.includes(x.id) })), selectedCount: ids.length });
  },
  sourceSnapshot() {
    const sourceIds = this.data.options.filter((x) => x.selected).map((x) => x.id);
    if (this.data.scope === 'inspirations') return sourceIds.map((id) => this.store.getInspiration(id));
    return [this.store.getInspiration(this.id)];
  },
  async onGenerate() {
    if (!this.current() || this.data.busy || !this.data.enabled || this.data.completed) return;
    const selected = this.data.options.filter((x) => x.selected);
    if (this.data.scope !== 'expand' && selected.length < 2) { this.setData({ error: '请至少选择两条内容。' }); return; }
    const snapshot = this.sourceSnapshot();
    if (snapshot.some((x) => !x || x.deletedAt || x.mergedInto)) { this.setData({ error: '来源已变化，请返回后重试。' }); return; }
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.snapshot = JSON.stringify(snapshot);
    this.setData({ busy: true, error: '', notice: '' });
    let result;
    try {
      result = this.data.scope === 'expand'
        ? await this.ai.expand({ text: snapshot[0].text, supplements: selected.map((x) => x.content) })
        : await this.ai.summarize({ scope: this.data.scope, items: selected.map(({ id, content }) => ({ id, content })) });
    } catch (err) { result = { ok: false, message: '这次生成没有完成，请稍后重试。' }; }
    if (!this.current() || sequence !== this.sequence) return;
    if (!result.ok) { this.setData({ busy: false, error: result.message }); return; }
    const entries = [];
    if (this.data.scope === 'expand') {
      for (const [key, label] of [['points', '要点'], ['nextSteps', '下一步'], ['risks', '风险']]) {
        result.value[key].forEach((content, index) => entries.push({ id: key + index, label, content, selected: true }));
      }
    }
    this.setData({ busy: false, preview: true, entries, summary: result.value.text || '', mode: '', targetId: '',
      targets: selected.map(({ id, content }) => ({ id, label: content.slice(0, 40) })) });
  },
  onEntrySelect(event) { this.setData({ entries: this.data.entries.map((x) => Object.assign({}, x, { selected: event.detail.value.includes(x.id) })) }); },
  onEntryEdit(event) { this.setData({ entries: this.data.entries.map((x) => x.id === event.currentTarget.dataset.id ? Object.assign({}, x, { content: event.detail.value }) : x) }); },
  onSummaryEdit(event) { this.setData({ summary: event.detail.value }); },
  onMode(event) { this.setData({ mode: event.detail.value, targetId: '' }); },
  onTarget(event) { this.setData({ targetId: event.detail.value }); },
  onDiscard() { if (!this.data.busy) this.setData({ preview: false, entries: [], summary: '', error: '', notice: '', mode: '', targetId: '' }); },
  async onAccept() {
    if (!this.current() || this.data.busy || !this.data.preview) return;
    if (JSON.stringify(this.sourceSnapshot()) !== this.snapshot) { this.setData({ error: '来源内容已变化，请放弃本次结果后重新生成。' }); return; }
    let items;
    try {
      const context = { newId: createId, now: Date.now() };
      items = this.data.scope === 'expand' ? acceptDraft(this.store.getInspiration(this.id), this.data.entries, context)
        : acceptSummary(this.store.readSnapshot().inspirations, Object.assign(context, { scope: this.data.scope, id: this.id,
          sourceIds: this.data.options.filter((x) => x.selected).map((x) => x.id), mode: this.data.mode, targetId: this.data.targetId, text: this.data.summary }));
    } catch (err) { this.setData({ error: err.message && !err.errors ? err.message : '请核对保存方式、目标与内容长度。' }); return; }
    this.setData({ busy: true, error: '' });
    let result;
    try { result = await this.store.saveInspirations(items); } catch (err) { result = { ok: false }; }
    if (!this.current()) return;
    if (!result.ok) { this.setData({ busy: false, error: '保存没有完成，预览仍保留。请检查备份状态后重试。' }); return; }
    this.setData({ busy: false, completed: true, preview: false, entries: [], summary: '', notice: result.synced ? '已保存，可返回查看。' : '已保存，备份尚未完成。请暂时不要清理小程序数据。' });
    this.snapshot = null;
  },
  onBack() { wx.navigateBack(); }
});
