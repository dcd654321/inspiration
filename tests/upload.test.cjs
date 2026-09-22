'use strict';
// 照片上传与云存储清理的单元测试。
// 对应 photo-capture/spec.md 的「上传失败可重试」「图片与灵感同生命周期」两节，
// 以及 tasks.md 4.3、4.4。

const test = require('node:test');
const assert = require('node:assert');

const { createUploader, photoCloudPath, PHOTO_PREFIX, CODE } = require('../miniprogram/services/upload');

const ACCOUNT = 'acct_abc';
const INSPIRATION = 'insp_lz9k_4f2a';
const PHOTO = 'pho_1';

/** 假的云存储：记录每次上传的路径，可以指定失败次数。 */
function createFakeStorage() {
  return {
    objects: new Map(),
    calls: [],
    failTimes: 0,
    removeFailFor: [],

    async uploadFile({ filePath, cloudPath }) {
      this.calls.push({ filePath, cloudPath });
      if (this.failTimes > 0) {
        this.failTimes -= 1;
        throw new Error('网络中断');
      }
      // 覆盖写：同一路径重复上传只留一个对象
      this.objects.set(cloudPath, filePath);
      return { fileID: 'cloud://' + cloudPath };
    },

    async removeFile(fileID) {
      const path = fileID.replace('cloud://', '');
      if (this.removeFailFor.indexOf(fileID) !== -1) throw new Error('删除失败');
      this.objects.delete(path);
    }
  };
}

function uploader(fake) {
  return createUploader({
    uploadFile: (input) => fake.uploadFile(input),
    removeFile: (fileID) => fake.removeFile(fileID)
  });
}

// ---------------------------------------------------------------- 路径

test('云存储路径按约定拼接，带 linggan/ 前缀与 accountKey', () => {
  assert.strictEqual(
    photoCloudPath(ACCOUNT, INSPIRATION, PHOTO),
    PHOTO_PREFIX + ACCOUNT + '/' + INSPIRATION + '/' + PHOTO
  );
});

test('路径片段含越权字符时抛错，不给出一条「差不多」的路径', () => {
  const unsafe = ['../evil', 'a/b', 'a\\b', 'a b', 'a.b', '', 'a'.repeat(65), null, undefined];

  for (const bad of unsafe) {
    assert.throws(
      () => photoCloudPath(ACCOUNT, bad, PHOTO),
      (err) => err.code === CODE.invalidSegment,
      `accountKey 为 ${JSON.stringify(bad)} 时应拒绝`
    );
    assert.throws(() => photoCloudPath(bad, INSPIRATION, PHOTO), (err) => err.code === CODE.invalidSegment);
    assert.throws(() => photoCloudPath(ACCOUNT, INSPIRATION, bad), (err) => err.code === CODE.invalidSegment);
  }
});

// ---------------------------------------------------------------- 上传

test('上传成功返回 fileId', async () => {
  const fake = createFakeStorage();
  const result = await uploader(fake).uploadPhoto({
    accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a'
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fileId, 'cloud://' + photoCloudPath(ACCOUNT, INSPIRATION, PHOTO));
});

test('同一 photoId 重传覆盖同一对象，云端只留一个', async () => {
  const fake = createFakeStorage();
  const up = uploader(fake);
  const args = { accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a' };

  await up.uploadPhoto(args);
  await up.uploadPhoto(Object.assign({}, args, { tempFilePath: 'tmp://a' }));
  await up.uploadPhoto(Object.assign({}, args, { tempFilePath: 'tmp://a' }));

  assert.strictEqual(fake.calls.length, 3, '三次都该真的发出去——幂等靠覆盖，不靠本地跳过');
  assert.strictEqual(fake.objects.size, 1, '重复上传产生了重复对象');
});

test('上传失败返回失败，调用方据此保留本地文件', async () => {
  const fake = createFakeStorage();
  fake.failTimes = 1;
  const result = await uploader(fake).uploadPhoto({
    accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a'
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.uploadFailed);
  assert.strictEqual(fake.objects.size, 0);
});

test('上传失败后重试能成功', async () => {
  const fake = createFakeStorage();
  fake.failTimes = 1;
  const up = uploader(fake);
  const args = { accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a' };

  assert.strictEqual((await up.uploadPhoto(args)).ok, false);
  assert.strictEqual((await up.uploadPhoto(args)).ok, true);
  assert.strictEqual(fake.objects.size, 1);
});

test('上传返回残缺结果按失败处理', async () => {
  const broken = createUploader({ uploadFile: async () => ({}) });
  const result = await broken.uploadPhoto({
    accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a'
  });

  assert.strictEqual(result.ok, false);
});

test('路径不合法时直接失败，不去调用云存储', async () => {
  const fake = createFakeStorage();
  const result = await uploader(fake).uploadPhoto({
    accountKey: '../evil', inspirationId: INSPIRATION, photoId: PHOTO, tempFilePath: 'tmp://a'
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.invalidSegment);
  assert.strictEqual(fake.calls.length, 0);
});

test('缺 tempFilePath 时直接失败', async () => {
  const fake = createFakeStorage();
  const result = await uploader(fake).uploadPhoto({
    accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: PHOTO
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(fake.calls.length, 0);
});

// ---------------------------------------------------------------- 删除联动

test('删除灵感时清理全部云存储文件', async () => {
  const fake = createFakeStorage();
  const up = uploader(fake);
  const fileIds = [];
  for (const id of ['pho_1', 'pho_2', 'pho_3']) {
    const r = await up.uploadPhoto({
      accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: id, tempFilePath: 'tmp://' + id
    });
    fileIds.push(r.fileId);
  }
  assert.strictEqual(fake.objects.size, 3);

  const result = await up.removePhotos(fileIds);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.removed.length, 3);
  assert.strictEqual(fake.objects.size, 0);
});

test('部分删除失败时逐个报告，不压成一个布尔值', async () => {
  const fake = createFakeStorage();
  const up = uploader(fake);
  const ids = ['pho_1', 'pho_2', 'pho_3'];
  const fileIds = [];
  for (const id of ids) {
    const r = await up.uploadPhoto({
      accountKey: ACCOUNT, inspirationId: INSPIRATION, photoId: id, tempFilePath: 'tmp://' + id
    });
    fileIds.push(r.fileId);
  }

  // 让其中一个删不掉
  fake.removeFailFor = [fileIds[1]];
  const result = await up.removePhotos(fileIds);

  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.removed, [fileIds[0], fileIds[2]]);
  assert.deepStrictEqual(result.failed, [fileIds[1]], '要知道具体哪个没删掉，才能决定哪些记录不能删');
  assert.strictEqual(fake.objects.size, 1);
});

test('删除空列表是空操作，不算失败', async () => {
  const fake = createFakeStorage();
  const result = await uploader(fake).removePhotos([]);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.removed, []);
});

test('没有提供 removeFile 时明确失败，不假装删过', async () => {
  const noRemove = createUploader({ uploadFile: async () => ({ fileID: 'x' }) });
  const result = await noRemove.removePhotos(['cloud://a']);

  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.failed, ['cloud://a']);
});
