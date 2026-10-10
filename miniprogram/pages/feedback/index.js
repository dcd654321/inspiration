const { createShareClient } = require('../../services/sharing');
const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage, readPageAccount } = require('../../services/page-session');

const CATEGORIES = [
  { value: 'idea', label: '功能建议' },
  { value: 'bug', label: '使用问题' },
  { value: 'other', label: '其他意见' }
];
const STATUS = { submitted: '已提交', reviewing: '处理中', closed: '已关闭' };

Page({
  data: { reporting: false, category: 'idea', categories: CATEGORIES,
    body: '', trimmedLength: 0, canSubmit: false,
    busy: false, error: '', historyError: '', notice: '', items: [], loading: false, nextBefore: null },
  onLoad(options) {
    beginPage(this);
    this.reportToken = options && typeof options.t === 'string' ? options.t : '';
    this.client = createShareClient();
    this.setData({ reporting: Boolean(this.reportToken) });
  },
  async onShow() {
    beginPage(this);
    if (this.sessionEpoch !== undefined && this.sessionEpoch !== getApp().globalData.sessionEpoch) {
      this.submitRequestId = '';
      this.setData({ body: '', trimmedLength: 0, canSubmit: false });
    }
    this.setData({ busy: false, error: '', historyError: '', notice: '', items: [], nextBefore: null });
    await this.load(true);
  },
  onHide() {
    endPage(this);
    this.setData({ busy: false, loading: false, historyError: '', items: [], nextBefore: null });
  },
  onUnload() { this.onHide(); },
  onCategory(event) {
    if (this.data.busy || this.visible === false) return;
    const value = event.currentTarget.dataset.value;
    if (!CATEGORIES.some((entry) => entry.value === value)) return;
    this.submitRequestId = '';
    this.setData({ category: value, error: '', notice: '' });
  },
  onInput(event) {
    if (this.data.busy || this.visible === false) return;
    this.submitRequestId = '';
    const body = event.detail.value;
    const trimmedLength = body.trim().length;
    this.setData({ body, trimmedLength, canSubmit: trimmedLength >= 10 && trimmedLength <= 1000, error: '', notice: '' });
  },
  async onSubmit() {
    if (this.data.busy || this.visible === false) return;
    const body = this.data.body.trim(), category = this.data.category;
    const reporting = this.data.reporting, token = this.reportToken;
    if (body.length < 10 || body.length > 1000) {
      this.setData({ error: '请填写 10 到 1000 字的意见。' }); return;
    }
    this.setData({ busy: true, error: '', notice: '' });
    const account = await readPageAccount(this);
    if (!account.isCurrent()) return;
    if (!account.store || (this.sessionStore && (this.sessionStore !== account.store || this.sessionEpoch !== account.epoch))) {
      this.setData({ busy: false, error: '暂时无法确认账户，请联网后重试。' }); return;
    }
    this.sessionStore = account.store;
    this.sessionEpoch = account.epoch;
    this.submitRequestId = this.submitRequestId || this.client.newRequestId();
    let result;
    try {
      result = reporting
        ? await this.client.send('feedback.reportShare', { token, body }, this.submitRequestId)
        : await this.client.send('feedback.create', { category, body }, this.submitRequestId);
    } catch (err) { result = { ok: false, message: '网络暂时不可用，请稍后重试。' }; }
    if (!account.isCurrent()) return;
    this.setData({ busy: false });
    if (!result.ok) {
      this.setData({ error: result.message || '提交没有完成，请稍后重试。' }); return;
    }
    this.submitRequestId = '';
    this.setData({ body: '', trimmedLength: 0, canSubmit: false,
      notice: reporting ? '举报已收到。' : '反馈已收到。' });
    await this.load(true);
  },
  async load(replace) {
    if (this.visible === false || (!replace && (this.data.loading || !this.data.nextBefore))) return;
    const version = this.listVersion = (this.listVersion || 0) + 1;
    const before = this.data.nextBefore;
    this.historyReplace = Boolean(replace);
    this.setData({ loading: true, historyError: '' });
    const account = await readPageAccount(this);
    const isCurrent = () => account.isCurrent() && version === this.listVersion;
    if (!isCurrent()) return;
    if (!account.store) {
      this.setData({ loading: false, historyError: '暂时无法确认账户，请稍后重试。' }); return;
    }
    if (this.sessionStore && this.sessionStore !== account.store) {
      this.submitRequestId = '';
      this.setData({ body: '', trimmedLength: 0, canSubmit: false, notice: '', items: [] });
      replace = true;
    }
    this.sessionStore = account.store;
    this.sessionEpoch = account.epoch;
    let result;
    try { result = await this.client.send('feedback.listMine', replace ? {} : { before }); }
    catch (err) { result = { ok: false }; }
    if (!isCurrent()) return;
    this.setData({ loading: false });
    if (!result.ok) {
      this.setData({ historyError: '反馈记录暂时无法加载，请重试。' });
      return;
    }
    const items = result.data.items.map((entry) => Object.assign({}, entry, {
      date: formatAbsolute(entry.createdAt), statusText: STATUS[entry.status] || '已提交',
      categoryText: entry.category === 'share_report' ? '内容举报' :
        (CATEGORIES.find((c) => c.value === entry.category) || {}).label || '意见反馈'
    }));
    const seen = new Set();
    this.setData({ items: (replace ? [] : this.data.items).concat(items)
      .filter((entry) => { if (seen.has(entry.feedbackId)) return false; seen.add(entry.feedbackId); return true; }),
    nextBefore: result.data.nextBefore });
  },
  onMore() { return this.load(false); },
  onRetryHistory() { if (!this.data.loading) return this.load(this.historyReplace !== false); }
});
