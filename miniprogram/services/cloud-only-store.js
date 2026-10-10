'use strict';
// 云端是唯一持久来源；这里的视图只在当前小程序会话的内存中存在。
const { byUpdatedAtDesc, isDeleted, isMerged } = require('../core/inspiration');
const { createRequestId } = require('./wx-transport');

const SCOPE = /^[a-f0-9]{32}$/;
function validSnapshot(value, scope) {
  return value && value.cacheScope === scope && Number.isSafeInteger(value.generation) && value.generation > 0 &&
    Number.isSafeInteger(value.version) && value.version >= 0 && Array.isArray(value.inspirations);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach((key) => { result[key] = canonical(value[key]); });
    return result;
  }
  return value;
}
const sameRecord = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function createCloudOnlyStore({ transport, remoteSnapshot, cacheScope, now = Date.now, isCurrent = () => true, newRequestId = createRequestId }) {
  if (!transport || typeof transport.send !== 'function' || !SCOPE.test(cacheScope || '') || !validSnapshot(remoteSnapshot, cacheScope)) {
    throw Error('INVALID_CLOUD_SESSION');
  }
  let snapshot = { generation: remoteSnapshot.generation, version: remoteSnapshot.version,
    syncedAt: now(), inspirations: remoteSnapshot.inspirations.slice() };
  let operation = Promise.resolve();
  const active = () => isCurrent() === true;
  function serial(work) {
    const next = operation.catch(() => {}).then(work);
    operation = next.catch(() => {});
    return next;
  }
  function serialWrite(work) {
    const version = snapshot.version, generation = snapshot.generation;
    return serial(() => {
      if (!active()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
      if (snapshot.generation !== generation) return { ok: false, code: 'STALE_GENERATION' };
      if (snapshot.version !== version) return { ok: false, code: 'CONFLICT' };
      return work();
    });
  }
  async function pull() {
    if (!active()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    let response;
    try { response = await transport.send('snapshot.pull', {}); }
    catch (err) { return { ok: false, code: 'NETWORK' }; }
    if (!active()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    if (!response || !response.ok || !validSnapshot(response.data, cacheScope)) return { ok: false, code: response && response.code || 'PULL_FAILED' };
    snapshot = { generation: response.data.generation, version: response.data.version,
      syncedAt: now(), inspirations: response.data.inspirations.slice() };
    return { ok: true, synced: true };
  }
  async function send(action, payload, isConfirmed, applyConfirmed) {
    if (!active()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    const requestId = newRequestId();
    let response;
    try { response = await transport.send(action, Object.assign({}, payload, {
      generation: snapshot.generation, baseVersion: snapshot.version
    }), { requestId }); }
    catch (err) { response = { ok: false, code: 'NETWORK' }; }
    if (!active()) return { ok: false, code: 'ACCOUNT_SESSION_CHANGED' };
    if (!response || !response.ok || !response.data || !Number.isSafeInteger(response.data.version) ||
        response.data.version < snapshot.version || response.data.version > snapshot.version + 1) {
      // 超时或多次 CAS 的回执都需完整回读，不能只用新版本号升级旧内容。
      const code = response && response.code || 'NETWORK';
      const refreshed = await pull();
      if (refreshed.ok && isConfirmed(snapshot.inspirations)) return { ok: true, synced: true };
      // message 原样透传服务端的可展示说明；页面在「确认被拒绝」时用它给已知原因，
      // 结果未知（NETWORK/INTERNAL）时不能拿它编造原因。
      return { ok: false, code, message: response && typeof response.message === 'string' ? response.message : '' };
    }
    snapshot = { generation: snapshot.generation, version: response.data.version,
      syncedAt: now(), inspirations: applyConfirmed(snapshot.inspirations) };
    return { ok: true, synced: true };
  }
  function saveInspirations(items) {
    return serialWrite(async () => {
      if (!Array.isArray(items) || !items.length || items.length > 21 ||
          items.some((item) => !item || typeof item.id !== 'string' || item.deletedAt) ||
          new Set(items.map((item) => item.id)).size !== items.length) return { ok: false, code: 'INVALID_PAYLOAD' };
      return send('snapshot.push', { upserts: items }, (rows) => items.every((item) => {
        const actual = rows.find((row) => row.id === item.id);
        return actual && sameRecord(actual, item);
      }), (rows) => {
        const byId = new Map(rows.map((item) => [item.id, item]));
        items.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
    });
  }
  function deleteInspiration(id) {
    return serialWrite(() => send('inspiration.delete', { inspirationId: id }, (rows) => !rows.some((item) => item.id === id),
      (rows) => rows.filter((item) => item.id !== id).map((item) => item.mergedInto === id ? Object.assign({}, item, { mergedInto: null }) : item)));
  }
  function deletePhoto(inspirationId, photoId) {
    return serialWrite(() => send('photo.delete', { inspirationId, photoId }, (rows) => {
      const item = rows.find((entry) => entry.id === inspirationId);
      return !item || !(item.photos || []).some((photo) => photo.id === photoId);
    }, (rows) => rows.map((item) => item.id === inspirationId ? Object.assign({}, item,
      { photos: (item.photos || []).filter((photo) => photo.id !== photoId) }) : item)));
  }
  return {
    readSnapshot: () => Object.assign({}, snapshot, { inspirations: snapshot.inspirations.slice() }),
    getConfirmedRevision: () => ({ baseVersion: snapshot.version, generation: snapshot.generation }),
    refresh: () => serial(pull),
    saveInspiration: (item) => saveInspirations([item]), saveInspirations,
    deleteInspiration, deletePhoto,
    listInspirations: () => snapshot.inspirations.filter((item) => !isDeleted(item) && !isMerged(item)).sort(byUpdatedAtDesc),
    getInspiration: (id) => snapshot.inspirations.find((item) => item.id === id) || null
  };
}

module.exports = { createCloudOnlyStore };
