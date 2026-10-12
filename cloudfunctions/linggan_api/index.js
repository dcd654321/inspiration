'use strict';
// 云函数入口：linggan_api
//
// 这个文件只做三件事：初始化、从**可信上下文**取身份、转发给 server/。
// 业务逻辑一行都不在这里——它在 `./server/`，那样才能脱离云环境单测
// （见 docs/detailed-design.md §1）。
//
// ⚠️ `./server/` 是 `scripts/build-cloud.cjs` 从仓库根目录的 `server/` 同步过来的副本。
// **不要直接改这里的文件**——改了会被下次同步覆盖，而且 `npm run check` 会报不一致。
// 要改就去改仓库根的 `server/`，然后跑 `node scripts/build-cloud.cjs`。

const cloud = require('wx-server-sdk');
const { getCallerIdentity } = require('./server/wx-identity');

const { createRepository } = require('./server/repository');
const { createProtocol } = require('./server/protocol');
const { createFeedbackService } = require('./server/feedback');
const { createCloudFeedbackDb } = require('./server/cloud-feedback-db');
const { createCloudRateLimiter } = require('./server/rate-limit');
const { createPhotoValidator } = require('./server/photo-lifecycle');
const { createCommittedMonitor } = require('./server/operations-monitor');
const crypto = require('node:crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 与 miniprogram/config/cloud-resources.js 的 accountCollection 保持一致。
// 云函数不能 require 小程序目录，所以这里重复一份——改名时两处都要改。
const COLLECTION = 'linggan_accounts';

// requestId 缓存的上限。云函数实例是复用的，Map 会跨调用存活，
// 不设上限的话高频调用下会一直涨。超了直接清空——它是加速用的，丢了只是变慢。
const REQUEST_CACHE_MAX = 500;

const db = cloud.database();

/**
 * 把云数据库包成仓库层要的读取与条件写入方法。
 *
 * 用 `where({ accountKey })` 而不是 `doc(_id)`：accountKey 是唯一的业务键，
 * 集合上应当有它的唯一索引（见 docs/database-design.md §4.1）。
 */
function createDbAdapter() {
  return {
    async get(accountKey) {
      const found = await db.collection(COLLECTION).where({ accountKey }).limit(1).get();
      return found.data.length > 0 ? found.data[0] : null;
    },

    async compareAndSwap(accountKey, expectedVersion, doc) {
      const data = {
        accountKey,
        generation: doc.generation,
        version: doc.version,
        updatedAt: doc.updatedAt,
        inspirations: doc.inspirations,
        photoCleanup: doc.photoCleanup || []
      };
      const collection = db.collection(COLLECTION);
      const result = await collection.where({ accountKey, version: expectedVersion }).update({ data });
      if (result && result.stats && result.stats.updated === 1) return true;

      // 首次写入由 accountKey 唯一索引兜住并发创建；索引未配置时不能宣称此路径安全。
      if (expectedVersion !== 0) return false;
      const found = await collection.where({ accountKey }).limit(1).get();
      if (found.data.length > 0) return false;
      try {
        await collection.add({ data });
        return true;
      } catch (err) {
        const after = await collection.where({ accountKey }).limit(1).get();
        if (after.data.length > 0) return false;
        throw err;
      }
    }
  };
}

function createMemoryCache() {
  const map = new Map();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (map.size >= REQUEST_CACHE_MAX) map.clear();
      map.set(key, value);
    }
  };
}

const accountDb = createDbAdapter();
const feedback = createFeedbackService({
  db: createCloudFeedbackDb({ db }),
  rateLimit: createCloudRateLimiter({ db }),
  now: () => Date.now()
});

const protocol = createProtocol({
  repository: createRepository({
    db: accountDb,
    now: () => Date.now(),
    onCommitted: createCommittedMonitor({ db, onFailure: (code) => console.warn(code) }),
    onMonitorFailure: (code) => console.warn(code),
    photosEnabled: process.env.LINGGAN_PHOTOS_ENABLED === 'true' && /^cloud:\/\/[A-Za-z0-9_.-]+\/$/.test(process.env.LINGGAN_STORAGE_PREFIX || ''),
    validatePhoto: createPhotoValidator(process.env.LINGGAN_STORAGE_PREFIX),
    storagePrefix: process.env.LINGGAN_STORAGE_PREFIX,
    async removeFiles(fileIds) {
      const removed = [], failed = [];
      for (const fileID of fileIds) {
        try {
          const result = await cloud.deleteFile({ fileList: [fileID] });
          const file = result && result.fileList && result.fileList[0];
          // SDK 仅 status=0 是可确认的成功；未知错误保留任务，不猜测已不存在。
          if (file && file.fileID === fileID && (file.status === 0 || file.code === 'SUCCESS' || file.code === 'STORAGE_FILE_NONEXIST')) removed.push(fileID);
          else failed.push(fileID);
        } catch (err) { if (err.code === 'STORAGE_FILE_NONEXIST') removed.push(fileID); else failed.push(fileID); }
      }
      return { ok: failed.length === 0, removed, failed };
    }
  }),
  feedback,
  requestCache: createMemoryCache(),
  now: () => Date.now()
});

/**
 * 从可信上下文推导账户标识。
 *
 * **只认 `cloud.getWXContext()`**，请求体里带的任何身份字段一律不采信（协议层会拒绝）。
 *
 * 取哈希而不是直接用 OPENID：accountKey 会进入云存储路径
 * （`linggan/{accountKey}/{inspirationId}/{photoId}`），裸的 openid 不该出现在路径里。
 * 哈希是稳定的——同一个账户永远得到同一个 key。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const caller = getCallerIdentity(wxContext);

  return protocol.handle(
    { accountKey: caller ? caller.accountKey : '', sourceUserId: caller
      ? 'user_' + crypto.createHash('sha256').update(caller.appid + '|' + caller.openid).digest('hex').slice(0, 24) : '' },
    event
  );
};
