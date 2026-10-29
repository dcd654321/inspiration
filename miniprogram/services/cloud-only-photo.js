'use strict';
const inspiration = require('../core/inspiration');
const { createId, LIMITS } = require('../core/limits');

function createCloudOnlyPhotoWorkflow({ cacheScope, store, prepare, upload, expectedFileId, removeRemote,
  isCurrent = () => true, newId = createId, now = Date.now }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope || '')) throw Error('INVALID_PHOTO_SCOPE');
  let busy = Promise.resolve();
  function serial(work) {
    const next = busy.catch(() => {}).then(work);
    busy = next.catch(() => {});
    return next;
  }
  function unavailable(item) {
    if (!item || item.deletedAt || item.mergedInto) return '这条灵感已变化，请返回后查看。';
    if (inspiration.isArchived(item)) return '这条灵感已归档，请取消归档后再添加照片。';
    if ((item.photos || []).length >= LIMITS.photosPerInspiration) return '每条灵感最多九张照片，请先删除不需要的照片。';
    return '';
  }
  async function discardUnlinked(fileId) {
    if (isCurrent()) await removeRemote(fileId).catch(() => {});
  }
  async function add(inspirationId, source) {
    if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
    let item = store.getInspiration(inspirationId);
    if (unavailable(item)) return { ok: false, message: unavailable(item) };
    const prepared = await prepare({ source, existingCount: (item.photos || []).length });
    if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
    if (!prepared.ok) return { ok: false, message: prepared.code === 'CANCELLED' ? '' : prepared.hint || '每条灵感最多九张照片，每张不超过 2MB。' };
    if (!prepared.accepted.length) return { ok: false, message: '没有可添加的照片，请重新选择，每张不超过 2MB。' };
    let failed = false, failureCode = '', errorCode;
    for (const candidate of prepared.accepted) {
      if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
      item = store.getInspiration(inspirationId);
      if (unavailable(item)) return { ok: false, message: unavailable(item) };
      const photoId = newId('pho');
      const expected = expectedFileId(inspirationId, photoId);
      let uploaded;
      try { uploaded = await upload({ accountKey: cacheScope, inspirationId, photoId, tempFilePath: candidate.tempFilePath }); }
      catch (err) { uploaded = null; }
      if (!uploaded || !uploaded.ok || uploaded.fileId !== expected) {
        failed = true;
        if (!failureCode) { failureCode = uploaded && uploaded.ok ? 'PHOTO_FILE_ID_MISMATCH' : 'UPLOAD_FAILED'; errorCode = uploaded && uploaded.errorCode; }
        continue;
      }
      if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
      // 上传期间文字可能发生变化，不能用上传前的旧记录覆盖当前内容。
      item = store.getInspiration(inspirationId);
      if (unavailable(item)) {
        await discardUnlinked(expected);
        return { ok: false, message: unavailable(item) };
      }
      let saved;
      try { saved = await store.saveInspiration(inspiration.appendPhoto(item, { id: photoId, fileId: expected, now: now() })); }
      catch (err) {
        const name = err && err.name;
        saved = { ok: false, code: name === 'ValidationError' ? 'PHOTO_VALIDATION_FAILED' : name === 'TypeError' ? 'PHOTO_LOCAL_TYPE_ERROR' : 'PHOTO_LOCAL_ERROR' };
      }
      if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
      if (!saved || !saved.ok || saved.synced !== true) {
        // 先查云端：写请求可能已成功，但回包丢失。只清理确实未关联的文件。
        let checked;
        try { checked = await store.refresh(); } catch (err) { checked = null; }
        if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
        if (!checked || !checked.ok) return { ok: false, message: '暂时无法确认照片是否添加，请联网后重新打开这条灵感查看，再选择缺少的照片。' };
        const current = store.getInspiration(inspirationId);
        if (!current || !(current.photos || []).some((photo) => photo.id === photoId && photo.fileId === expected)) {
          await discardUnlinked(expected);
          failed = true;
          if (!failureCode) {
            failureCode = 'PHOTO_ASSOCIATION_FAILED';
            errorCode = saved && typeof saved.code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(saved.code) ? saved.code : 'SAVE_UNCONFIRMED';
          }
        }
      }
    }
    const result = { ok: !failed, message: failed ? '有照片未添加成功，请重新选择未添加的照片。' : prepared.rejected.length ? '部分照片不符合要求，未添加。请重新选择，每张不超过 2MB。' : '' };
    if (failureCode) { result.code = failureCode; if (errorCode !== undefined) result.errorCode = errorCode; }
    return result;
  }
  return { add: (id, source) => serial(() => add(id, source)) };
}
module.exports = { createCloudOnlyPhotoWorkflow };
