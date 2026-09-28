const { buildArchiveText } = require('../../services/content-output');
const { formatAbsolute } = require('../../core/format');

Page({
  data: {
    backupText: '正在确认账户与备份状态…',
    backupPending: false,
    backupConflict: false,
    backupBusy: false,
    legacyNotice: '',
    remoteItems: [],
    remoteExpanded: false,
    recoveryItems: [],
    recoveryExpanded: false,
    recoveryCount: 0,
    usageEnabled: false, usageVisible: false, usageReport: '', usageError: '',
    privacyNotes: [
      '灵感默认仅你可见；只有你确认分享的文字才会生成分享链接。',
      '照片和修改记录不会加入文字分享。'
    ]
  },

  async onShow() {
    this.setData({ remoteItems: [], remoteExpanded: false, recoveryItems: [], recoveryExpanded: false,
      recoveryCount: 0, usageReport: '', usageVisible: false, usageEnabled: false, usageError: '', backupText: '正在确认账户与备份状态…' });
    const app = getApp();
    const store = app && await app.ensureReady();
    if (!store) {
      this.setData({ backupText: app && app.globalData.accountError || '暂时无法确认账户，请联网后重试。', backupPending: false, backupConflict: false,
        legacyNotice: app && app.globalData.legacyCachePresent ? '检测到旧版记录。为避免误归属到其他账户，暂不自动展示或迁移；请勿清理小程序数据。' : '' });
      return;
    }
    this.updateBackup(store);
    try { this.setData({ usageEnabled: Boolean(app.globalData.metrics && app.globalData.metrics.read().enabled), usageVisible: false, usageReport: '', usageError: '' }); }
    catch (err) { this.setData({ usageError: '使用统计暂时无法读取。' }); }
    if (typeof wx.onNetworkStatusChange === 'function' && typeof wx.offNetworkStatusChange === 'function') {
      this.removeNetworkListener();
      this.networkListener = async (status) => {
        if (!status.isConnected || getApp().globalData.store !== store) return;
        try { await store.retryPending(); } catch (err) { /* 当前队列仍保留。 */ }
        if (getApp().globalData.store === store) this.updateBackup(store);
      };
      wx.onNetworkStatusChange(this.networkListener);
    }
  },

  removeNetworkListener() {
    if (this.networkListener && typeof wx.offNetworkStatusChange === 'function') {
      wx.offNetworkStatusChange(this.networkListener);
    }
    this.networkListener = null;
  },

  onHide() { this.removeNetworkListener(); },
  onUnload() { this.removeNetworkListener(); },

  updateBackup(store) {
    const status = store.getBackupStatus();
    const conflict = status.state === 'CONFLICT' || status.state === 'STALE_GENERATION' ||
      status.state === 'PHOTO_DELETE_UNAVAILABLE' || status.state === 'REQUEST_ID_REUSED';
    const remote = conflict && store.getConflict() && store.getConflict().remote;
    const recoveries = store.getRecoveries();
    const recoveryItems = [];
    recoveries.forEach((entry, index) => {
      (entry.snapshot.inspirations || []).forEach((item) => {
        recoveryItems.push({
          key: index + '_' + item.id,
          label: formatAbsolute(entry.savedAt),
          id: item.id, recoveryIndex: index, photoCount: (item.photos || []).length,
          text: buildArchiveText(item, entry.savedAt)
        });
      });
    });
    this.setData({
      recoveryItems,
      recoveryCount: recoveries.length,
      remoteItems: remote && Array.isArray(remote.inspirations)
        ? remote.inspirations.map((item) => ({ id: item.id, text: buildArchiveText(item, Date.now()), photoCount: (item.photos || []).length }))
        : [],
      legacyNotice: getApp().globalData.legacyCachePresent
        ? '检测到旧版记录。为避免误归属到其他账户，暂不自动展示或迁移；请勿清理小程序数据。'
        : '',
      backupPending: status.pendingCount > 0 && !conflict,
      backupConflict: conflict,
      backupText: conflict
        ? status.state === 'PHOTO_DELETE_UNAVAILABLE'
          ? '含照片的删除暂未完成，记录仍在本机。请勿清理小程序数据，联系维护者处理。'
          : status.state === 'REQUEST_ID_REUSED'
            ? '备份请求出现标识冲突，本机内容未丢失，也不会自动覆盖云端。请先查看并复制两份内容。'
          : status.state === 'STALE_GENERATION'
            ? '当前设备的备份版本已失效，本机内容不会自动回传。可先查看两份内容，再决定是否采用云端版本。'
            : '备份遇到版本冲突。本机内容不会自动覆盖云端；可分别查看并复制两份内容，再决定是否采用云端版本。'
        : status.pendingCount > 0
          ? '还有 ' + status.pendingCount + ' 条操作未完成备份，内容保留在当前设备。请勿清理小程序数据。'
          : '记录已与当前账户同步。'
    });
  },

  onToggleRemote() {
    this.setData({ remoteExpanded: !this.data.remoteExpanded });
  },

  onToggleRecovery() {
    this.setData({ recoveryExpanded: !this.data.recoveryExpanded });
  },

  onCopyRecovery(event) {
    const target = this.data.recoveryItems.find((item) => item.key === event.currentTarget.dataset.key);
    if (target) this.copyText(target.text);
  },
  onUsageSetting(event) {
    try { const metrics = getApp().globalData.metrics; metrics.setEnabled(event.detail.value); this.setData({ usageEnabled: metrics.read().enabled, usageReport: '', usageVisible: false, usageError: '' }); }
    catch (err) { this.setData({ usageError: '统计设置未保存，请稍后重试。' }); }
  },
  onViewUsage() {
    try { this.setData({ usageReport: getApp().globalData.metrics.report(), usageVisible: true, usageError: '' }); }
    catch (err) { this.setData({ usageError: '统计暂时无法读取。' }); }
  },
  onCopyUsage() { if (this.data.usageReport) this.copyText(this.data.usageReport); },
  onRecoveryPhotos(event) {
    const data = event.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/photo-viewer/index?id=' + encodeURIComponent(data.id) + (data.remote ? '&remote=1' : '&recovery=' + data.index) });
  },

  copyText(value) {
    try {
      wx.setClipboardData({
        data: value,
        success: () => wx.showToast({ title: '已复制', icon: 'none' }),
        fail: () => wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false })
      });
    } catch (err) {
      wx.showModal({ title: '复制未完成', content: '请稍后重试。', showCancel: false });
    }
  },

  onCopyRemote(event) {
    const target = this.data.remoteItems.find((item) => item.id === event.currentTarget.dataset.id);
    if (target) this.copyText(target.text);
  },

  onUseRemote() {
    if (this.data.backupBusy) return;
    const store = getApp().globalData.store;
    if (!store || !store.getConflict()) return;
    wx.showModal({
      title: '采用云端版本？',
      content: '当前未备份内容会先留作本机只读副本，可在本页查看和复制。副本保存失败时不会切换，也不会自动合并两份内容。',
      confirmText: '确认采用',
      success: async (choice) => {
        if (!choice.confirm || getApp().globalData.store !== store) return;
        this.setData({ backupBusy: true });
        let result;
        try { result = await store.resolveUseRemote(); }
        catch (err) { result = { ok: false, code: 'INTERNAL' }; }
        if (getApp().globalData.store !== store) return;
        this.setData({ backupBusy: false });
        if (!result.ok) {
          this.setData({ backupText: result.code === 'LOCAL_WRITE_FAILED'
            ? '本机空间不足，恢复副本未写入；原内容与冲突状态均未改变。请清理空间后重试。'
            : result.code === 'PHOTO_RECOVERY_UNAVAILABLE'
              ? '本机内容包含照片，目前无法安全切换；两份内容都保持原状，请联系维护者处理。'
              : '暂时无法取得最新云端版本，原内容与冲突状态均未改变。请稍后重试。' });
          return;
        }
        this.updateBackup(store);
        this.setData({ recoveryExpanded: true });
      }
    });
  },

  async onRetryBackup() {
    if (this.data.backupBusy) return;
    this.setData({ backupBusy: true });
    const app = getApp();
    const store = app && await app.ensureReady();
    if (store) {
      try { await store.retryPending(); } catch (err) { /* 状态仍保留在本机，下面显示。 */ }
      this.updateBackup(store);
    } else {
      this.setData({ backupText: app && app.globalData.accountError || '暂时无法确认账户，请稍后重试。' });
    }
    this.setData({ backupBusy: false });
  },

  onOpenList() {
    wx.switchTab({ url: '/pages/list/index' });
  },

  onOpenWelcome() {
    wx.navigateTo({ url: '/pages/welcome/index' });
  },

  onOpenMyShares() {
    wx.navigateTo({ url: '/pages/my-shares/index' });
  },

  onOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  }
});
