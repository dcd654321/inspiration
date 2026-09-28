'use strict';
// 账户分区的本机快照和待备份操作。一次写入同时保存正文与操作，不留下半条队列。
const { byUpdatedAtDesc, isDeleted, isMerged } = require('../core/inspiration');
const { createRequestId } = require('./wx-transport');

const LEGACY_STORAGE_KEYS = Object.freeze({
  snapshot: 'linggan:v1:snapshot',
  queue: 'linggan:v1:queue'
});
const SCOPE_PATTERN = /^[a-f0-9]{32}$/;
const MAX_RETRY_PER_PASS = 3;

function emptySnapshot() {
  return { generation: 1, version: 0, syncedAt: 0, inspirations: [] };
}

function validRemote(remote, scope) {
  return remote && remote.cacheScope === scope &&
    Number.isSafeInteger(remote.generation) && remote.generation > 0 &&
    Number.isSafeInteger(remote.version) && remote.version >= 0 &&
    Array.isArray(remote.inspirations);
}

function createStore(options) {
  const opts = options || {};
  const { storage, transport, now, cacheScope, remoteSnapshot } = opts;
  const photosEnabled = remoteSnapshot && remoteSnapshot.photosEnabled === true;
  const isCurrent = typeof opts.isCurrent === 'function' ? opts.isCurrent : () => true;
  const newRequestId = typeof opts.newRequestId === 'function' ? opts.newRequestId : createRequestId;
  if (!storage || typeof now !== 'function') throw new Error('createStore 需要 storage 与 now()');
  if (typeof cacheScope !== 'string' || !SCOPE_PATTERN.test(cacheScope)) throw new Error('无效的账户缓存作用域');
  if (!validRemote(remoteSnapshot, cacheScope)) throw new Error('缺少当前账户的可信云端快照');

  const key = 'linggan:v2:' + cacheScope + ':state';
  let retryPromise = null;

  function readState() {
    let raw;
    try { raw = storage.get(key); } catch (err) { throw new Error('ACCOUNT_CACHE_DAMAGED'); }
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (err) { throw new Error('ACCOUNT_CACHE_DAMAGED'); }
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.inspirations) ||
        !Array.isArray(raw.queue) || !Number.isSafeInteger(raw.version) ||
        !Number.isSafeInteger(raw.generation) || raw.generation < 1 ||
        !Number.isSafeInteger(raw.nextSequence) ||
        (raw.recoveries !== undefined && (!Array.isArray(raw.recoveries) ||
          raw.recoveries.some((entry) => !entry || !entry.snapshot ||
            !Array.isArray(entry.snapshot.inspirations) || !Array.isArray(entry.pendingOps))))) {
      throw new Error('ACCOUNT_CACHE_DAMAGED');
    }
    return raw;
  }

  function writeState(state) {
    storage.set(key, state);
    return state;
  }

  // 不读取、不迁移 v1 全局键；用户确认无须保留的真实记录，测试缓存仍原样保留。
  const previous = readState();
  if (previous && previous.conflict) {
    writeState(Object.assign({}, previous, {
      conflict: Object.assign({}, previous.conflict, { remote: remoteSnapshot })
    }));
  } else if (!previous || previous.queue.length === 0) {
    writeState({
      generation: remoteSnapshot.generation,
      version: remoteSnapshot.version,
      syncedAt: now(),
      inspirations: remoteSnapshot.inspirations,
      queue: [],
      conflict: null,
      nextSequence: previous ? previous.nextSequence : 0,
      recoveries: previous && previous.recoveries || []
    });
  }

  function readSnapshot() {
    const state = readState();
    return {
      generation: state.generation,
      version: state.version,
      syncedAt: state.syncedAt,
      inspirations: state.inspirations
    };
  }

  function readQueue() { return readState().queue; }

  function getConflict() { return readState().conflict || null; }

  function getRecoveries() { return readState().recoveries || []; }

  function getBackupStatus() {
    const state = readState();
    return {
      state: state.conflict ? state.conflict.code : state.queue.length > 0 ? 'pending' : 'synced',
      pendingCount: state.queue.length,
      syncedAt: state.syncedAt
    };
  }

  async function performRetry() {
    if (!transport) return { ok: false, code: 'NETWORK' };
    let last = { ok: true, synced: true };
    for (let attempt = 0; attempt < MAX_RETRY_PER_PASS; attempt += 1) {
      if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
      const state = readState();
      if (state.conflict) return { ok: false, code: state.conflict.code };
      if (state.queue.length === 0) return last;

      let operation = state.queue[0];
      if (operation.baseVersion === null) {
        operation = Object.assign({}, operation, { baseVersion: state.version });
        writeState(Object.assign({}, state, { queue: [operation].concat(state.queue.slice(1)) }));
      }
      const action = operation.kind === 'delete' ? 'inspiration.delete' : operation.kind === 'photoDelete' ? 'photo.delete' : 'snapshot.push';
      const payload = operation.kind === 'delete' || operation.kind === 'photoDelete'
        ? Object.assign({ inspirationId: operation.inspirationId, baseVersion: operation.baseVersion, generation: state.generation }, operation.kind === 'photoDelete' ? { photoId: operation.photoId } : {})
        : { upserts: operation.kind === 'batch' ? operation.inspirations : [operation.inspiration], baseVersion: operation.baseVersion, generation: state.generation };
      let response;
      try {
        response = await transport.send(action, payload, { requestId: operation.requestId });
      } catch (err) {
        return { ok: false, code: 'NETWORK' };
      }
      if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
      if (!response || !response.ok) {
        const code = response && response.code || 'INTERNAL';
        if (code === 'CONFLICT' || code === 'STALE_GENERATION' || code === 'PHOTO_DELETE_UNAVAILABLE' ||
            code === 'REQUEST_ID_REUSED') {
          let remote = null;
          try {
            const pulled = await transport.send('snapshot.pull', {});
            if (pulled && pulled.ok && validRemote(pulled.data, cacheScope)) remote = pulled.data;
          } catch (err) { /* 冲突先保留，稍后仍可重新获取远端快照。 */ }
          if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
          const latest = readState();
          writeState(Object.assign({}, latest, { conflict: { code, remote } }));
        }
        return { ok: false, code };
      }
      const version = response.data && response.data.version;
      if (!Number.isSafeInteger(version) || version < 0) return { ok: false, code: 'INTERNAL' };
      const latest = readState();
      if (!latest.queue.length || latest.queue[0].requestId !== operation.requestId) {
        return { ok: false, code: 'LOCAL_STATE_CHANGED' };
      }
      writeState(Object.assign({}, latest, {
        version,
        syncedAt: now(),
        queue: latest.queue.slice(1),
        inspirations: operation.kind === 'delete'
          ? latest.inspirations.filter((item) => item.id !== operation.inspirationId)
            .map((item) => item.mergedInto === operation.inspirationId ? Object.assign({}, item, { mergedInto: null }) : item)
          : operation.kind === 'photoDelete' ? latest.inspirations.map((item) => item.id === operation.inspirationId
            ? Object.assign({}, item, { photos: (item.photos || []).filter((photo) => photo.id !== operation.photoId) }) : item) : latest.inspirations
      }));
      last = { ok: true, synced: true };
    }
    return readQueue().length ? { ok: true, synced: false, code: 'PENDING' } : last;
  }

  function retryPending() {
    if (!retryPromise) {
      retryPromise = performRetry().finally(() => { retryPromise = null; });
    }
    return retryPromise;
  }

  /** 用户明确选择云端版本后，先保留本机完整副本，再原子切换活动快照。 */
  async function resolveUseRemote() {
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    if (retryPromise) {
      try { await retryPromise; } catch (err) { /* 原队列仍在；以下重新核对状态。 */ }
    }
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    const state = readState();
    if (!state.conflict) return { ok: false, code: 'NO_CONFLICT' };
    if (!transport) return { ok: false, code: 'NETWORK' };
    let pulled;
    try { pulled = await transport.send('snapshot.pull', {}); }
    catch (err) { return { ok: false, code: 'NETWORK' }; }
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    if (!pulled || !pulled.ok || !validRemote(pulled.data, cacheScope)) {
      return { ok: false, code: 'PULL_FAILED' };
    }
    const latest = readState();
    if (!latest.conflict) return { ok: false, code: 'NO_CONFLICT' };
    if (!photosEnabled && latest.inspirations.some((item) => Array.isArray(item.photos) &&
        item.photos.some((photo) => photo.fileId))) {
      return { ok: false, code: 'PHOTO_RECOVERY_UNAVAILABLE' };
    }
    const recovery = {
      savedAt: now(),
      reason: latest.conflict.code,
      snapshot: {
        generation: latest.generation,
        version: latest.version,
        syncedAt: latest.syncedAt,
        inspirations: latest.inspirations
      },
      pendingOps: latest.queue
    };
    const recoveries = (latest.recoveries || []).concat([recovery]);
    try {
      writeState(Object.assign({}, latest, {
        generation: pulled.data.generation,
        version: pulled.data.version,
        syncedAt: now(),
        inspirations: pulled.data.inspirations,
        queue: [],
        conflict: null,
        recoveries
      }));
    } catch (err) {
      return { ok: false, code: 'LOCAL_WRITE_FAILED' };
    }
    return { ok: true, recoveryCount: recoveries.length };
  }

  function queueOperation(state, operation) {
    const sequence = state.nextSequence + 1;
    return {
      sequence,
      entry: Object.assign({}, operation, {
        requestId: newRequestId() + '_' + sequence,
        baseVersion: null
      })
    };
  }

  async function saveInspiration(item) {
    return saveInspirations([item]);
  }

  async function saveInspirations(items) {
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    const state = readState();
    if (state.conflict) return { ok: false, code: state.conflict.code };
    if (!Array.isArray(items) || !items.length || items.length > 21 || items.some((item) => !item || typeof item.id !== 'string' || item.deletedAt) ||
        new Set(items.map((x) => x.id)).size !== items.length) return { ok: false, code: 'INVALID_PAYLOAD' };
    if (state.queue.some((op) => ['delete', 'photoDelete'].includes(op.kind) && items.some((item) => item.id === op.inspirationId))) return { ok: false, code: 'PHOTO_CLEANUP_PENDING' };
    const byId = new Map(state.inspirations.map((item) => [item.id, item]));
    items.forEach((item) => byId.set(item.id, item));
    const inspirations = Array.from(byId.values());
    const operation = items.length === 1 ? { kind: 'upsert', inspiration: items[0] } : { kind: 'batch', inspirations: items };
    const { sequence, entry } = queueOperation(state, operation);
    try {
      writeState(Object.assign({}, state, {
        inspirations, nextSequence: sequence, queue: state.queue.concat([entry])
      }));
    } catch (err) { return { ok: false, code: 'LOCAL_WRITE_FAILED' }; }
    let result;
    try { result = await retryPending(); }
    catch (err) { return { ok: true, synced: false, code: 'LOCAL_STATE_WRITE_FAILED' }; }
    return { ok: true, synced: readQueue().length === 0, code: result.code };
  }

  async function deleteInspiration(id) {
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    const state = readState();
    if (state.conflict) return { ok: false, code: state.conflict.code };
    const target = state.inspirations.find((item) => item.id === id);
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    if (!photosEnabled && Array.isArray(target.photos) && target.photos.some((photo) => photo.fileId)) {
      return { ok: false, code: 'PHOTO_DELETE_UNAVAILABLE' };
    }
    const { sequence, entry } = queueOperation(state, { kind: 'delete', inspirationId: id });
    if (state.queue.some((op) => ['delete', 'photoDelete'].includes(op.kind) && op.inspirationId === id)) {
      const result = await retryPending();
      return { ok: true, synced: !getInspiration(id), code: result.code };
    }
    try {
      writeState(Object.assign({}, state, { nextSequence: sequence, queue: state.queue.concat([entry]) }));
    } catch (err) { return { ok: false, code: 'LOCAL_WRITE_FAILED' }; }
    let result;
    try { result = await retryPending(); }
    catch (err) { return { ok: true, synced: false, code: 'LOCAL_STATE_WRITE_FAILED' }; }
    return { ok: true, synced: !readState().inspirations.some((item) => item.id === id), code: result.code };
  }

  function listInspirations() {
    return readState().inspirations.filter((item) => !isDeleted(item) && !isMerged(item)).sort(byUpdatedAtDesc);
  }

  async function deletePhoto(inspirationId, photoId) {
    if (!isCurrent()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    const state = readState();
    if (!photosEnabled) return { ok: false, code: 'PHOTO_DELETE_UNAVAILABLE' };
    if (state.conflict) return { ok: false, code: state.conflict.code };
    const item = getInspiration(inspirationId);
    if (!item || !(item.photos || []).some((photo) => photo.id === photoId)) return { ok: false, code: 'NOT_FOUND' };
    if (!state.queue.some((op) => ['delete', 'photoDelete'].includes(op.kind) && op.inspirationId === inspirationId)) {
      const { sequence, entry } = queueOperation(state, { kind: 'photoDelete', inspirationId, photoId });
      try { writeState(Object.assign({}, state, { nextSequence: sequence, queue: state.queue.concat([entry]) })); }
      catch (err) { return { ok: false, code: 'LOCAL_WRITE_FAILED' }; }
    }
    let result;
    try { result = await retryPending(); } catch (err) { result = { code: 'NETWORK' }; }
    const latest = getInspiration(inspirationId);
    return { ok: true, synced: !latest || !(latest.photos || []).some((photo) => photo.id === photoId), code: result.code };
  }

  function getInspiration(id) {
    return readState().inspirations.find((item) => item.id === id) || null;
  }

  return { readSnapshot, readQueue, getConflict, getRecoveries, getBackupStatus, retryPending, resolveUseRemote,
    saveInspiration, saveInspirations, deleteInspiration, deletePhoto, listInspirations, getInspiration };
}

module.exports = { createStore, LEGACY_STORAGE_KEYS, emptySnapshot };
