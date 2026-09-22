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

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 与 miniprogram/config/cloud-resources.js 的 accountCollection 保持一致。
// 云函数不能 require 小程序目录，所以这里重复一份——改名时两处都要改。
const COLLECTION = 'linggan_accounts';

// requestId 缓存的上限。云函数实例是复用的，Map 会跨调用存活，
// 不设上限的话高频调用下会一直涨。超了直接清空——它是加速用的，丢了只是变慢。
const REQUEST_CACHE_MAX = 500;

const db = cloud.database();

/**
 * 把云数据库包成仓库层要的两个方法。
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

    async put(accountKey, doc) {
      const found = await db.collection(COLLECTION).where({ accountKey }).limit(1).get();
      if (found.data.length > 0) {
        await db.collection(COLLECTION).doc(found.data[0]._id).update({ data: doc });
        return;
      }
      await db.collection(COLLECTION).add({ data: doc });
    }
  };
}

/** 删云存储文件。返回逐个结果——部分成功是真实存在的情况。 */
async function removeFiles(fileIds) {
  const result = await cloud.deleteFile({ fileList: fileIds });
  const list = result.fileList || [];
  const failed = list.filter((item) => item.status !== 0).map((item) => item.fileID);
  return {
    ok: failed.length === 0,
    removed: fileIds.filter((id) => failed.indexOf(id) === -1),
    failed
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

const protocol = createProtocol({
  repository: createRepository({
    db: createDbAdapter(),
    removeFiles,
    now: () => Date.now()
  }),
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
