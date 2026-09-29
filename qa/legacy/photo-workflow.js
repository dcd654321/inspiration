'use strict';
const core = require('../../miniprogram/core/inspiration');
const { createId } = require('../../miniprogram/core/limits');
const locks = new Map();
function createPhotoWorkflow({ storage, cacheScope, store, prepare, upload, expectedFileId, saveFile, removeLocal, removeRemote, newId = createId, now = Date.now, isCurrent = () => true }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope)) throw Error('INVALID_PHOTO_SCOPE');
  const key = 'linggan:v2:' + cacheScope + ':photo-drafts';
  function read() {
    const rows = storage.get(key);
    if (rows == null) return [];
    if (!Array.isArray(rows) || rows.some((x) => !x || typeof x.id !== 'string' || typeof x.localPath !== 'string' || typeof x.inspirationId !== 'string' || !['prepared', 'uploaded', 'discarding'].includes(x.state))) throw Error('照片暂存记录无法读取，请勿清理小程序数据。');
    return rows;
  }
  function put(entry) { const rows = read(); storage.set(key, rows.filter((x) => x.id !== entry.id).concat([entry])); }
  function drop(id) { storage.set(key, read().filter((x) => x.id !== id)); }
  function serial(work) {
    const previous = locks.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    locks.set(key, result);
    result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
    return result;
  }
  async function retryOne(id) {
    if (!isCurrent()) return { ok: false, message: '账户状态已变化，照片已保留，请返回后重试。' };
    let entry = read().find((x) => x.id === id);
    if (!entry) return { ok: true };
    if (entry.state === 'discarding') return discardOne(id);
    let item = store.getInspiration(entry.inspirationId);
    if (!item || item.deletedAt || item.mergedInto) return { ok: false, message: '来源已移除或收起，可恢复来源后重试，或放弃这张照片。' };
    if (store.getConflict()) return { ok: false, message: '请先处理备份冲突，再重试照片。' };
    if (entry.state !== 'uploaded') {
      entry = Object.assign({}, entry, { attempted: true }); put(entry);
      const result = await upload({ accountKey: cacheScope, inspirationId: entry.inspirationId, photoId: entry.id, tempFilePath: entry.localPath });
      if (!isCurrent()) return { ok: false, message: '账户状态已变化，照片已保留，请返回后重试。' };
      if (!result || !result.ok) return { ok: false, message: '照片上传未完成，已保留，可稍后重试。' };
      if (result.fileId !== entry.fileId) return { ok: false, message: '照片上传位置不一致，请联系维护者处理。' };
      entry = Object.assign({}, entry, { fileId: result.fileId, state: 'uploaded' });
      put(entry); // 如失败，固定对象名使下次上传仍写同一对象。
    }
    item = store.getInspiration(entry.inspirationId);
    if (!item || item.deletedAt || item.mergedInto) return { ok: false, message: '来源发生变化，照片已保留，请稍后处理。' };
    const exists = (item.photos || []).find((photo) => photo.id === id);
    let result;
    if (exists) {
      if (exists.fileId !== entry.fileId) return { ok: false, message: '照片记录不一致，请勿清理小程序数据。' };
      result = await store.retryPending();
    } else {
      result = await store.saveInspiration(core.appendPhoto(item, { id, fileId: entry.fileId, now: now() }));
    }
    if (!result.ok || store.getBackupStatus().pendingCount > 0 || store.getConflict()) return { ok: false, message: '照片已保留，备份尚未完成，可稍后重试。' };
    // 先移除本机副本，再移除任务；本机文件不存在也按已清理处理。
    await removeLocal(entry.localPath); drop(id);
    return { ok: true };
  }
  async function discardOne(id) {
    if (!isCurrent()) return { ok: false, message: '请重新确认账户后处理照片。' };
    const entry = read().find((x) => x.id === id);
    if (!entry) return { ok: true };
    const item = store.getInspiration(entry.inspirationId);
    if (store.getConflict()) return { ok: false, message: '请先处理备份冲突，照片暂时保留。' };
    if (item && (item.photos || []).some((x) => x.id === id)) return { ok: false, message: '照片已加入灵感，请通过照片下方的删除按钮移除。' };
    const discarding = Object.assign({}, entry, { state: 'discarding' }); put(discarding);
    if (entry.attempted) await removeRemote(entry.fileId);
    if (!isCurrent()) return { ok: false, message: '请重新确认账户后继续清理照片。' };
    await removeLocal(entry.localPath); drop(id);
    return { ok: true };
  }
  return {
    list: (inspirationId) => read().filter((x) => !inspirationId || x.inspirationId === inspirationId),
    retry: (id) => serial(() => retryOne(id)),
    discard: (id) => serial(() => discardOne(id)),
    add: (inspirationId, source) => serial(async () => {
      if (!isCurrent()) return { ok: false, message: '请重新确认账户后添加照片。' };
      const item = store.getInspiration(inspirationId);
      if (!item || item.deletedAt || item.mergedInto || store.getConflict()) return { ok: false, message: '请先确认灵感与备份状态。' };
      const ids = new Set((item.photos || []).map((x) => x.id).concat(read().filter((x) => x.inspirationId === inspirationId).map((x) => x.id)));
      const prepared = await prepare({ source, existingCount: ids.size });
      if (!prepared.ok) return { ok: false, message: prepared.code === 'CANCELLED' ? '' : prepared.hint || '每条灵感最多九张照片，每张不超过 2MB。' };
      const added = [];
      for (const photo of prepared.accepted) {
        const localPath = await saveFile(photo.tempFilePath);
        const id = newId('pho');
        const entry = { id, inspirationId, localPath, fileId: expectedFileId(inspirationId, id), attempted: false, state: 'prepared' };
        try { put(entry); } catch (err) { await removeLocal(localPath).catch(() => {}); throw err; }
        added.push(entry.id);
      }
      let failed = false;
      for (const id of added) { try { if (!(await retryOne(id)).ok) failed = true; } catch (err) { failed = true; } }
      return { ok: !failed, message: failed ? '部分照片尚未完成，已保留，可逐张重试。' : prepared.rejected.length ? '部分照片压缩后仍超过 2MB，未添加；其余已处理。' : '' };
    })
  };
}
module.exports = { createPhotoWorkflow };
