'use strict';
// 照片本地环节的单元测试。
// 对应 openspec/changes/add-inspiration-mvp/specs/photo-capture/spec.md
// 的「拍照与相册选图」「图片压缩与限制」两节，以及 tasks.md 4.1、4.2。

const test = require('node:test');
const assert = require('node:assert');

const { createPhotoService, CODE } = require('../miniprogram/services/photo');
const { LIMITS } = require('../miniprogram/core/limits');

const MAX = LIMITS.photoMaxBytes;

/** 假 wx：可以按需让权限被拒、让选择被取消、让压缩失败。 */
function createFakeWx(options) {
  const opts = options || {};
  return {
    compressCalls: [],
    chooseCalls: [],

    async ensurePermission(source) {
      return opts.granted === undefined ? true : opts.granted;
    },

    async chooseMedia(source, count) {
      this.chooseCalls.push({ source, count });
      if (opts.chooseThrows) throw new Error('用户取消');
      return opts.picked || [];
    },

    async compressImage(tempFilePath) {
      this.compressCalls.push(tempFilePath);
      if (opts.compressThrows) throw new Error('压缩失败');
      const size = opts.compressedSize === undefined ? MAX - 1 : opts.compressedSize;
      return { tempFilePath: tempFilePath + '.min', size };
    }
  };
}

function service(fake) {
  return createPhotoService({
    ensurePermission: (source) => fake.ensurePermission(source),
    chooseMedia: (source, count) => fake.chooseMedia(source, count),
    compressImage: (path) => fake.compressImage(path)
  });
}

function photo(size, name) {
  return { tempFilePath: name || 'tmp://a', size };
}

// ---------------------------------------------------------------- 权限

test('权限被拒时不读取任何图片，并给出开启指引', async () => {
  const fake = createFakeWx({ granted: false, picked: [photo(1000)] });
  const result = await service(fake).prepare({ source: 'camera', existingCount: 0 });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.permissionDenied);
  assert.ok(result.hint && result.hint.length > 0, '拒绝权限时必须说明开启方式');
  assert.strictEqual(fake.chooseCalls.length, 0, '权限被拒却仍然读了图片');
});

test('相机与相册的指引文案不同', async () => {
  const camera = await service(createFakeWx({ granted: false })).prepare({ source: 'camera', existingCount: 0 });
  const album = await service(createFakeWx({ granted: false })).prepare({ source: 'album', existingCount: 0 });

  assert.notStrictEqual(camera.hint, album.hint);
  assert.ok(camera.hint.indexOf('相机') !== -1);
  assert.ok(album.hint.indexOf('相册') !== -1);
});

test('无论成败都返回上限，界面才能说出「上限是多少」', async () => {
  const denied = await service(createFakeWx({ granted: false })).prepare({ source: 'album', existingCount: 0 });
  assert.strictEqual(denied.limit.maxBytes, MAX);
  assert.strictEqual(denied.limit.maxCount, LIMITS.photosPerInspiration);
});

// ---------------------------------------------------------------- 正常路径

test('相册多选：全部收下并按选择顺序返回', async () => {
  const fake = createFakeWx({
    picked: [photo(1000, 'tmp://a'), photo(2000, 'tmp://b'), photo(3000, 'tmp://c')]
  });
  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.accepted.map((p) => p.tempFilePath), ['tmp://a', 'tmp://b', 'tmp://c']);
  assert.deepStrictEqual(result.rejected, []);
});

test('没超限的图片不做压缩——压了白压', async () => {
  const fake = createFakeWx({ picked: [photo(1000)] });
  await service(fake).prepare({ source: 'camera', existingCount: 0 });

  assert.strictEqual(fake.compressCalls.length, 0);
});

test('用户取消选择时不报错，返回取消状态', async () => {
  const fake = createFakeWx({ chooseThrows: true });
  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.cancelled);
});

// ---------------------------------------------------------------- 单张上限

test('原图超限则压缩，压缩后合格就收下', async () => {
  const fake = createFakeWx({ picked: [photo(MAX * 3)], compressedSize: MAX - 1 });
  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.accepted[0].size, MAX - 1);
  assert.strictEqual(result.accepted[0].tempFilePath, 'tmp://a.min');
});

test('压缩后仍超限：拒绝该张，其余不受影响', async () => {
  const fake = createFakeWx({
    picked: [photo(MAX * 3, 'tmp://big'), photo(1000, 'tmp://ok')],
    compressedSize: MAX * 2
  });
  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.accepted.map((p) => p.tempFilePath), ['tmp://ok'], '其余图片不该受影响');
  assert.strictEqual(result.rejected.length, 1);
  assert.strictEqual(result.rejected[0].tempFilePath, 'tmp://big');
  assert.strictEqual(result.rejected[0].size, MAX * 2, '要把实际大小报出来，界面才能说明原因');
});

test('压缩失败时按原图尺寸判定，不整批失败', async () => {
  const fake = createFakeWx({ picked: [photo(MAX * 3, 'tmp://big')], compressThrows: true });
  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.accepted.length, 0);
  assert.strictEqual(result.rejected.length, 1);
  assert.strictEqual(result.rejected[0].size, MAX * 3);
});

test('压缩返回残缺结果时按原图尺寸判定', async () => {
  const fake = createFakeWx({ picked: [photo(MAX * 3)] });
  fake.compressImage = async () => ({ tempFilePath: 'tmp://half' });   // 没有 size

  const result = await service(fake).prepare({ source: 'album', existingCount: 0 });

  assert.strictEqual(result.accepted.length, 0);
  assert.strictEqual(result.rejected.length, 1);
});

// ---------------------------------------------------------------- 数量上限

test('已达数量上限时在读图之前就拦住', async () => {
  const fake = createFakeWx({ picked: [photo(1000)] });
  const result = await service(fake).prepare({ source: 'album', existingCount: LIMITS.photosPerInspiration });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.limitExceeded);
  assert.strictEqual(fake.chooseCalls.length, 0, '已到上限却仍然读了图片——白让用户授权一次');
});

test('选多了按剩余额度收，多出来的静默丢弃', async () => {
  const fake = createFakeWx({
    picked: [photo(1000, 'tmp://1'), photo(1000, 'tmp://2'), photo(1000, 'tmp://3'), photo(1000, 'tmp://4')]
  });
  const result = await service(fake).prepare({ source: 'album', existingCount: LIMITS.photosPerInspiration - 2 });

  assert.strictEqual(result.accepted.length, 2, '只剩两个额度，不该收四个');
  assert.strictEqual(result.rejected.length, 0, '超出额度的不算「被拒绝的图片」，不该报错');
});

test('恰好差一张时只收一张', async () => {
  const fake = createFakeWx({ picked: [photo(1000, 'tmp://1'), photo(1000, 'tmp://2')] });
  const result = await service(fake).prepare({ source: 'camera', existingCount: LIMITS.photosPerInspiration - 1 });

  assert.strictEqual(result.accepted.length, 1);
});

// ---------------------------------------------------------------- 入参守卫

test('未知来源直接失败，不去申请权限', async () => {
  const fake = createFakeWx({ picked: [photo(1000)] });
  const result = await service(fake).prepare({ source: 'screenshot', existingCount: 0 });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CODE.failed);
  assert.strictEqual(fake.chooseCalls.length, 0);
});

test('缺参数不抛错', async () => {
  const fake = createFakeWx();
  const result = await service(fake).prepare();

  assert.strictEqual(result.ok, false);
});
