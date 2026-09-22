'use strict';
// 服务端的仓库层：账户文档的读写、幂等、冲突与代际。
//
// 与 `cloudfunctions/` 分离，是为了**能脱离云环境单测**——放在云函数目录里的话，
// 测试要先把 wx-server-sdk 整套桩起来，实际没人会那么干。
//
// 数据库与云存储都从外面注入（`db` / `removeFiles`），理由与前几层一致。
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

function createRepository(options) {
  const opts = options || {};
  const db = opts.db;
  const removeFiles = opts.removeFiles;
  const now = opts.now;

  if (!db) throw new Error('createRepository 需要 db');
  if (typeof now !== 'function') throw new Error('createRepository 需要 now()');

  async function load(accountKey) {
    const doc = await db.get(accountKey);
    return doc && Array.isArray(doc.inspirations) ? doc : emptyAccount(accountKey, now());
  }

  async function save(doc) {
    await db.put(doc.accountKey, doc);
    return doc;
  }

  /** 拉取全量快照。 */
  async function pull(accountKey) {
    const doc = await load(accountKey);
    return ok({
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
    if (!Array.isArray(data.upserts)) {
      return err(CODE.invalidPayload, 'upserts 必须是数组');
    }

    const doc = await load(accountKey);

    if (typeof data.generation === 'number' && data.generation < doc.generation) {
      return err(CODE.staleGeneration);
    }
    if (typeof data.baseVersion === 'number' && data.baseVersion !== doc.version) {
      return err(CODE.conflict);
    }

    const byId = new Map(doc.inspirations.map((item) => [item.id, item]));
    const applied = [];

    for (const incoming of data.upserts) {
      if (!incoming || typeof incoming.id !== 'string' || !SAFE_SEGMENT.test(incoming.id)) {
        return err(CODE.invalidPayload, '灵感标识不合法');
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

    doc.inspirations = Array.from(byId.values());
    doc.version += 1;
    doc.updatedAt = now();
    await save(doc);

    return ok({ version: doc.version, applied });
  }

  /**
   * 删除一条灵感：**全成功或全保留**。
   *
   * 顺序是刻意的：先软删 → 删云存储文件 → 物理移除。第 2 步失败即回滚软删并返回失败，
   * 客户端**不得**移除本地数据。这样「图片已删但灵感还在」的中间状态在服务端就不可能产生。
   */
  async function remove(accountKey, payload) {
    const data = payload || {};
    const identityField = findIdentityField(data);
    if (identityField) {
      return err('IDENTITY_FIELD_REJECTED', '请求体不得包含身份字段');
    }
    if (typeof data.inspirationId !== 'string' || !SAFE_SEGMENT.test(data.inspirationId)) {
      return err(CODE.invalidPayload, '灵感标识不合法');
    }

    const doc = await load(accountKey);
    const index = doc.inspirations.findIndex((item) => item.id === data.inspirationId);
    if (index === -1) return err(CODE.notFound);

    const target = doc.inspirations[index];
    const fileIds = (target.photos || []).map((photo) => photo.fileId).filter(Boolean);
    const deletedAt = now();

    // 1. 软删
    doc.inspirations = doc.inspirations.map((item, i) => (
      i === index ? Object.assign({}, item, { deletedAt }) : item
    ));
    await save(doc);

    // 2. 删云存储
    if (fileIds.length > 0) {
      let removal;
      try {
        removal = await removeFiles(fileIds);
      } catch (err2) {
        removal = { ok: false };
      }
      if (!removal || removal.ok !== true) {
        // 回滚：灵感与照片全部保留
        doc.inspirations = doc.inspirations.map((item, i) => (
          i === index ? target : item
        ));
        await save(doc);
        return err(CODE.internal, '照片未能全部清理，删除已取消');
      }
    }

    // 3. 物理移除
    doc.inspirations = doc.inspirations.filter((item) => item.id !== data.inspirationId);
    doc.version += 1;
    doc.updatedAt = now();
    await save(doc);

    return ok({ deletedPhotos: fileIds.length, version: doc.version });
  }

  return { pull, push, remove };
}

module.exports = { createRepository, CODE, IDENTITY_FIELDS, emptyAccount };
