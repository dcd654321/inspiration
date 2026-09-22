'use strict';
// 灵感领域模型的单元测试。
// 用例直接对应 openspec/changes/add-inspiration-mvp/specs/inspiration-capture/spec.md
// 与 photo-capture/spec.md 中的 scenario，命名保持可追溯。

const test = require('node:test');
const assert = require('node:assert');

const {
  createInspiration,
  validateInspiration,
  appendSupplement,
  appendPhoto,
  markDeleted,
  isDeleted,
  byUpdatedAtDesc
} = require('../miniprogram/core/inspiration');
const { LIMITS } = require('../miniprogram/core/limits');
const { ERROR_CODES, ValidationError } = require('../miniprogram/core/errors');

const NOW = 1758500000000;
const base = () => ({ text: '做一个记账小程序', id: 'insp_lz9k_4f2a', now: NOW });

function hasCode(code) {
  return (err) => err instanceof ValidationError && err.code === code;
}

// ---------------------------------------------------------------- 记录与校验

test('只输入正文即可创建，其余字段有确定初值', () => {
  const insp = createInspiration(base());

  assert.strictEqual(insp.text, '做一个记账小程序');
  assert.strictEqual(insp.id, 'insp_lz9k_4f2a');
  assert.strictEqual(insp.createdAt, NOW);
  assert.strictEqual(insp.updatedAt, NOW);
  assert.deepStrictEqual(insp.supplements, []);
  assert.deepStrictEqual(insp.photos, []);
  assert.strictEqual(insp.deletedAt, null);
});

test('空内容不产生记录，纯空白同样视为空', () => {
  assert.throws(() => createInspiration(Object.assign(base(), { text: '' })), hasCode(ERROR_CODES.EMPTY_TEXT));
  assert.throws(() => createInspiration(Object.assign(base(), { text: '   ' })), hasCode(ERROR_CODES.EMPTY_TEXT));
  assert.throws(() => createInspiration(Object.assign(base(), { text: '\n\t  ' })), hasCode(ERROR_CODES.EMPTY_TEXT));
});

test('正文超出上限被拒绝，且不静默截断', () => {
  const tooLong = '啊'.repeat(LIMITS.textMaxLength + 1);
  assert.throws(
    () => createInspiration(Object.assign(base(), { text: tooLong })),
    hasCode(ERROR_CODES.TEXT_TOO_LONG)
  );

  // 正好等于上限必须通过——边界不能提前一格。
  const atLimit = '啊'.repeat(LIMITS.textMaxLength);
  assert.strictEqual(createInspiration(Object.assign(base(), { text: atLimit })).text.length, LIMITS.textMaxLength);
});

test('缺少 id 被拒绝', () => {
  assert.throws(() => createInspiration({ text: '随手一记', now: NOW }), hasCode(ERROR_CODES.MISSING_FIELD));
  assert.throws(() => createInspiration({ text: '随手一记', id: '', now: NOW }), hasCode(ERROR_CODES.MISSING_FIELD));
});

test('标识含路径字符被拒绝——标识会参与云存储路径拼接', () => {
  const unsafe = ['../evil', 'a/b', 'a\\b', 'a b', 'a.b', 'a:b', 'a'.repeat(LIMITS.idMaxLength + 1)];
  for (const id of unsafe) {
    assert.throws(
      () => createInspiration(Object.assign(base(), { id })),
      hasCode(ERROR_CODES.INVALID_ID),
      `标识 ${JSON.stringify(id)} 应当被拒绝`
    );
  }
});

test('时间戳必须由调用方注入且合法', () => {
  assert.throws(() => createInspiration({ text: '随手一记', id: 'insp_1' }), hasCode(ERROR_CODES.MISSING_FIELD));
  assert.throws(() => createInspiration(Object.assign(base(), { now: 'now' })), hasCode(ERROR_CODES.INVALID_NOW));
  assert.throws(() => createInspiration(Object.assign(base(), { now: NaN })), hasCode(ERROR_CODES.INVALID_NOW));
});

test('不抛错版逐字段返回错误，供页面做即时提示', () => {
  const result = validateInspiration({ text: '', id: 'bad id', now: 'x' });

  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(
    result.errors.map((e) => e.field).sort(),
    ['id', 'now', 'text']
  );
});

// ---------------------------------------------------------------- 不可变性

test('创建结果被冻结，运行时改不动', () => {
  const insp = createInspiration(base());

  assert.ok(Object.isFrozen(insp), '外层未冻结');
  assert.ok(Object.isFrozen(insp.supplements), '补充数组未冻结，仍可 push');
  assert.ok(Object.isFrozen(insp.photos), '图片数组未冻结');
  assert.throws(() => { insp.text = '改写'; }, TypeError);
});

test('不导出任何可改写原始正文的路径', () => {
  const inspiration = require('../miniprogram/core/inspiration');
  const mutators = ['setText', 'updateText', 'editText', 'replaceText', 'withText', 'overwriteText'];

  for (const name of mutators) {
    assert.strictEqual(typeof inspiration[name], 'undefined', `不应导出 ${name}`);
  }
});

test('追加补充后原始正文与初始值全等，原对象不被修改', () => {
  const before = createInspiration(base());
  const after = appendSupplement(before, { content: '加上导出 CSV', id: 'sup_1', now: NOW + 1000 });

  assert.strictEqual(after.text, before.text);
  assert.strictEqual(after.text, '做一个记账小程序');
  assert.notStrictEqual(after, before, '应返回新对象');
  assert.strictEqual(before.supplements.length, 0, '入参被就地修改了');
  assert.strictEqual(after.supplements.length, 1);
  assert.strictEqual(after.updatedAt, NOW + 1000);
  assert.strictEqual(before.updatedAt, NOW, '入参的 updatedAt 被改了');
});

test('多次补充按时间顺序完整保留', () => {
  let insp = createInspiration(base());
  insp = appendSupplement(insp, { content: '第一条', id: 'sup_1', now: NOW + 1000 });
  insp = appendSupplement(insp, { content: '第二条', id: 'sup_2', now: NOW + 2000 });
  insp = appendSupplement(insp, { content: '第三条', id: 'sup_3', now: NOW + 3000 });

  assert.deepStrictEqual(insp.supplements.map((s) => s.content), ['第一条', '第二条', '第三条']);
  assert.deepStrictEqual(insp.supplements.map((s) => s.createdAt), [NOW + 1000, NOW + 2000, NOW + 3000]);
  assert.strictEqual(insp.text, '做一个记账小程序');
});

test('空补充不写入，也不改变更新时间', () => {
  const insp = createInspiration(base());

  assert.throws(
    () => appendSupplement(insp, { content: '   ', id: 'sup_1', now: NOW + 5000 }),
    hasCode(ERROR_CODES.EMPTY_SUPPLEMENT)
  );
  assert.strictEqual(insp.updatedAt, NOW);
  assert.strictEqual(insp.supplements.length, 0);
});

test('补充超长被拒绝，用的是补充自己的错误码', () => {
  const insp = createInspiration(base());
  const tooLong = '啊'.repeat(LIMITS.supplementMaxLength + 1);

  assert.throws(
    () => appendSupplement(insp, { content: tooLong, id: 'sup_1', now: NOW }),
    hasCode(ERROR_CODES.SUPPLEMENT_TOO_LONG)
  );
});

test('补充来源只接受 user 与 ai', () => {
  const insp = createInspiration(base());

  assert.strictEqual(
    appendSupplement(insp, { content: '人写的', id: 'sup_1', now: NOW }).supplements[0].source,
    'user'
  );
  assert.strictEqual(
    appendSupplement(insp, { content: 'AI 写的', id: 'sup_2', source: 'ai', now: NOW }).supplements[0].source,
    'ai'
  );
  assert.throws(
    () => appendSupplement(insp, { content: '来路不明', id: 'sup_3', source: 'robot', now: NOW }),
    hasCode(ERROR_CODES.INVALID_SOURCE)
  );
});

// ---------------------------------------------------------------- 图片

test('追加图片后正文不变，图片按追加顺序排列', () => {
  let insp = createInspiration(base());
  insp = appendPhoto(insp, { id: 'pho_1', fileId: 'cloud://a', now: NOW + 1 });
  insp = appendPhoto(insp, { id: 'pho_2', fileId: 'cloud://b', now: NOW + 2 });

  assert.strictEqual(insp.text, '做一个记账小程序');
  assert.deepStrictEqual(insp.photos.map((p) => p.id), ['pho_1', 'pho_2']);
});

test('图片数量达到上限后阻止继续添加', () => {
  let insp = createInspiration(base());
  for (let i = 0; i < LIMITS.photosPerInspiration; i += 1) {
    insp = appendPhoto(insp, { id: 'pho_' + i, fileId: 'cloud://' + i, now: NOW + i });
  }
  assert.strictEqual(insp.photos.length, LIMITS.photosPerInspiration);

  assert.throws(
    () => appendPhoto(insp, { id: 'pho_extra', fileId: 'cloud://x', now: NOW + 99 }),
    hasCode(ERROR_CODES.LIMIT_EXCEEDED)
  );
  assert.strictEqual(insp.photos.length, LIMITS.photosPerInspiration);
});

test('同一图片重复追加按覆盖处理，不产生重复记录', () => {
  let insp = createInspiration(base());
  insp = appendPhoto(insp, { id: 'pho_same', fileId: 'cloud://a', now: NOW + 1 });
  const afterRetry = appendPhoto(insp, { id: 'pho_same', fileId: 'cloud://a', now: NOW + 2 });

  assert.strictEqual(afterRetry.photos.length, 1, '重试产生了重复图片记录');
  assert.deepStrictEqual(afterRetry.photos[0], { id: 'pho_same', fileId: 'cloud://a', createdAt: NOW + 1 });
  assert.strictEqual(afterRetry.updatedAt, NOW + 1, '重试不应改变更新时间');
});

test('图片缺少有效 fileId 被拒绝', () => {
  const insp = createInspiration(base());

  assert.throws(() => appendPhoto(insp, { id: 'pho_1', now: NOW }), hasCode(ERROR_CODES.MISSING_FIELD));
  assert.throws(() => appendPhoto(insp, { id: 'pho_1', fileId: '  ', now: NOW }), hasCode(ERROR_CODES.INVALID_FILE_ID));
  assert.throws(() => appendPhoto(insp, { id: 'pho_1', fileId: 123, now: NOW }), hasCode(ERROR_CODES.INVALID_FILE_ID));
});

// ---------------------------------------------------------------- 删除与排序

test('删除只打标记，不改更新时间', () => {
  const insp = createInspiration(base());
  const deleted = markDeleted(insp, { now: NOW + 9000 });

  assert.strictEqual(deleted.deletedAt, NOW + 9000);
  assert.strictEqual(deleted.updatedAt, NOW, '删除不是编辑，不应让条目重新排序');
  assert.strictEqual(isDeleted(deleted), true);
  assert.strictEqual(isDeleted(insp), false, '入参被就地修改了');
  assert.strictEqual(insp.text, '做一个记账小程序');
});

test('列表按更新时间倒序，最近有补充的排在前面', () => {
  const a = createInspiration({ text: '甲', id: 'insp_a', now: NOW });
  const b = createInspiration({ text: '乙', id: 'insp_b', now: NOW + 1000 });
  const c = appendSupplement(createInspiration({ text: '丙', id: 'insp_c', now: NOW }), {
    content: '刚补的', id: 'sup_1', now: NOW + 5000
  });

  const sorted = [a, b, c].sort(byUpdatedAtDesc);
  assert.deepStrictEqual(sorted.map((i) => i.text), ['丙', '乙', '甲']);
});
