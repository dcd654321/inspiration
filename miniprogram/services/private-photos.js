'use strict';
const config = require('../config/cloud');
const { getCloudClient } = require('./cloud-client');

async function loadPrivatePhotos(photos, { cacheScope, isCurrent, getClient = getCloudClient }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope || '') || !Array.isArray(photos) || !isCurrent()) return [];
  if (!photos.length) return [];
  let client;
  try { client = await getClient(); } catch (err) { return isCurrent() ? photos.map((photo) => ({ id: photo.id, src: '', failed: true })) : []; }
  const results = await Promise.all(photos.map(async (photo) => {
    const result = { id: photo.id, src: '', failed: true };
    const fileId = photo.fileId;
    if (!isCurrent() || typeof fileId !== 'string' ||
        !fileId.startsWith('cloud://' + config.envId + '.') ||
        !new RegExp('^cloud://[A-Za-z0-9_.-]+/linggan/' + cacheScope + '/[A-Za-z0-9_]{1,64}/[A-Za-z0-9_]{1,64}$').test(fileId)) return result;
    try {
      const response = await client.downloadFile({ fileID: fileId });
      if (isCurrent() && response && typeof response.tempFilePath === 'string' && response.tempFilePath) {
        result.src = response.tempFilePath;
        result.failed = false;
      }
    } catch (err) { /* 不记录用户文件或授权信息。 */ }
    return result;
  }));
  return isCurrent() ? results : [];
}

module.exports = { loadPrivatePhotos };
