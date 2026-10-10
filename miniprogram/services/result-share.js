'use strict';

/** 确认用户另存意图；只有当前稿件与已确认版本相同才进入分享范围核对。 */
function shareConfirmedDraft(page, { isCurrent, save }) {
  if (!isCurrent() || page.data.busy || page.data.saveUnknown || page.data.sourceStale || !page.data.draft.trim()) return;
  if (page.sharePrompt && page.sharePrompt.isCurrent()) return;
  page.sharePrompt = null;
  const text = page.data.draft;
  const open = () => {
    if (!isCurrent() || page.data.draft !== text || page.data.savedDraft !== text || !page.data.savedId || page.data.saveUnknown) return;
    wx.navigateTo({ url: '/pages/share-preview/index?id=' + encodeURIComponent(page.data.savedId),
      fail: () => { if (isCurrent()) page.setData({ error: '稿件已保存，暂时无法打开分享预览，请重试。' }); } });
  };
  if (page.data.savedId && page.data.savedDraft === text) { open(); return; }
  const prompt = page.sharePrompt = { isCurrent };
  wx.showModal({ title: '保存后预览分享？', content: '这份稿件会另存为一条新灵感，再核对对方将看到的文字。',
    confirmText: '保存预览', cancelText: '先不分享',
    success: async (result) => {
      if (page.sharePrompt !== prompt) return;
      page.sharePrompt = null;
      if (!result.confirm || !isCurrent() || page.data.busy || page.data.draft !== text) return;
      await save();
      open();
    },
    fail: () => {
      if (page.sharePrompt !== prompt) return;
      page.sharePrompt = null;
      if (isCurrent()) page.setData({ error: '暂时无法打开确认，请重试。' });
    }
  });
}

module.exports = { shareConfirmedDraft };
