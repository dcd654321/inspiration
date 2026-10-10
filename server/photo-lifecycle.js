'use strict';
const fail = (code) => ({ ok: false, code });
function createPhotoValidator(prefix) {
  if (typeof prefix !== 'string' || !/^cloud:\/\/[A-Za-z0-9_.-]+\/$/.test(prefix)) return () => false;
  return (accountKey, inspirationId, photo) => Boolean(photo && /^[A-Za-z0-9_]{1,64}$/.test(photo.id) &&
    photo.fileId === prefix + 'linggan/' + accountKey + '/' + inspirationId + '/' + photo.id);
}
function createPhotoLifecycle({ db, now, removeFiles, validatePhoto, beforeRemove }) {
  async function remove(accountKey, data, photoId) {
    let doc = await db.get(accountKey);
    if (!doc || data.generation !== doc.generation) return fail('STALE_GENERATION');
    const taskId = data.inspirationId + ':' + (photoId ? 'photo:' + photoId : 'all');
    let task = (doc.photoCleanup || []).find((x) => x.id === taskId);
    const target = doc.inspirations.find((x) => x.id === data.inspirationId);
    if (!target) {
      if (data.baseVersion !== doc.version) return fail('CONFLICT');
      return { ok: true, data: { version: doc.version, alreadyAbsent: true, deletedPhotos: 0 } };
    }
    if (!task) {
      if (data.baseVersion !== doc.version) return fail('CONFLICT');
      if ((doc.photoCleanup || []).some((x) => x.inspirationId === target.id)) return fail('PHOTO_CLEANUP_PENDING');
      const photos = photoId ? (target.photos || []).filter((x) => x.id === photoId) : target.photos || [];
      if (!photos.length && photoId) return { ok: true, data: { version: doc.version, alreadyAbsent: true } };
      if (photos.some((x) => !validatePhoto(accountKey, target.id, x))) return fail('PHOTO_PATH_INVALID');
      if (!photoId && typeof beforeRemove === 'function') await beforeRemove(accountKey, target.id);
      task = { id: taskId, inspirationId: target.id, photoId: photoId || null, fileIds: photos.map((x) => x.fileId), removedIds: [], requestedAt: now() };
      const next = Object.assign({}, doc, { version: doc.version + 1, updatedAt: now(), photoCleanup: (doc.photoCleanup || []).concat([task]) });
      if (!await db.compareAndSwap(accountKey, doc.version, next)) return fail('CONFLICT');
      doc = next;
    }
    // 登记后只允许重试该任务，不依赖删除前版本；文件删除是幂等动作，不能物理回滚。
    let result;
    try { result = await removeFiles(task.fileIds.filter((id) => !(task.removedIds || []).includes(id))); } catch (err) { return fail('PHOTO_CLEANUP_PENDING'); }
    if (!result || !Array.isArray(result.removed)) return fail('PHOTO_CLEANUP_PENDING');
    for (let attempt = 0; attempt < 3; attempt++) {
      doc = await db.get(accountKey);
      if (!doc || doc.generation !== data.generation) return fail('STALE_GENERATION');
      if (!(doc.photoCleanup || []).some((x) => x.id === taskId)) return { ok: true, data: { version: doc.version, deletedPhotos: task.fileIds.length } };
      const current = doc.photoCleanup.find((x) => x.id === taskId);
      const removedIds = Array.from(new Set((current.removedIds || []).concat(result.removed.filter((id) => task.fileIds.includes(id)))));
      if (task.fileIds.some((id) => !removedIds.includes(id))) {
        const next = Object.assign({}, doc, { version: doc.version + 1, updatedAt: now(), photoCleanup: doc.photoCleanup.map((x) => x.id === taskId ? Object.assign({}, x, { removedIds }) : x) });
        if (await db.compareAndSwap(accountKey, doc.version, next)) return fail('PHOTO_CLEANUP_PENDING');
        continue;
      }
      const inspirations = photoId
        ? doc.inspirations.map((item) => item.id === task.inspirationId ? Object.assign({}, item, { photos: (item.photos || []).filter((p) => p.id !== photoId) }) : item)
        : doc.inspirations.filter((x) => x.id !== task.inspirationId).map((item) => item.mergedInto === task.inspirationId ? Object.assign({}, item, { mergedInto: null }) : item);
      const next = Object.assign({}, doc, { inspirations, photoCleanup: doc.photoCleanup.filter((x) => x.id !== taskId), version: doc.version + 1, updatedAt: now() });
      if (await db.compareAndSwap(accountKey, doc.version, next)) return { ok: true, data: { version: next.version, deletedPhotos: task.fileIds.length } };
    }
    return fail('PHOTO_CLEANUP_PENDING');
  }
  return { remove };
}
module.exports = { createPhotoLifecycle, createPhotoValidator };
