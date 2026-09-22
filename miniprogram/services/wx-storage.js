'use strict';
// wx 键值存储的适配器。
//
// 只做一件事：把 wx 的同步存储 API 包装成 store 需要的 get / set / remove 三个方法。
//
// **配额异常原样往上抛，不吞、不转成静默失败。** store 靠这个异常区分
// 「本机写入失败」与「同步未成功」——两者在界面上的行为完全相反（一个要保留用户输入，
// 一个要清空），吞掉异常会把它们混成一团。

/**
 * 创建绑定到 wx 的存储适配器。
 *
 * 只在真机 / 开发者工具里可用；Node 里的测试一律注入内存替身，不走这里。
 */
function createWxStorage() {
  return {
    get(key) {
      return wx.getStorageSync(key);
    },

    /** 配额耗尽时 wx 会抛错，原样交给调用方。 */
    set(key, value) {
      wx.setStorageSync(key, value);
    },

    remove(key) {
      wx.removeStorageSync(key);
    },

    /**
     * 运行时读取容量信息。
     *
     * 刻意不把容量上限写死在代码里——平台数值会变，`limitSize` 才是权威值。
     * 调用方用 currentSize / limitSize 判断余量，而不是拿一个常数去比。
     */
    info() {
      return wx.getStorageInfoSync();
    }
  };
}

module.exports = { createWxStorage };
