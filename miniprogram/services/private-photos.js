'use strict';
const config = require('../config/cloud');
const { getCloudClient } = require('./cloud-client');

async function loadPrivatePhotos(photos, { cacheScope, isCurrent, getClient = getCloudClient }) {
  if (!Array.isArray(photos) || !isCurrent()) return [];
  if (!/^[a-f0-9]{32}$/.test(cacheScope || '')) return photos.map((photo) => ({ id: photo.id, src: '', failed: true }));
  if (!photos.length) return [];
  const valid = (photo) => photo && typeof photo.id === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(photo.id) &&
    typeof photo.fileId === 'string' && photo.fileId.startsWith('cloud://' + config.envId + '.') &&
    new RegExp('^cloud://[A-Za-z0-9_.-]+/linggan/' + cacheScope + '/[A-Za-z0-9_]{1,64}/[A-Za-z0-9_]{1,64}$').test(photo.fileId) &&
    photo.fileId.endsWith('/' + photo.id);
  if (!photos.some(valid)) return photos.map((photo) => ({ id: photo.id, src: '', failed: true }));
  let client;
  try { client = await getClient(); } catch (err) { return isCurrent() ? photos.map((photo) => ({ id: photo.id, src: '', failed: true })) : []; }
  const results = await Promise.all(photos.map(async (photo) => {
    const result = { id: photo.id, src: '', failed: true };
    const fileId = photo.fileId;
    if (!isCurrent() || !valid(photo)) return result;
    try {
      const response = await client.downloadFile({ fileID: fileId });
      const errorCode = response && (response.errCode !== undefined ? response.errCode : response.errcode);
      if (isCurrent() && response && (errorCode === undefined || errorCode === 0) &&
          typeof response.tempFilePath === 'string' && response.tempFilePath.trim()) {
        result.src = response.tempFilePath;
        result.failed = false;
      }
    } catch (err) { /* 不记录用户文件或授权信息。 */ }
    return result;
  }));
  return isCurrent() ? results : [];
}

module.exports = { loadPrivatePhotos };
