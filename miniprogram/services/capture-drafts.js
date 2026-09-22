'use strict';
// 未提交补充的会话内草稿。
//
// **只在内存里，一个闭包里的 Map，仅此而已。**
//
// 规范写明：未提交的内容不是数据，只是草稿，系统不承诺它在会话结束后仍然存在。
// 一旦给它加上持久化，草稿就悄悄变成了「内容」——用户会以为没提交的东西也存着，
// 而删除灵感、清理缓存这些动作都不会碰它，最后留下一堆谁也说不清的残留。
//
// 所以这个模块刻意不接触任何存储。它存在的唯一理由是：用户在一句话写到一半时
// 切出去看一眼别的灵感，回来时那半句话还在。

/**
 * 创建一个草稿区。
 *
 * 生命周期由调用方决定：小程序里由 `app.js` 在启动时建一个，放进 `globalData`，
 * 各页面共用同一个实例——这就是「同一会话内共用一个草稿区」的全部实现。
 * 进程结束，实例没了，草稿也就没了，这与规范一致。
 */
function createCaptureDrafts() {
  const drafts = new Map();

  return {
    /** 读一条草稿。没写过返回空串，页面可以直接绑到输入框上。 */
    get(inspirationId) {
      return drafts.get(inspirationId) || '';
    },

    /**
     * 写一条草稿。写入空串等同于清除——用户把输入框清空之后再离开，
     * 不该在下次回来时看到一条空的「草稿」。
     *
     * 纯空白不算空：那是用户真的敲了东西出来。
     */
    set(inspirationId, text) {
      if (typeof text !== 'string' || text.length === 0) {
        drafts.delete(inspirationId);
        return '';
      }
      drafts.set(inspirationId, text);
      return text;
    },

    /** 提交成功后调用。 */
    clear(inspirationId) {
      drafts.delete(inspirationId);
    },

    clearAll() {
      drafts.clear();
    },

    has(inspirationId) {
      return drafts.has(inspirationId);
    }
  };
}

module.exports = { createCaptureDrafts };
