'use strict';
// 照片的本地环节：权限、选图、压缩、上限校验。
//
// **上传不在这里。** 上传需要云存储，等云端接入后单独实现（task 4.3）。这里只做
// 「从用户点下去到图片符合上传条件」之间的全部事情。
//
// wx 的接口全部注入，理由与 store 相同：**权限被拒、压缩失败、超限这些路径在真机上
// 很难稳定复现**，注入之后可以在 Node 里直接断言。而它们恰恰是 photo-capture 规范里
// 占了一半的场景。
//
// 一个刻意的取舍：**压缩后仍超限的图片被拒绝，不做二次压缩。** 反复压到能过为止
// 会让画质掉到用户认不出自己拍的是什么，那比拒绝更糟——规范要求的是「拒绝该张
// 并明确说明原因与上限，其余图片不受影响」。

const { LIMITS } = require('../core/limits');

const SOURCE = { camera: 'camera', album: 'album' };

const CODE = {
  permissionDenied: 'PERMISSION_DENIED',
  limitExceeded: 'LIMIT_EXCEEDED',
  cancelled: 'CANCELLED',
  failed: 'FAILED'
};

/** 权限被拒时给用户的开启指引。规范要求「说明所需权限及开启方式」。 */
const PERMISSION_HINT = {
  camera: '需要相机权限才能拍照。可在微信的「设置 — 隐私 — 相机」里开启。',
  album: '需要相册权限才能选择照片。可在微信的「设置 — 隐私 — 照片」里开启。'
};

function createPhotoService(options) {
  const opts = options || {};
  const ensurePermission = opts.ensurePermission;
  const chooseMedia = opts.chooseMedia;
  const compressImage = opts.compressImage;

  if (typeof ensurePermission !== 'function') throw new Error('createPhotoService 需要 ensurePermission');
  if (typeof chooseMedia !== 'function') throw new Error('createPhotoService 需要 chooseMedia');
  if (typeof compressImage !== 'function') throw new Error('createPhotoService 需要 compressImage');

  /**
   * 选图并做好上传前的准备。
   *
   * @param {object} input
   * @param {'camera'|'album'} input.source       拍照还是从相册选
   * @param {number} input.existingCount          该灵感已有的照片数，用来判数量上限
   *
   * @returns {Promise<{ok: boolean, code?: string, hint?: string,
   *                    accepted: Array, rejected: Array, limit: object}>}
   *
   * 无论成功失败都返回 `limit`——界面要能说出「上限是多少」，不能只说「超了」。
   */
  async function prepare(input) {
    const source = input && input.source;
    const existingCount = (input && input.existingCount) || 0;
    const limit = { maxBytes: LIMITS.photoMaxBytes, maxCount: LIMITS.photosPerInspiration };

    if (SOURCE[source] === undefined) {
      return { ok: false, code: CODE.failed, accepted: [], rejected: [], limit };
    }

    // 数量已经到顶：**在读任何图片之前就拦住**。先读再拒等于白白让用户授权了一次。
    if (existingCount >= limit.maxCount) {
      return { ok: false, code: CODE.limitExceeded, accepted: [], rejected: [], limit };
    }

    // 权限被拒时**不读取任何图片**——这是规范的原话，也是别的功能不受影响的保证
    let granted;
    try {
      granted = await ensurePermission(source);
    } catch (err) {
      granted = false;
    }
    if (!granted) {
      return { ok: false, code: CODE.permissionDenied, hint: PERMISSION_HINT[source], accepted: [], rejected: [], limit };
    }

    let picked;
    try {
      picked = await chooseMedia(source, limit.maxCount - existingCount);
    } catch (err) {
      return { ok: false, code: CODE.cancelled, accepted: [], rejected: [], limit };
    }
    if (!Array.isArray(picked) || picked.length === 0) {
      return { ok: false, code: CODE.cancelled, accepted: [], rejected: [], limit };
    }

    // 超出数量的部分不进候选，也不报错——用户选多了不该被骂，静默按上限收
    const candidates = picked.slice(0, limit.maxCount - existingCount);
    const accepted = [];
    const rejected = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];

      // 先按原图判一次：原图就超的话压了也白压，省掉一次压缩开销
      if (item.size > limit.maxBytes) {
        const compressed = await tryCompress(compressImage, item.tempFilePath);
        if (!compressed || compressed.size > limit.maxBytes) {
          rejected.push({ tempFilePath: item.tempFilePath, size: (compressed && compressed.size) || item.size });
          continue;
        }
        accepted.push({ tempFilePath: compressed.tempFilePath, size: compressed.size });
        continue;
      }

      accepted.push({ tempFilePath: item.tempFilePath, size: item.size });
    }

    return { ok: true, accepted, rejected, limit };
  }

  return { prepare, PERMISSION_HINT, CODE };
}

/** 压缩失败不该让整批失败——退回原图，交给上层按尺寸决定收还是拒。 */
async function tryCompress(compressImage, tempFilePath) {
  try {
    const out = await compressImage(tempFilePath);
    if (out && typeof out.tempFilePath === 'string' && typeof out.size === 'number') {
      return out;
    }
    return null;
  } catch (err) {
    return null;
  }
}

module.exports = { createPhotoService, SOURCE, CODE, PERMISSION_HINT };
