'use strict';
// 照片上传与云存储清理。
//
// 上传接口（`uploadFile` / `removeFile`）从外面注入，理由与 store 相同：
// 网络中断、上传失败、重传这些路径在真机上很难稳定复现，注入之后可以在 Node 里断言。
//
// **幂等靠对象名，不靠去重逻辑。** 存储对象名固定为
// `linggan/{accountKey}/{inspirationId}/{photoId}`，重传覆盖同一对象，
// 因此重试不会产生重复文件——这是规范「同一次上传被重复提交，云端只保留一个对象」
// 的实现方式。不需要额外的「先查再传」。
//
// 路径拼接的每一段都重新校验字符集。核心层的 id 校验是第一道，这里是第二道：
// 云存储路径是**跨系统边界**，越权拼接的代价比一个多余的正则高得多。

// 与 core/inspiration.js 的 ID_PATTERN 保持一致。故意重新写一遍而不是 import：
// 这条校验守的是跨系统边界，不该因为上游哪天放宽了字符集就跟着放宽。
const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

const PHOTO_PREFIX = 'linggan/';

const CODE = {
  invalidSegment: 'INVALID_SEGMENT',
  uploadFailed: 'UPLOAD_FAILED',
  removeFailed: 'REMOVE_FAILED'
};

/** 拼一个照片的云存储对象名。任一段不合法即抛错——不返回一个「差不多」的路径。 */
function photoCloudPath(accountKey, inspirationId, photoId) {
  for (const segment of [accountKey, inspirationId, photoId]) {
    if (typeof segment !== 'string' || !SAFE_SEGMENT.test(segment)) {
      const err = new Error('非法的云存储路径片段');
      err.code = CODE.invalidSegment;
      throw err;
    }
  }
  return PHOTO_PREFIX + accountKey + '/' + inspirationId + '/' + photoId;
}

function createUploader(options) {
  const opts = options || {};
  const uploadFile = opts.uploadFile;
  const removeFile = opts.removeFile;

  if (typeof uploadFile !== 'function') throw new Error('createUploader 需要 uploadFile');

  /**
   * 上传一张照片。
   *
   * 失败时**不清理本地文件**——那是用户手上唯一的一份，清理等于把照片弄丢。
   * 本地文件的清理由调用方在上传确认之后决定。
   *
   * @returns {Promise<{ok: boolean, fileId?: string, code?: string}>}
   */
  async function uploadPhoto(input) {
    const { accountKey, inspirationId, photoId, tempFilePath } = input || {};

    let cloudPath;
    try {
      cloudPath = photoCloudPath(accountKey, inspirationId, photoId);
    } catch (err) {
      return { ok: false, code: CODE.invalidSegment };
    }
    if (typeof tempFilePath !== 'string' || tempFilePath.length === 0) {
      return { ok: false, code: CODE.uploadFailed };
    }

    try {
      const result = await uploadFile({ filePath: tempFilePath, cloudPath });
      if (!result || typeof result.fileID !== 'string' || result.fileID.length === 0) {
        return { ok: false, code: CODE.uploadFailed };
      }
      return { ok: true, fileId: result.fileID };
    } catch (err) {
      return { ok: false, code: CODE.uploadFailed };
    }
  }

  /**
   * 批量清理云存储文件，用于删除灵感时的联动。
   *
   * 返回**逐个文件**的结果，而不是一个总的成败：部分成功是真实存在的情况，
   * 压成一个布尔值会让调用方无法决定「哪些记录可以安全地删掉」。
   */
  async function removePhotos(fileIds) {
    const list = Array.isArray(fileIds) ? fileIds : [];
    if (list.length === 0) return { ok: true, removed: [], failed: [] };

    if (typeof removeFile !== 'function') {
      return { ok: false, removed: [], failed: list.slice() };
    }

    const removed = [];
    const failed = [];
    for (const fileId of list) {
      try {
        await removeFile(fileId);
        removed.push(fileId);
      } catch (err) {
        failed.push(fileId);
      }
    }

    return { ok: failed.length === 0, removed, failed };
  }

  return { uploadPhoto, removePhotos };
}

module.exports = { createUploader, photoCloudPath, PHOTO_PREFIX, CODE, SAFE_SEGMENT };
