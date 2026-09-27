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

const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');

const { createRepository } = require('./server/repository');
const { createProtocol } = require('./server/protocol');
const { createSharingFeedbackService } = require('./server/sharing-feedback');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 与 miniprogram/config/cloud-resources.js 的 accountCollection 保持一致。
// 云函数不能 require 小程序目录，所以这里重复一份——改名时两处都要改。
const COLLECTION = 'linggan_accounts';
const SHARES = 'linggan_shares';
const FEEDBACK = 'linggan_feedback';

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
        inspirations: doc.inspirations
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

/** 新集合也只经云函数访问；客户端数据库权限保持全拒绝。 */
function createSharingDbAdapter(accounts) {
  async function first(collection, where) {
    const result = await db.collection(collection).where(where).limit(1).get();
    return result.data && result.data.length ? result.data[0] : null;
  }
  async function count(collection, where) {
    const result = await db.collection(collection).where(where).count();
    return result.total || 0;
  }
  function mineQuery(collection, ownerField, accountKey, before, limit) {
    const where = { [ownerField]: accountKey };
    if (before) where._id = db.command.lt(before);
    return db.collection(collection).where(where).orderBy('_id', 'desc').limit(limit).get()
      .then((result) => result.data || []);
  }
  return {
    getAccount: (accountKey) => accounts.get(accountKey),
    findShareByRequest: (ownerAccountKey, requestId) => first(SHARES, { ownerAccountKey, requestId }),
    findShareByHash: (tokenHash) => first(SHARES, { tokenHash }),
    findShareById: (_id) => first(SHARES, { _id }),
    insertShare: (doc) => db.collection(SHARES).add({ data: doc }),
    listShares: (accountKey, before, limit) => mineQuery(SHARES, 'ownerAccountKey', accountKey, before, limit),
    countActiveShares: (ownerAccountKey, at) => count(SHARES,
      { ownerAccountKey, revokedAt: null, expiresAt: db.command.gt(at) }),
    countSharesSince: (ownerAccountKey, since) => count(SHARES,
      { ownerAccountKey, createdAt: db.command.gte(since) }),
    revokeShare: (ownerAccountKey, _id, at) => db.collection(SHARES)
      .where({ ownerAccountKey, _id, revokedAt: null }).update({ data: { revokedAt: at } }),
    revokeSharesForSource: (ownerAccountKey, sourceInspirationId, at) => db.collection(SHARES)
      .where({ ownerAccountKey, sourceInspirationId, revokedAt: null }).update({ data: { revokedAt: at } }),
    findFeedbackByRequest: (accountKey, requestId) => first(FEEDBACK, { accountKey, requestId }),
    findFeedbackByDedupeKey: (dedupeKey) => first(FEEDBACK, { dedupeKey }),
    insertFeedback: (doc) => db.collection(FEEDBACK).add({ data: doc }),
    listFeedback: (accountKey, before, limit) => mineQuery(FEEDBACK, 'accountKey', accountKey, before, limit),
    countFeedbackSince: (accountKey, since) => count(FEEDBACK,
      { accountKey, createdAt: db.command.gte(since) })
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
  db: createSharingDbAdapter(accountDb),
  now: () => Date.now(),
  createEnabled: shareCreateEnabled,
  tokenKey: /^[0-9a-fA-F]{64}$/.test(tokenKeyHex) ? Buffer.from(tokenKeyHex, 'hex') : null,
  tokenKeys: previousTokenKeys(),
  keyId: process.env.LINGGAN_SHARE_KEY_ID || 'v1',
  async checkPublicText(content) {
    // 云调用未授权、审核报错或结果不明确时失败关闭，绝不直接公开文字。
    const result = await cloud.openapi.security.msgSecCheck({ content });
    return result && (result.errCode === 0 || result.errcode === 0);
  },
  async generateCode(scene, page) {
    const requested = process.env.LINGGAN_SHARE_CODE_VERSION;
    const envVersion = ['develop', 'trial', 'release'].includes(requested) ? requested : 'release';
    const result = await cloud.openapi.wxacode.getUnlimited({
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
    beforeRemove: sharing.revokeForSource
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
  const appid = wxContext.APPID || '';
  const openid = wxContext.OPENID || '';
  if (!openid) return '';
  return crypto.createHash('sha256').update(appid + '|' + openid).digest('hex').slice(0, 32);
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  return protocol.handle(
    { accountKey: accountKeyOf(wxContext) },
    event
  );
};
