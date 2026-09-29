'use strict';
const inspiration = require('../core/inspiration');
const { createId } = require('../core/limits');

function createCloudOnlyPhotoWorkflow({ cacheScope, store, prepare, upload, expectedFileId, removeRemote,
  isCurrent = () => true, newId = createId, now = Date.now }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope || '')) throw Error('INVALID_PHOTO_SCOPE');
  let busy = Promise.resolve();
  function serial(work) {
    const next = busy.catch(() => {}).then(work);
    busy = next.catch(() => {});
    return next;
  }
  async function add(inspirationId, source) {
    if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
    let item = store.getInspiration(inspirationId);
    if (!item || item.deletedAt || item.mergedInto) return { ok: false, message: '请先确认这条灵感仍然存在。' };
    const prepared = await prepare({ source, existingCount: (item.photos || []).length });
    if (!prepared.ok) return { ok: false, message: prepared.code === 'CANCELLED' ? '' : prepared.hint || '每条灵感最多九张照片，每张不超过 2MB。' };
    let failed = false;
    for (const candidate of prepared.accepted) {
      if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
      item = store.getInspiration(inspirationId);
      if (!item || item.deletedAt || item.mergedInto) return { ok: false, message: '这条灵感已变化，请返回后查看。' };
      const photoId = newId('pho');
      const expected = expectedFileId(inspirationId, photoId);
      let uploaded;
      try { uploaded = await upload({ accountKey: cacheScope, inspirationId, photoId, tempFilePath: candidate.tempFilePath }); }
      catch (err) { uploaded = null; }
      if (!uploaded || !uploaded.ok || uploaded.fileId !== expected) { failed = true; continue; }
      if (!isCurrent()) { await removeRemote(expected).catch(() => {}); return { ok: false, message: '账户状态已变化，请返回后重试。' }; }
      // 上传期间文字可能发生变化，不能用上传前的旧记录覆盖当前内容。
      item = store.getInspiration(inspirationId);
      if (!item || item.deletedAt || item.mergedInto) {
        await removeRemote(expected).catch(() => {});
        return { ok: false, message: '这条灵感已变化，照片未添加，请返回后查看。' };
      }
      let saved;
      try { saved = await store.saveInspiration(inspiration.appendPhoto(item, { id: photoId, fileId: expected, now: now() })); }
      catch (err) { saved = null; }
      if (!saved || !saved.ok || saved.synced !== true) {
        // 先查云端：写请求可能已成功，但回包丢失。只清理确实未关联的文件。
        let checked;
        try { checked = await store.refresh(); } catch (err) { checked = null; }
        if (!isCurrent()) return { ok: false, message: '账户状态已变化，请返回后重试。' };
        if (!checked || !checked.ok) return { ok: false, message: '暂时无法确认照片是否添加，请联网后重新打开这条灵感查看，再选择缺少的照片。' };
        const current = store.getInspiration(inspirationId);
        if (!current || !(current.photos || []).some((photo) => photo.id === photoId && photo.fileId === expected)) {
          await removeRemote(expected).catch(() => {});
          failed = true;
        }
      }
    }
    return { ok: !failed, message: failed ? '有照片未添加成功，请重新选择未添加的照片。' : prepared.rejected.length ? '部分照片不符合要求，未添加。请重新选择，每张不超过 2MB。' : '' };
  }
  return { add: (id, source) => serial(() => add(id, source)) };
}
module.exports = { createCloudOnlyPhotoWorkflow };
