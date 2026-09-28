const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');

const CATEGORIES = [
  { value: 'idea', label: '功能建议' },
  { value: 'bug', label: '使用问题' },
  { value: 'other', label: '其他意见' }
];
const STATUS = { submitted: '已提交', reviewing: '处理中', closed: '已关闭' };

Page({
  data: { reporting: false, category: 'idea', categories: CATEGORIES,
    body: '', busy: false, error: '', notice: '', items: [], loading: false, nextBefore: null },
  onLoad(options) {
    this.reportToken = options && typeof options.t === 'string' ? options.t : '';
    this.client = createShareClient();
    this.setData({ reporting: Boolean(this.reportToken) });
  },
  async onShow() { await this.load(true); },
  onCategory(event) {
    const value = event.currentTarget.dataset.value;
    if (!CATEGORIES.some((entry) => entry.value === value)) return;
    this.submitRequestId = '';
    this.setData({ category: value, error: '', notice: '' });
  },
  onInput(event) {
    this.submitRequestId = '';
    this.setData({ body: event.detail.value, error: '', notice: '' });
  },
  async onSubmit() {
    if (this.data.busy) return;
    const body = this.data.body.trim();
    if (body.length < 10 || body.length > 1000) {
      this.setData({ error: '请填写 10 到 1000 字的意见。' }); return;
    }
    const app = getApp();
    if (!await app.ensureReady()) {
      this.setData({ error: '暂时无法确认账户，请联网后重试。' }); return;
    }
    this.submitRequestId = this.submitRequestId || this.client.newRequestId();
    this.setData({ busy: true, error: '', notice: '' });
    let result;
    try {
      result = this.data.reporting
        ? await this.client.send('feedback.reportShare', { token: this.reportToken, body }, this.submitRequestId)
        : await this.client.send('feedback.create', { category: this.data.category, body }, this.submitRequestId);
    } catch (err) { result = { ok: false, message: '网络暂时不可用，请稍后重试。' }; }
    this.setData({ busy: false });
    if (!result.ok) {
      this.setData({ error: result.message || '提交没有完成，请稍后重试。' }); return;
    }
    this.submitRequestId = '';
    this.setData({ body: '', notice: this.data.reporting ? '举报已收到。' : '反馈已收到。' });
    await this.load(true);
  },
  async load(replace) {
    if (!replace && !this.data.nextBefore) return;
    const app = getApp();
    const store = await app.ensureReady();
    if (!store) return;
    const epoch = app.globalData.sessionEpoch;
    this.setData({ loading: true });
    let result;
    try { result = await this.client.send('feedback.listMine', replace ? {} : { before: this.data.nextBefore }); }
    catch (err) { result = { ok: false }; }
    if (epoch !== app.globalData.sessionEpoch) return;
    this.setData({ loading: false });
    if (!result.ok) {
      if (!this.data.notice) this.setData({ error: '反馈记录暂时无法加载。' });
      return;
    }
    const items = result.data.items.map((entry) => Object.assign({}, entry, {
      date: formatAbsolute(entry.createdAt), statusText: STATUS[entry.status] || '已提交',
      categoryText: entry.category === 'share_report' ? '内容举报' :
        (CATEGORIES.find((c) => c.value === entry.category) || {}).label || '意见反馈'
    }));
    this.setData({ items: (replace ? [] : this.data.items).concat(items), nextBefore: result.data.nextBefore });
  },
  onMore() { this.load(false); }
});
