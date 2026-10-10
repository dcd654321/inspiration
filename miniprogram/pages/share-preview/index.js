const { currentSupplements } = require('../../services/content-output');
const { createShareClient, selectedPreview, shareRevision, chatShareCard, publicTemplate } = require('../../services/sharing');
const { renderPosters, paginatePoster, MAX_CHARS } = require('../../services/share-poster');
const { createId } = require('../../core/limits');
const { beginPage, endPage, pageGuard, readPageAccount } = require('../../services/page-session');

Page({
  data: {
    ready: false, missing: false, options: [], preview: '', selectedCount: 0,
    error: '', notice: '', busy: false, chatPrepared: false, canRetryPoster: false,
    posterBusy: false, posterFiles: [], posterReady: false, saving: false, allSaved: false,
    templateName: '', previewExpanded: false
  },

  async onLoad(query) {
    beginPage(this);
    this.id = query && query.id || '';
    this.client = createShareClient();
    this.clearPrepared();
    await this.load();
  },

  async onShow() {
    const app = getApp();
    if (this.visible && ((this.loadingPage && this.loadingEpoch === app.globalData.sessionEpoch) ||
        (this.loadedEpoch === app.globalData.sessionEpoch && this.sessionStore === app.globalData.store))) return;
    beginPage(this);
    this.clearPrepared();
    await this.load();
  },

  onHide() {
    endPage(this);
    this.loadingPage = false;
    this.clearPrepared();
    this.setData({ ready: false, missing: false, preview: '', options: [], selectedCount: 0,
      templateName: '', previewExpanded: false });
  },
  onUnload() { this.onHide(); },

  removeFiles(paths) {
    if (typeof wx.getFileSystemManager !== 'function') return;
    const fs = wx.getFileSystemManager();
    paths.forEach((filePath) => {
      try { fs.unlink({ filePath, fail() {} }); } catch (err) { /* 临时图清理尽力而为。 */ }
    });
  },
  cleanupFiles() {
    this.removeFiles((this.data.posterFiles || []).concat(this.codePath ? [this.codePath] : []));
    this.codePath = '';
    this.savedPosterCount = 0;
    this.setData({ posterFiles: [], posterReady: false, allSaved: false });
  },
  clearPrepared() {
    this.preparedToken = '';
    this.preparedPreview = null;
    this.preparedIsCurrent = null;
    this.createdKey = '';
    this.createdRequestId = '';
    this.cleanupFiles();
    this.setData({ busy: false, saving: false, posterBusy: false,
      chatPrepared: false, canRetryPoster: false, notice: '', error: '' });
  },

  async load() {
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.loadingPage = true;
    this.setData({ ready: false, preview: '', options: [], selectedCount: 0,
      templateName: '', previewExpanded: false });
    const pending = readPageAccount(this);
    this.loadingEpoch = getApp().globalData.sessionEpoch;
    const account = await pending;
    if (!account.isCurrent() || version !== this.loadVersion) return;
    this.loadingPage = false;
    this.loadedEpoch = account.epoch;
    this.sessionStore = account.store;
    const item = account.store && account.store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true, error: account.app.globalData.accountError || '这条灵感不存在。' });
      return;
    }
    const options = currentSupplements(item).map((entry) => ({
      id: entry.id, content: entry.content, selected: false
    }));
    const template = publicTemplate(item.templateId);
    this.setData({ ready: true, missing: false, options, selectedCount: 0,
      preview: selectedPreview(item, []), templateName: template && template.id !== 'free' ? template.name : '',
      previewExpanded: false,
      error: shareRevision(account.store) ? '' : '暂时无法确认内容状态，请返回后重试。' });
  },

  onTogglePreview() {
    if (this.visible !== false && this.data.ready && !this.data.missing) {
      this.setData({ previewExpanded: !this.data.previewExpanded });
    }
  },

  onToggle(event) {
    if (this.data.busy || this.data.saving || this.visible === false) return;
    const app = getApp();
    if (this.sessionStore !== app.globalData.store || this.loadedEpoch !== app.globalData.sessionEpoch) return;
    const id = event.currentTarget.dataset.id;
    const options = this.data.options.map((entry) => entry.id === id
      ? Object.assign({}, entry, { selected: !entry.selected }) : entry);
    const item = this.sessionStore && this.sessionStore.getInspiration(this.id);
    const ids = options.filter((entry) => entry.selected).map((entry) => entry.id);
    this.clearPrepared();
    this.setData({ options, selectedCount: ids.length,
      preview: item ? selectedPreview(item, ids) || '' : '' });
  },

  async prepare(channel) {
    if (this.data.busy || this.data.saving || this.visible === false || !this.data.ready || this.data.missing) return null;
    const ids = this.data.options.filter((x) => x.selected).map((x) => x.id);
    const displayed = this.data.preview;
    this.setData({ busy: true, error: '', notice: '' });
    const account = await readPageAccount(this);
    if (!account.isCurrent()) return null;
    try {
      const store = account.store;
      if (!store || this.loadedEpoch !== account.epoch || this.sessionStore !== store) {
        this.setData({ error: '暂时无法确认账户，请返回后重试。' }); return null;
      }
      const item = store.getInspiration(this.id);
      const revision = shareRevision(store);
      if (!item || !revision) {
        this.setData({ error: '暂时无法确认内容状态，请返回后重试。' }); return null;
      }
      const preview = selectedPreview(item, ids);
      if (!preview) { this.setData({ error: '分享内容已变化，请重新预览。' }); return null; }
      if (preview !== displayed) {
        this.preparedToken = '';
        this.setData({ preview, chatPrepared: false, error: '分享内容已变化，请核对后再确认。' });
        return null;
      }
      if (channel === 'timeline_poster' && (!paginatePoster(preview) || preview.length > MAX_CHARS)) {
        this.setData({ error: '朋友圈海报最多 ' + MAX_CHARS + ' 字、9 页。请减少补充，或改发给微信好友。' });
        return null;
      }
      const payload = { inspirationId: this.id, selectedSupplementIds: ids,
        baseVersion: revision.baseVersion, generation: revision.generation, channelIntent: channel };
      const key = JSON.stringify(payload);
      if (this.createdKey !== key) {
        this.createdKey = key;
        this.createdRequestId = this.client.newRequestId();
      }
      let result;
      try { result = await this.client.send('share.create', payload, this.createdRequestId); }
      catch (err) { result = { ok: false, message: '网络暂时不可用，请稍后重试。' }; }
      if (!account.isCurrent()) return null;
      if (!result.ok) {
        this.setData({ error: result.message || '分享暂时无法创建。' }); return null;
      }
      this.preparedToken = result.data.token;
      this.preparedPreview = result.data.preview;
      this.preparedIsCurrent = account.isCurrent;
      return result.data;
    } finally { if (account.isCurrent()) this.setData({ busy: false }); }
  },

  async onPrepareChat() {
    const result = await this.prepare('chat');
    if (result && this.preparedIsCurrent && this.preparedIsCurrent()) this.setData({ chatPrepared: true,
      notice: '分享已创建。请点击下方按钮，选择要发送的微信好友。' });
  },

  onShareAppMessage() {
    if (!this.preparedToken || !this.data.chatPrepared || !this.preparedIsCurrent || !this.preparedIsCurrent()) {
      return chatShareCard(null, '');
    }
    return chatShareCard(this.preparedPreview, this.preparedToken);
  },

  async onMakePoster() {
    if (this.data.busy || this.data.saving || this.visible === false) return;
    if (this.data.canRetryPoster && !this.data.posterReady && this.preparedToken &&
        this.preparedIsCurrent && this.preparedIsCurrent()) {
      await this.makePoster(this.preparedToken, this.preparedPreview); return;
    }
    const result = await this.prepare('timeline_poster');
    if (!result || !this.preparedIsCurrent || !this.preparedIsCurrent()) return;
    this.setData({ chatPrepared: false, canRetryPoster: true });
    await this.makePoster(result.token, result.preview);
  },

  async makePoster(token, preview) {
    const isCurrent = pageGuard(this);
    if (!isCurrent()) return;
    let codePath = '';
    this.setData({ busy: true, posterBusy: true, error: '', notice: '', posterReady: false });
    try {
      const code = await this.client.send('share.qr', { token });
      if (!isCurrent()) return;
      if (!code.ok) throw Error(code.message || '小程序码生成失败');
      this.cleanupFiles();
      codePath = wx.env.USER_DATA_PATH + '/' + createId('linggan_share') + '.png';
      this.codePath = codePath;
      const paths = await renderPosters(this, preview.body, preview.title, code.data.pngBase64, codePath, isCurrent);
      if (!isCurrent()) { this.removeFiles(paths.concat(codePath)); return; }
      this.savedPosterCount = 0;
      this.setData({ posterFiles: paths, posterReady: true, allSaved: false,
        notice: '海报已生成。保存图片后，请到朋友圈自行发布。已发出的图片无法远程收回。' });
    } catch (err) {
      if (codePath) this.removeFiles([codePath]);
      if (isCurrent()) this.setData({ error: '海报还没生成成功，请重试；也可以改发给微信好友。', posterReady: false });
    } finally { if (isCurrent()) this.setData({ busy: false, posterBusy: false }); }
  },

  async onSavePosters() {
    if (this.data.busy || this.data.saving || !this.data.posterReady || this.data.allSaved || this.visible === false) return;
    const isCurrent = pageGuard(this), files = this.data.posterFiles.slice();
    let saved = this.savedPosterCount || 0;
    this.setData({ saving: true, error: '', notice: '' });
    try {
      for (let index = saved; index < files.length; index += 1) {
        if (!isCurrent()) return;
        await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: files[index], success: resolve, fail: reject }));
        if (!isCurrent()) return;
        saved += 1;
        this.savedPosterCount = saved;
      }
      this.setData({ allSaved: true,
        notice: '已保存 ' + saved + ' 张海报。请到朋友圈自行选择并发布；小程序不能代你发布。' });
    } catch (err) {
      if (isCurrent()) this.setData({ error: '已保存 ' + saved + ' 张；其余图片未保存。请检查相册权限后重试，不要漏发。' });
    } finally { if (isCurrent()) this.setData({ saving: false }); }
  },

  onOpenMyShares() {
    if (!this.data.busy && !this.data.saving) wx.navigateTo({ url: '/pages/my-shares/index' });
  }
});
