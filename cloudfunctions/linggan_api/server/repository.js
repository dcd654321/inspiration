'use strict';
// 服务端的仓库层：账户文档的读写、幂等、冲突与代际。
//
// 与 `cloudfunctions/` 分离，是为了**能脱离云环境单测**——放在云函数目录里的话，
// 测试要先把 wx-server-sdk 整套桩起来，实际没人会那么干。
//
// 数据库从外面注入，便于并发与失败路径测试。含照片删除在安全协议完成前拒绝。
//
// 这一层要守住的是**数据库不替我们守的那几条**（见 docs/database-design.md §7）：
// 文档数据库不校验字段类型、没有外键、不管引用完整性。把它们当成数据库的事，
// 就是这类项目最常见的跑偏方式。

const CODE = {
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  staleGeneration: 'STALE_GENERATION',
  invalidPayload: 'INVALID_PAYLOAD',
  immutableViolation: 'HISTORY_TRUNCATED',
  mergeTargetInvalid: 'MERGE_TARGET_INVALID',
  photoDeleteUnavailable: 'PHOTO_DELETE_UNAVAILABLE',
  internal: 'INTERNAL'
};

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

function ok(data) {
  return { ok: true, data };
}

function err(code, message) {
  return { ok: false, code, message: message || code };
}

function emptyAccount(accountKey, now) {
  return {
    accountKey,
    generation: 1,
    version: 0,
    updatedAt: now,
    inspirations: []
  };
}

/** 客户端提交的身份字段一律不接受——身份只能来自可信上下文。 */
const IDENTITY_FIELDS = ['accountKey', 'openid', '_openid', 'appid', 'unionid', 'uid'];

function findIdentityField(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const field of IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) return field;
  }
  return null;
}

function validRevision(data) {
  return Number.isSafeInteger(data.generation) && data.generation > 0 &&
    Number.isSafeInteger(data.baseVersion) && data.baseVersion >= 0;
}

function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function createRepository(options) {
  const opts = options || {};
  const db = opts.db;
  const now = opts.now;
  const beforeRemove = opts.beforeRemove;

  if (!db) throw new Error('createRepository 需要 db');
  if (typeof now !== 'function') throw new Error('createRepository 需要 now()');

  async function load(accountKey) {
    const doc = await db.get(accountKey);
    return doc && Array.isArray(doc.inspirations) ? doc : emptyAccount(accountKey, now());
  }

  /** 拉取全量快照。 */
  async function pull(accountKey) {
    const doc = await load(accountKey);
    return ok({
      cacheScope: accountKey,
      generation: doc.generation,
      version: doc.version,
      inspirations: doc.inspirations,
      serverTime: now()
    });
  }

  /**
   * 增量写入。
   *
   * 三道校验，缺一不可：
   *   1. **代际**：客户端带的 generation 落后 → 拒绝，让它丢弃离线队列。
   *      这保证已被清理的数据不会被离线旧设备回传。
   *   2. **版本**：baseVersion 与服务端不一致 → 冲突，不自动合并、不覆盖。
   *   3. **历史只增不减**：客户端可以改 text，但不得从 textHistory 里删掉任何一版。
   *      这是「你说过的话不会被悄悄抹掉」在服务端唯一的落点——客户端自己不去删，
   *      不构成保证。
   */
  async function push(accountKey, payload) {
    const identityField = findIdentityField(payload);
    if (identityField) {
      return err('IDENTITY_FIELD_REJECTED', '请求体不得包含身份字段');
    }

    const data = payload || {};
    if (!Array.isArray(data.upserts) || !validRevision(data)) {
      return err(CODE.invalidPayload, '缺少有效的版本、代际或灵感列表');
    }

    const doc = await load(accountKey);

    if (data.generation !== doc.generation) {
      return err(CODE.staleGeneration);
    }

    const byId = new Map(doc.inspirations.map((item) => [item.id, item]));
    const applied = [];

    for (const incoming of data.upserts) {
      if (!incoming || typeof incoming.id !== 'string' || !SAFE_SEGMENT.test(incoming.id)) {
        return err(CODE.invalidPayload, '灵感标识不合法');
      }
      if (incoming.deletedAt !== null && incoming.deletedAt !== undefined) {
        return err(CODE.invalidPayload, '删除须使用独立动作');
      }

      const existing = byId.get(incoming.id);
      if (existing) {
        // 历史只增不减：把已有的每一条都在提交里找一遍，缺一条就拒绝整批
        const incomingIds = new Set((incoming.textHistory || []).map((v) => v.id));
        for (const version of existing.textHistory || []) {
          if (!incomingIds.has(version.id)) {
            return err(CODE.immutableViolation, '提交中删除了已有的原文历史版本');
          }
        }
      }

      byId.set(incoming.id, incoming);
      applied.push(incoming.id);
    }

    // 传输层缓存可能已过期；相同内容的重试仍应按已完成处理，不再增加版本。
    if (data.upserts.length === 0 || data.upserts.every((item) => sameContent(doc.inspirations.find((old) => old.id === item.id), item))) {
      return ok({ version: doc.version, applied });
    }

    if (data.baseVersion !== doc.version) return err(CODE.conflict);

    const next = Object.assign({}, doc, {
      inspirations: Array.from(byId.values()),
      version: doc.version + 1,
      updatedAt: now()
    });
    const written = await db.compareAndSwap(accountKey, doc.version, next);
    if (!written) return err(CODE.conflict);

    return ok({ version: next.version, applied });
  }

  /**
   * 删除一条灵感。无照片时按版本条件移除；含照片时拒绝，
   * 避免云文件批量删除部分成功后谎称能够物理回滚。
   */
  async function remove(accountKey, payload) {
    const data = payload || {};
    const identityField = findIdentityField(data);
    if (identityField) {
      return err('IDENTITY_FIELD_REJECTED', '请求体不得包含身份字段');
    }
    if (typeof data.inspirationId !== 'string' || !SAFE_SEGMENT.test(data.inspirationId) || !validRevision(data)) {
      return err(CODE.invalidPayload, '缺少有效的灵感标识、版本或代际');
    }

    const doc = await load(accountKey);
    if (data.generation !== doc.generation) return err(CODE.staleGeneration);
    const index = doc.inspirations.findIndex((item) => item.id === data.inspirationId);
    if (index === -1) return ok({ deletedPhotos: 0, version: doc.version, alreadyAbsent: true });

    const target = doc.inspirations[index];
    const fileIds = (target.photos || []).map((photo) => photo.fileId).filter(Boolean);
    // 云文件批量删除可能部分成功，无法与数据库写入组成原子事务。
    // 在可恢复的清理协议完成前，拒绝带照片的删除，不制造“照片已删一部分”的假回滚。
    if (fileIds.length > 0) return err(CODE.photoDeleteUnavailable, '这条含照片，暂时无法安全删除');
    if (data.baseVersion !== doc.version) return err(CODE.conflict);

    // 撤销相关分享先于删除；若撤销失败，源记录保持原样。
    // 并发导致后面的 CAS 失败时分享可能已撤销，属于保守的失败关闭。
    if (typeof beforeRemove === 'function') await beforeRemove(accountKey, data.inspirationId);

    const next = Object.assign({}, doc, {
      inspirations: doc.inspirations.filter((item) => item.id !== data.inspirationId),
      version: doc.version + 1,
      updatedAt: now()
    });
    const written = await db.compareAndSwap(accountKey, doc.version, next);
    if (!written) return err(CODE.conflict);
    return ok({ deletedPhotos: 0, version: next.version });
  }

  return { pull, push, remove };
}

module.exports = { createRepository, CODE, IDENTITY_FIELDS, emptyAccount };
