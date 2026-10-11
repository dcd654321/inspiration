const { formatAbsolute } = require('../../core/format');
const { beginPage, endPage, readPageAccount } = require('../../services/page-session');

function versionsFor(history, field) {
  return (Array.isArray(history) ? history : []).slice().reverse()
    .sort((a, b) => b.replacedAt - a.replacedAt)
    .map((version) => ({ id: version.id, text: version[field], time: formatAbsolute(version.replacedAt) }));
}

Page({
  data: { ready: false, missing: false, readError: false, versions: [], supplementHistories: [], versionCount: 0, current: '',
    currentLabel: '当前正文', historyTitle: '正文修改记录', subjectLabel: '', missingTitle: '找不到这条灵感', missingSupplement: false,
    missingHint: '它可能已被删除，可以返回列表查找其他记录。', emptyHint: '正文和补充还没有改过。修改后，旧内容会保留在这里。' },
  async onLoad(query) {
    beginPage(this);
    this.id = (query && query.id) || '';
    this.supplementId = (query && query.supplementId) || '';
    await this.load();
  },
  async onShow() {
    const app = getApp();
    if (!this.id || (this.visible && ((this.loadingPage && this.loadingEpoch === app.globalData.sessionEpoch) ||
        (this.loadedEpoch === app.globalData.sessionEpoch && this.sessionStore === app.globalData.store)))) return;
    beginPage(this);
    await this.load();
  },
  onHide() {
    endPage(this);
    this.loadingPage = false;
    this.setData({ ready: false, current: '', versions: [], supplementHistories: [], subjectLabel: '', versionCount: 0 });
  },
  onUnload() { this.onHide(); },
  async load() {
    if (this.visible === false) return;
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.loadingPage = true;
    this.setData({ ready: false, current: '', versions: [], supplementHistories: [], subjectLabel: '', versionCount: 0, readError: false, missingSupplement: false });
    const pending = readPageAccount(this);
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    const account = await pending;
    if (!account.isCurrent() || this.loadVersion !== version) return;
    this.loadingPage = false;
    this.loadedEpoch = account.epoch;
    this.sessionStore = account.store;
    if (!account.store) {
      this.setData({ ready: true, missing: false, readError: true }); return;
    }
    const item = account.store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true, readError: false, missingTitle: '找不到这条灵感',
        missingHint: '它可能已被删除，可以返回列表查找其他记录。' }); return;
    }
    const supplements = Array.isArray(item.supplements) ? item.supplements : [];
    if (this.supplementId) {
      const supplement = supplements.find((entry) => entry.id === this.supplementId);
      if (!supplement) {
        this.setData({ ready: true, missing: true, readError: false, missingTitle: '找不到这条补充', missingSupplement: true,
          missingHint: '它可能已被删除，可以返回这条灵感查看。' }); return;
      }
      const versions = versionsFor(supplement.contentHistory, 'content');
      this.setData({ ready: true, missing: false, readError: false, versions, versionCount: versions.length,
        current: supplement.content, currentLabel: '当前补充', historyTitle: '补充修改记录',
        subjectLabel: '补充 · ' + formatAbsolute(supplement.createdAt),
        emptyHint: '这条补充还没有改过。修改后，旧内容会保留在这里。' });
      return;
    }
    const versions = versionsFor(item.textHistory, 'text');
    const supplementHistories = supplements.slice().sort((a, b) => a.createdAt - b.createdAt)
      .map((supplement) => ({ id: supplement.id, current: supplement.content,
        label: '补充 · ' + formatAbsolute(supplement.createdAt),
        state: supplement.foldedAt ? '已并入正文' : supplement.mergedInto ? '已合并' : '',
        versions: versionsFor(supplement.contentHistory, 'content') }))
      .filter((supplement) => supplement.versions.length > 0);
    this.setData({ ready: true, missing: false, readError: false, versions, supplementHistories,
      versionCount: versions.length + supplementHistories.reduce((count, supplement) => count + supplement.versions.length, 0),
      current: item.text, currentLabel: '当前正文', historyTitle: '正文修改记录',
      emptyHint: '正文和补充还没有改过。修改后，旧内容会保留在这里。' });
  },
  onRetryLoad() { if (!this.loadingPage) return this.load(); },
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.id) });
  },
  onBackToList() { wx.switchTab({ url: '/pages/list/index' }); }
});
