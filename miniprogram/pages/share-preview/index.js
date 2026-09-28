const { currentSupplements } = require('../../services/content-output');
const { createShareClient, selectedPreview, shareRevision } = require('../../services/sharing');
const { renderPosters, paginatePoster, MAX_CHARS } = require('../../services/share-poster');

Page({
  data: {
    ready: false, missing: false, options: [], preview: '', selectedCount: 0,
    error: '', notice: '', busy: false, chatPrepared: false, canRetryPoster: false,
    posterFiles: [], posterReady: false, saving: false, allSaved: false
  },

  async onLoad(query) {
    this.id = query && query.id || '';
    this.client = createShareClient();
    this.createdKey = '';
    this.createdRequestId = '';
    this.preparedToken = '';
    this.codePath = '';
    this.savedPosterCount = 0;
    await this.load();
  },

  async onShow() {
    if (!this.id || !this.loadedEpoch || this.loadedEpoch === getApp().globalData.sessionEpoch) return;
    this.preparedToken = '';
    this.createdKey = '';
    this.createdRequestId = '';
    this.cleanupFiles();
    this.setData({ ready: false, chatPrepared: false, canRetryPoster: false,
      posterReady: false, posterFiles: [], preview: '' });
    await this.load();
  },

  onUnload() { this.cleanupFiles(); },

  cleanupFiles() {
    const paths = (this.data.posterFiles || []).concat(this.codePath ? [this.codePath] : []);
    if (typeof wx.getFileSystemManager !== 'function') return;
    const fs = wx.getFileSystemManager();
    paths.forEach((filePath) => {
      try { fs.unlink({ filePath, fail() {} }); } catch (err) { /* 临时图清理尽力而为。 */ }
    });
    this.codePath = '';
  },

  async load() {
    const app = getApp();
    const store = await app.ensureReady();
    this.loadedEpoch = app.globalData.sessionEpoch;
    const item = store && store.getInspiration(this.id);
    if (!item) {
      this.setData({ ready: true, missing: true, error: app.globalData.accountError || '这条灵感不存在。' });
      return;
    }
    const options = currentSupplements(item).map((entry) => ({
      id: entry.id, content: entry.content, selected: true
    }));
    this.setData({ ready: true, missing: false, options, selectedCount: options.length,
      preview: selectedPreview(item, options.map((x) => x.id)),
      error: shareRevision(store) ? '' : '请先完成备份或处理冲突，才能分享这条文字。' });
  },

  onToggle(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    const options = this.data.options.map((entry) => entry.id === id
      ? Object.assign({}, entry, { selected: !entry.selected }) : entry);
    const store = getApp().globalData.store;
    const item = store && store.getInspiration(this.id);
    const ids = options.filter((entry) => entry.selected).map((entry) => entry.id);
    this.preparedToken = '';
    this.createdKey = '';
    this.createdRequestId = '';
    this.cleanupFiles();
    this.setData({ options, selectedCount: ids.length,
      preview: item ? selectedPreview(item, ids) || '' : '',
      chatPrepared: false, canRetryPoster: false,
      posterReady: false, posterFiles: [], allSaved: false, error: '', notice: '' });
  },

  async prepare(channel) {
    if (this.data.busy) return null;
    const app = getApp();
    const store = await app.ensureReady();
    if (!store || this.loadedEpoch !== app.globalData.sessionEpoch) {
      this.setData({ error: '暂时无法确认账户，请返回后重试。' });
      return null;
    }
    const item = store.getInspiration(this.id);
    const revision = shareRevision(store);
    if (!item || !revision) {
      this.setData({ error: '请先完成备份或处理冲突，才能分享这条文字。' });
      return null;
    }
    const ids = this.data.options.filter((x) => x.selected).map((x) => x.id);
    const preview = selectedPreview(item, ids);
    if (!preview) { this.setData({ error: '分享内容已变化，请重新预览。' }); return null; }
    if (preview !== this.data.preview) {
      this.setData({ preview, error: '分享内容已变化，请核对后再确认。' });
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
    this.setData({ busy: true, error: '', notice: '' });
    let result;
    try { result = await this.client.send('share.create', payload, this.createdRequestId); }
    catch (err) { result = { ok: false, message: '网络暂时不可用，请稍后重试。' }; }
    this.setData({ busy: false });
    if (!result.ok) {
      this.setData({ error: result.message || '分享暂时无法创建。' });
      return null;
    }
    this.preparedToken = result.data.token;
    this.preparedPreview = result.data.preview;
    return result.data;
  },

  async onPrepareChat() {
    const result = await this.prepare('chat');
    if (result) this.setData({ chatPrepared: true,
      notice: '分享已创建。请点击下方按钮，选择要发送的微信好友。' });
  },

  onShareAppMessage() {
    if (!this.preparedToken || !this.data.chatPrepared) {
      return { title: '灵感拾光簿｜让想法慢慢成形', path: '/pages/welcome/index' };
    }
    return {
      title: this.preparedPreview.title || '一份文字分享',
      path: '/pages/shared/index?t=' + this.preparedToken
    };
  },

  async onPreparePoster() {
    const result = await this.prepare('timeline_poster');
    if (!result) return;
    this.setData({ chatPrepared: false, canRetryPoster: true });
    await this.makePoster(result.token, result.preview);
  },

  async onRetryPoster() {
    if (this.preparedToken && this.preparedPreview) await this.makePoster(this.preparedToken, this.preparedPreview);
  },

  async makePoster(token, preview) {
    this.setData({ busy: true, error: '', notice: '', posterReady: false });
    try {
      const code = await this.client.send('share.qr', { token });
      if (!code.ok) throw Error(code.message || '小程序码生成失败');
      this.cleanupFiles();
      this.codePath = wx.env.USER_DATA_PATH + '/linggan_share_' + Date.now() + '.png';
      const paths = await renderPosters(this, preview.body, preview.title, code.data.pngBase64, this.codePath);
      this.savedPosterCount = 0;
      this.setData({ posterFiles: paths, posterReady: true, allSaved: false,
        notice: '海报已生成。保存图片后，请到朋友圈自行发布。已发出的图片无法远程收回。' });
    } catch (err) {
      this.setData({ error: '海报还没生成成功，请重试；也可以改发给微信好友。', posterReady: false });
    } finally { this.setData({ busy: false }); }
  },

  async onSavePosters() {
    if (this.data.saving || !this.data.posterReady || this.data.allSaved) return;
    this.setData({ saving: true, error: '', notice: '' });
    try {
      for (let index = this.savedPosterCount; index < this.data.posterFiles.length; index += 1) {
        const filePath = this.data.posterFiles[index];
        await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
        this.savedPosterCount += 1;
      }
      this.setData({ allSaved: true,
        notice: '已保存 ' + this.savedPosterCount + ' 张海报。请到朋友圈自行选择并发布；小程序不能代你发布。' });
    } catch (err) {
      this.setData({ error: '已保存 ' + this.savedPosterCount + ' 张；其余图片未保存。请检查相册权限后重试，不要漏发。' });
    } finally { this.setData({ saving: false }); }
  },

  onOpenMyShares() { wx.navigateTo({ url: '/pages/my-shares/index' }); }
});
