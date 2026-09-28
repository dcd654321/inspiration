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
const { createSharingFeedbackService } = require('./server/sharing-feedback');
const { createCloudSharingDb } = require('./server/cloud-sharing-db');
const { createCloudRateLimiter } = require('./server/rate-limit');
const { createPhotoValidator } = require('./server/photo-lifecycle');

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
const tokenKeyHex = process.env.LINGGAN_SHARE_TOKEN_KEY || '';
function previousTokenKeys() {
  try {
    const value = JSON.parse(process.env.LINGGAN_SHARE_PREVIOUS_KEYS || '{}');
    const keys = {};
    for (const [name, hex] of Object.entries(value)) {
      if (/^[A-Za-z0-9_-]{1,32}$/.test(name) && typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex)) {
        keys[name] = Buffer.from(hex, 'hex');
      }
    }
    return keys;
  } catch (err) { return {}; }
}
// 默认开放创建流程，显式 false 可紧急暂停；无效值不作启用处理。
// 密钥、身份、审核等实际依赖仍由服务端逐项检查，开关不代替检查。
const shareCreateFlag = process.env.LINGGAN_SHARE_CREATE_ENABLED;
const shareCreateEnabled = shareCreateFlag == null || shareCreateFlag === '' || shareCreateFlag === 'true';
const sharing = createSharingFeedbackService({
  db: createCloudSharingDb({ db, accounts: accountDb }),
  rateLimit: createCloudRateLimiter({ db }),
  now: () => Date.now(),
  createEnabled: shareCreateEnabled,
  tokenKey: /^[0-9a-fA-F]{64}$/.test(tokenKeyHex) ? Buffer.from(tokenKeyHex, 'hex') : null,
  tokenKeys: previousTokenKeys(),
  keyId: process.env.LINGGAN_SHARE_KEY_ID || 'v1',
  async checkPublicText(content) {
    // 云调用未授权、审核报错或结果不明确时失败关闭，绝不直接公开文字。
    const caller = getCallerIdentity(cloud.getWXContext());
    if (!caller) return false;
    const openapi = cloud.openapi({ appid: caller.appid });
    const chars = Array.from(content);
    for (let offset = 0; offset < chars.length; offset += 600) {
      const result = await openapi.security.msgSecCheck({
        content: chars.slice(offset, offset + 600).join(''), version: 2, scene: 4, openid: caller.openid
      });
      if (!result || (result.errCode !== 0 && result.errcode !== 0) || !result.result || result.result.suggest !== 'pass') return false;
    }
    return chars.length > 0;
  },
  async generateCode(scene, page) {
    const caller = getCallerIdentity(cloud.getWXContext());
    if (!caller) return null;
    const requested = process.env.LINGGAN_SHARE_CODE_VERSION;
    const envVersion = ['develop', 'trial', 'release'].includes(requested) ? requested : 'release';
    const result = await cloud.openapi({ appid: caller.appid }).wxacode.getUnlimited({
      scene, page, width: 430, checkPath: envVersion === 'release', envVersion
    });
    if (!result || !result.buffer) return null;
    return Buffer.isBuffer(result.buffer) ? result.buffer :
      typeof result.buffer === 'string' ? Buffer.from(result.buffer, 'base64') : Buffer.from(result.buffer);
  }
});

const protocol = createProtocol({
  repository: createRepository({
    db: accountDb,
    now: () => Date.now(),
    beforeRemove: sharing.revokeForSource,
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
  sharing,
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
function accountKeyOf(wxContext) {
  const caller = getCallerIdentity(wxContext);
  return caller ? caller.accountKey : '';
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  return protocol.handle(
    { accountKey: accountKeyOf(wxContext) },
    event
  );
};
