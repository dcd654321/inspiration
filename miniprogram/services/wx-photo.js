'use strict';
const { createPhotoService } = require('./photo');
const { createUploader, photoCloudPath } = require('./upload');
const { createPhotoWorkflow } = require('./photo-workflow');
const { getCloudClient } = require('./cloud-client');
const call = (name, options) => new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject })));
function createWxPhotos({ storage, cacheScope, store, storagePrefix, isCurrent }) {
  if (!/^cloud:\/\/[A-Za-z0-9_.-]+\/$/.test(storagePrefix || '')) throw Error('PHOTO_CONFIG_INVALID');
  const photo = createPhotoService({
    async ensurePermission(source) {
      if (typeof wx.requirePrivacyAuthorize === 'function') await call('requirePrivacyAuthorize', {});
      if (source === 'camera') await call('authorize', { scope: 'scope.camera' });
      // 选取相册由微信原生选择器授权，不请求用于保存到相册的权限。
      return true;
    },
    async chooseMedia(source, count) {
      const result = await call('chooseMedia', { count, mediaType: ['image'], sourceType: [source], sizeType: ['compressed'] });
      return result.tempFiles;
    },
    async compressImage(src) {
      const result = await call('compressImage', { src, quality: 70 });
      const info = await call('getFileInfo', { filePath: result.tempFilePath });
      return { tempFilePath: result.tempFilePath, size: info.size };
    }
  });
  const uploader = createUploader({ uploadFile: async (input) => (await getCloudClient()).uploadFile(input) });
  return createPhotoWorkflow({ storage, cacheScope, store, isCurrent, prepare: photo.prepare, upload: uploader.uploadPhoto,
    expectedFileId: (inspirationId, photoId) => storagePrefix + photoCloudPath(cacheScope, inspirationId, photoId),
    saveFile: async (tempFilePath) => (await call('saveFile', { tempFilePath })).savedFilePath,
    async removeLocal(filePath) {
      const files = await call('getSavedFileList', {});
      if ((files.fileList || []).some((item) => item.filePath === filePath)) await call('removeSavedFile', { filePath });
    },
    async removeRemote(fileID) {
      const result = await (await getCloudClient()).deleteFile({ fileList: [fileID] });
      const file = result && result.fileList && result.fileList[0];
      if (!file || file.fileID !== fileID || (file.status !== 0 && file.code !== 'STORAGE_FILE_NONEXIST')) throw Error('照片清理未完成，请稍后重试。');
    }
  });
}
module.exports = { createWxPhotos };
