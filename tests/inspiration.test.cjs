'use strict';
// 灵感领域模型的单元测试。
// 用例对应 openspec/changes/add-inspiration-mvp/specs/ 下的 inspiration-capture
// 与 ai-summarize 两份规范，命名保持可追溯。

const test = require('node:test');
const assert = require('node:assert');

const {
  createInspiration,
  validateInspiration,
  updateText,
  appendSupplement,
  editSupplement,
  foldIntoText,
  unfoldSupplement,
  removeSupplement,
  markSupplementMerged,
  unmergeSupplement,
  mergeSupplements,
  appendPhoto,
  markMerged,
  unmerge,
  markDeleted,
  isDeleted,
  isMerged,
  isSupplementHidden,
  activeSupplements,
  mergedSupplements,
  foldedSupplements,
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
  assert.deepStrictEqual(insp.textHistory, []);
  assert.deepStrictEqual(insp.supplements, []);
  assert.deepStrictEqual(insp.photos, []);
  assert.strictEqual(insp.mergedInto, null);
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

// ---------------------------------------------------------------- 原文编辑与历史

test('改写原文后旧版本进入历史', () => {
  const before = createInspiration(base());
  const after = updateText(before, { text: '做一个能导出的记账小程序', historyId: 'tex_1', now: NOW + 1000 });

  assert.strictEqual(after.text, '做一个能导出的记账小程序');
  assert.strictEqual(after.updatedAt, NOW + 1000);
  assert.strictEqual(after.textHistory.length, 1);
  assert.deepStrictEqual(after.textHistory[0], {
    id: 'tex_1',
    text: '做一个记账小程序',
    replacedAt: NOW + 1000
  });
});

test('改写返回新对象，入参不被修改', () => {
  const before = createInspiration(base());
  const after = updateText(before, { text: '改过了', historyId: 'tex_1', now: NOW + 1 });

  assert.notStrictEqual(after, before);
  assert.strictEqual(before.text, '做一个记账小程序', '入参的正文被就地改了');
  assert.strictEqual(before.textHistory.length, 0, '入参的历史被就地改了');
});

test('连续多次改写不丢早期版本', () => {
  let insp = createInspiration(base());
  insp = updateText(insp, { text: '第二版', historyId: 'tex_1', now: NOW + 1000 });
  insp = updateText(insp, { text: '第三版', historyId: 'tex_2', now: NOW + 2000 });
  insp = updateText(insp, { text: '第四版', historyId: 'tex_3', now: NOW + 3000 });

  assert.strictEqual(insp.text, '第四版');
  assert.deepStrictEqual(insp.textHistory.map((v) => v.text), ['做一个记账小程序', '第二版', '第三版']);
  assert.deepStrictEqual(insp.textHistory.map((v) => v.replacedAt), [NOW + 1000, NOW + 2000, NOW + 3000]);
});

test('本模块不导出任何删除历史的路径', () => {
  const inspiration = require('../miniprogram/core/inspiration');
  const removers = ['removeHistory', 'deleteHistory', 'clearHistory', 'trimHistory', 'popHistory'];

  for (const name of removers) {
    assert.strictEqual(typeof inspiration[name], 'undefined', `不应导出 ${name}`);
  }
});

test('改写原文不影响已有的补充', () => {
  let insp = createInspiration(base());
  insp = appendSupplement(insp, { content: '第一条', id: 'sup_1', now: NOW + 100 });
  insp = appendSupplement(insp, { content: '第二条', id: 'sup_2', now: NOW + 200 });
  const afterEdit = updateText(insp, { text: '改过的正文', historyId: 'tex_1', now: NOW + 300 });

  assert.deepStrictEqual(afterEdit.supplements.map((s) => s.content), ['第一条', '第二条']);
  assert.deepStrictEqual(afterEdit.supplements.map((s) => s.createdAt), [NOW + 100, NOW + 200]);
});

test('改写原文必须提供 historyId——不提供就写不了', () => {
  const insp = createInspiration(base());

  assert.throws(() => updateText(insp, { text: '新正文', now: NOW + 1 }), hasCode(ERROR_CODES.EMPTY_HISTORY_ID));
  assert.throws(() => updateText(insp, { text: '新正文', historyId: '', now: NOW + 1 }), hasCode(ERROR_CODES.EMPTY_HISTORY_ID));
  assert.throws(() => updateText(insp, { text: '新正文', historyId: 'bad id', now: NOW + 1 }), hasCode(ERROR_CODES.INVALID_ID));
});

test('重复使用同一个 historyId 被拒绝', () => {
  const insp = updateText(createInspiration(base()), { text: '第二版', historyId: 'tex_1', now: NOW + 1 });

  assert.throws(
    () => updateText(insp, { text: '第三版', historyId: 'tex_1', now: NOW + 2 }),
    hasCode(ERROR_CODES.DUPLICATE_HISTORY_ID)
  );
});

test('改写为空或超长被拒绝，且历史不变', () => {
  const insp = updateText(createInspiration(base()), { text: '第二版', historyId: 'tex_1', now: NOW + 1 });

  assert.throws(() => updateText(insp, { text: '  ', historyId: 'tex_2', now: NOW + 2 }), hasCode(ERROR_CODES.EMPTY_TEXT));
  assert.throws(
    () => updateText(insp, { text: '啊'.repeat(LIMITS.textMaxLength + 1), historyId: 'tex_2', now: NOW + 2 }),
    hasCode(ERROR_CODES.TEXT_TOO_LONG)
  );
  assert.strictEqual(insp.textHistory.length, 1);
  assert.strictEqual(insp.text, '第二版');
});

test('深冻结保留——防的是误改内存对象，不是阻止合法改写', () => {
  const insp = createInspiration(base());

  assert.ok(Object.isFrozen(insp));
  assert.ok(Object.isFrozen(insp.supplements));
  assert.ok(Object.isFrozen(insp.textHistory));
  assert.throws(() => { insp.text = '绕过去'; }, TypeError);

  // 合法改写照样能走通
  assert.strictEqual(updateText(insp, { text: '正常改写', historyId: 'tex_1', now: NOW + 1 }).text, '正常改写');
});

// ---------------------------------------------------------------- 补充

test('追加补充后正文不变，原对象不被修改', () => {
  const before = createInspiration(base());
  const after = appendSupplement(before, { content: '加上导出 CSV', id: 'sup_1', now: NOW + 1000 });

  assert.strictEqual(after.text, before.text);
  assert.notStrictEqual(after, before, '应返回新对象');
  assert.strictEqual(before.supplements.length, 0, '入参被就地修改了');
  assert.strictEqual(after.supplements.length, 1);
  assert.strictEqual(after.supplements[0].mergedInto, null);
  assert.strictEqual(after.updatedAt, NOW + 1000);
});

test('多次补充按时间顺序完整保留', () => {
  let insp = createInspiration(base());
  insp = appendSupplement(insp, { content: '第一条', id: 'sup_1', now: NOW + 1000 });
  insp = appendSupplement(insp, { content: '第二条', id: 'sup_2', now: NOW + 2000 });

  assert.deepStrictEqual(insp.supplements.map((s) => s.content), ['第一条', '第二条']);
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

test('补充来源只接受 user 与 ai', () => {
  const insp = createInspiration(base());

  assert.strictEqual(appendSupplement(insp, { content: '人写的', id: 'sup_1', now: NOW }).supplements[0].source, 'user');
  assert.strictEqual(
    appendSupplement(insp, { content: 'AI 写的', id: 'sup_2', source: 'ai', now: NOW }).supplements[0].source,
    'ai'
  );
  assert.throws(
    () => appendSupplement(insp, { content: '来路不明', id: 'sup_3', source: 'robot', now: NOW }),
    hasCode(ERROR_CODES.INVALID_SOURCE)
  );
});

// ---------------------------------------------------------------- 汇总与已合并

/** 造一条带三条补充的灵感，供汇总用例复用。 */
function withThreeSupplements() {
  let insp = createInspiration(base());
  insp = appendSupplement(insp, { content: '可以先按周统计', id: 'sup_1', now: NOW + 1000 });
  insp = appendSupplement(insp, { content: '比按天更容易看出规律', id: 'sup_2', now: NOW + 2000 });
  insp = appendSupplement(insp, { content: '数据量太小的话看不出来', id: 'sup_3', now: NOW + 3000 });
  return insp;
}

test('覆盖：汇总结果写入，来源被标记为已合并', () => {
  const insp = withThreeSupplements();
  const merged = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '按周统计比按天更容易看出规律，但需要足够的数据量。' },
    sourceIds: ['sup_1', 'sup_2', 'sup_3'],
    mode: 'overwrite',
    now: NOW + 4000
  });

  assert.strictEqual(merged.supplements.length, 4);
  const summary = merged.supplements.find((s) => s.id === 'sup_sum');
  assert.strictEqual(summary.source, 'ai');
  assert.strictEqual(summary.mergedInto, null, '汇总结果自己不应被标为已合并');

  for (const id of ['sup_1', 'sup_2', 'sup_3']) {
    assert.strictEqual(merged.supplements.find((s) => s.id === id).mergedInto, 'sup_sum', `${id} 未被标记`);
  }
  assert.deepStrictEqual(activeSupplements(merged).map((s) => s.id), ['sup_sum']);
  assert.deepStrictEqual(mergedSupplements(merged).map((s) => s.id), ['sup_1', 'sup_2', 'sup_3']);
});

test('另存：来源完全不动，仍独立可见', () => {
  const insp = withThreeSupplements();
  const saved = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    mode: 'append',
    now: NOW + 4000
  });

  assert.strictEqual(saved.supplements.length, 4);
  for (const id of ['sup_1', 'sup_2']) {
    assert.strictEqual(saved.supplements.find((s) => s.id === id).mergedInto, null, `${id} 不应被标记`);
  }
  assert.deepStrictEqual(activeSupplements(saved).map((s) => s.id), ['sup_1', 'sup_2', 'sup_3', 'sup_sum']);
  assert.strictEqual(mergedSupplements(saved).length, 0);
});

test('被覆盖的内容完整可读——只是收起，不是截断', () => {
  const insp = withThreeSupplements();
  const merged = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    mode: 'overwrite',
    now: NOW + 4000
  });

  const restored = mergedSupplements(merged).map((s) => s.content);
  assert.deepStrictEqual(restored, ['可以先按周统计', '比按天更容易看出规律']);
});

test('恢复一条已合并的补充：内容回来，汇总结果不受影响', () => {
  const insp = withThreeSupplements();
  const merged = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    mode: 'overwrite',
    now: NOW + 4000
  });
  const restored = unmergeSupplement(merged, { supplementId: 'sup_1' });

  assert.strictEqual(restored.supplements.find((s) => s.id === 'sup_1').mergedInto, null);
  assert.strictEqual(restored.supplements.find((s) => s.id === 'sup_2').mergedInto, 'sup_sum', '不该顺手恢复别的');
  assert.ok(restored.supplements.find((s) => s.id === 'sup_sum'), '汇总结果不应消失');
  assert.deepStrictEqual(activeSupplements(restored).map((s) => s.id), ['sup_1', 'sup_3', 'sup_sum']);
});

test('只选一条不能汇总', () => {
  const insp = withThreeSupplements();

  assert.throws(
    () => mergeSupplements(insp, {
      summary: { id: 'sup_sum', content: '汇总结果' },
      sourceIds: ['sup_1'],
      mode: 'overwrite',
      now: NOW + 4000
    }),
    hasCode(ERROR_CODES.LIMIT_EXCEEDED)
  );
});

test('汇总的写入方式必须显式给出，没有默认值', () => {
  const insp = withThreeSupplements();
  const payload = {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    now: NOW + 4000
  };

  assert.throws(() => mergeSupplements(insp, payload), hasCode(ERROR_CODES.INVALID_MERGE_MODE));
  assert.throws(
    () => mergeSupplements(insp, Object.assign({}, payload, { mode: 'replace' })),
    hasCode(ERROR_CODES.INVALID_MERGE_MODE)
  );
});

test('汇总失败不留痕：失败后被选中的内容与汇总前一致', () => {
  const insp = withThreeSupplements();
  const before = JSON.parse(JSON.stringify(insp.supplements));

  assert.throws(
    () => mergeSupplements(insp, {
      summary: { id: 'sup_sum', content: '汇总结果' },
      sourceIds: ['sup_1', 'sup_nope'],
      mode: 'overwrite',
      now: NOW + 4000
    }),
    hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND)
  );

  assert.deepStrictEqual(JSON.parse(JSON.stringify(insp.supplements)), before);
  assert.strictEqual(activeSupplements(insp).length, 3, '不应出现空的汇总结果');
});

test('汇总结果为空或超长被拒绝', () => {
  const insp = withThreeSupplements();
  const payload = { sourceIds: ['sup_1', 'sup_2'], mode: 'overwrite', now: NOW + 4000 };

  assert.throws(
    () => mergeSupplements(insp, Object.assign({}, payload, { summary: { id: 'sup_sum', content: '  ' } })),
    hasCode(ERROR_CODES.EMPTY_SUPPLEMENT)
  );
  assert.throws(
    () => mergeSupplements(insp, Object.assign({}, payload, {
      summary: { id: 'sup_sum', content: '啊'.repeat(LIMITS.summaryMaxLength + 1) }
    })),
    hasCode(ERROR_CODES.SUPPLEMENT_TOO_LONG)
  );
});

test('不能把汇总结果本身当作来源', () => {
  const insp = withThreeSupplements();

  assert.throws(
    () => mergeSupplements(insp, {
      summary: { id: 'sup_1', content: '汇总结果' },
      sourceIds: ['sup_1', 'sup_2'],
      mode: 'overwrite',
      now: NOW + 4000
    }),
    hasCode(ERROR_CODES.MERGE_SELF)
  );
});

test('已经合并过的补充不能再次被合并', () => {
  const insp = withThreeSupplements();
  const merged = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    mode: 'overwrite',
    now: NOW + 4000
  });

  assert.throws(
    () => mergeSupplements(merged, {
      summary: { id: 'sup_sum2', content: '再汇总一次' },
      sourceIds: ['sup_1', 'sup_3'],
      mode: 'overwrite',
      now: NOW + 5000
    }),
    hasCode(ERROR_CODES.ALREADY_MERGED)
  );
});

test('标记已合并是幂等的，重复提交不产生额外效果', () => {
  const insp = withThreeSupplements();
  const once = markSupplementMerged(insp, { supplementId: 'sup_1', targetId: 'sup_2', now: NOW + 4000 });
  const twice = markSupplementMerged(once, { supplementId: 'sup_1', targetId: 'sup_2', now: NOW + 5000 });

  assert.strictEqual(twice.supplements.filter((s) => s.mergedInto).length, 1);
  assert.strictEqual(twice.updatedAt, insp.updatedAt, '标记已合并不应改变更新时间');
});

test('标记已合并时目标必须存在，也不能指向自身', () => {
  const insp = withThreeSupplements();

  assert.throws(
    () => markSupplementMerged(insp, { supplementId: 'sup_1', targetId: 'sup_1', now: NOW }),
    hasCode(ERROR_CODES.MERGE_SELF)
  );
  assert.throws(
    () => markSupplementMerged(insp, { supplementId: 'sup_1', targetId: 'sup_nope', now: NOW }),
    hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND)
  );
  assert.throws(
    () => markSupplementMerged(insp, { supplementId: 'sup_nope', targetId: 'sup_2', now: NOW }),
    hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND)
  );
});

// ---------------------------------------------------------------- 灵感级合并

test('灵感可被整条标记为已合并，也可恢复', () => {
  const insp = createInspiration(base());
  const merged = markMerged(insp, { targetId: 'insp_target', now: NOW + 1000 });

  assert.strictEqual(merged.mergedInto, 'insp_target');
  assert.strictEqual(isMerged(merged), true);
  assert.strictEqual(isMerged(insp), false, '入参被就地修改了');
  assert.strictEqual(merged.text, '做一个记账小程序', '合并不该动内容');
  assert.strictEqual(merged.updatedAt, NOW, '合并不是编辑，不应让条目重新排序');

  const restored = unmerge(merged);
  assert.strictEqual(restored.mergedInto, null);
  assert.strictEqual(isMerged(restored), false);
});

test('灵感不能合并到自身，已合并的不能改指向', () => {
  const insp = createInspiration(base());

  assert.throws(() => markMerged(insp, { targetId: insp.id, now: NOW }), hasCode(ERROR_CODES.MERGE_SELF));

  const merged = markMerged(insp, { targetId: 'insp_a', now: NOW });
  assert.throws(() => markMerged(merged, { targetId: 'insp_b', now: NOW }), hasCode(ERROR_CODES.ALREADY_MERGED));
  assert.strictEqual(markMerged(merged, { targetId: 'insp_a', now: NOW + 1 }).mergedInto, 'insp_a', '重复标记应当幂等');
});

test('恢复一条没有合并过的灵感是空操作', () => {
  const insp = createInspiration(base());
  assert.strictEqual(unmerge(insp), insp);
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

  assert.throws(
    () => appendPhoto(insp, { id: 'pho_extra', fileId: 'cloud://x', now: NOW + 99 }),
    hasCode(ERROR_CODES.LIMIT_EXCEEDED)
  );
  assert.strictEqual(insp.photos.length, LIMITS.photosPerInspiration);
});

test('同一图片重复追加按覆盖处理，不产生重复记录也不改创建时间', () => {
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

// ---------------------------------------------------------------- 单条补充的直接操作

test('修改补充：内容被替换，旧内容进这条补充自己的历史', () => {
  const insp = withThreeSupplements();
  const edited = editSupplement(insp, {
    supplementId: 'sup_1', content: '按周统计会更好', historyId: 'chg_1', now: NOW + 4000
  });

  const item = edited.supplements.find((s) => s.id === 'sup_1');
  assert.strictEqual(item.content, '按周统计会更好');
  assert.strictEqual(item.contentHistory.length, 1);
  assert.deepStrictEqual(item.contentHistory[0], {
    id: 'chg_1', content: '可以先按周统计', replacedAt: NOW + 4000
  });
  assert.strictEqual(edited.updatedAt, NOW + 4000);
});

test('修改补充不改动别的补充，也不动原文', () => {
  const insp = withThreeSupplements();
  const edited = editSupplement(insp, {
    supplementId: 'sup_2', content: '改过了', historyId: 'chg_1', now: NOW + 4000
  });

  assert.strictEqual(edited.text, insp.text);
  assert.strictEqual(edited.supplements.find((s) => s.id === 'sup_1').content, '可以先按周统计');
  assert.strictEqual(edited.supplements.find((s) => s.id === 'sup_1').contentHistory.length, 0);
  assert.strictEqual(insp.supplements.find((s) => s.id === 'sup_2').content, '比按天更容易看出规律', '入参被就地改了');
});

test('修改补充同样必须提供 historyId', () => {
  const insp = withThreeSupplements();

  assert.throws(
    () => editSupplement(insp, { supplementId: 'sup_1', content: '新内容', now: NOW + 1 }),
    hasCode(ERROR_CODES.EMPTY_HISTORY_ID)
  );
});

test('修改补充为空或超长被拒绝', () => {
  const insp = withThreeSupplements();
  const payload = { supplementId: 'sup_1', historyId: 'chg_1', now: NOW + 1 };

  assert.throws(
    () => editSupplement(insp, Object.assign({}, payload, { content: '   ' })),
    hasCode(ERROR_CODES.EMPTY_SUPPLEMENT)
  );
  assert.throws(
    () => editSupplement(insp, Object.assign({}, payload, {
      content: '啊'.repeat(LIMITS.supplementMaxLength + 1)
    })),
    hasCode(ERROR_CODES.SUPPLEMENT_TOO_LONG)
  );
});

test('已合并或已并入的补充不能直接修改——先恢复再改', () => {
  const insp = withThreeSupplements();
  const merged = markSupplementMerged(insp, { supplementId: 'sup_1', targetId: 'sup_2', now: NOW + 4000 });
  assert.throws(
    () => editSupplement(merged, { supplementId: 'sup_1', content: '新内容', historyId: 'chg_1', now: NOW + 1 }),
    hasCode(ERROR_CODES.ALREADY_MERGED)
  );

  const folded = foldIntoText(insp, { supplementId: 'sup_3', historyId: 'tex_1', now: NOW + 4000 });
  assert.throws(
    () => editSupplement(folded, { supplementId: 'sup_3', content: '新内容', historyId: 'chg_1', now: NOW + 1 }),
    hasCode(ERROR_CODES.ALREADY_FOLDED)
  );
});

test('合并进灵感：内容追加到末尾，本条收起，原文旧版本进历史', () => {
  const insp = withThreeSupplements();
  const folded = foldIntoText(insp, { supplementId: 'sup_3', historyId: 'tex_1', now: NOW + 4000 });

  assert.strictEqual(folded.text, '做一个记账小程序\n\n数据量太小的话看不出来');
  assert.strictEqual(folded.textHistory.length, 1);
  assert.strictEqual(folded.textHistory[0].text, '做一个记账小程序');
  assert.strictEqual(folded.textHistory[0].id, 'tex_1');

  const item = folded.supplements.find((s) => s.id === 'sup_3');
  assert.strictEqual(item.foldedAt, NOW + 4000);
  assert.strictEqual(item.content, '数据量太小的话看不出来', '合并不该清空原内容');
  assert.strictEqual(isSupplementHidden(item), true);
});

test('已并入的补充默认不在时间线上出现，但完整可读', () => {
  const insp = withThreeSupplements();
  const folded = foldIntoText(insp, { supplementId: 'sup_3', historyId: 'tex_1', now: NOW + 4000 });

  assert.deepStrictEqual(activeSupplements(folded).map((s) => s.id), ['sup_1', 'sup_2']);
  assert.deepStrictEqual(foldedSupplements(folded).map((s) => s.id), ['sup_3']);
  assert.strictEqual(foldedSupplements(folded)[0].content, '数据量太小的话看不出来');
});

test('合并后原文仍可编辑，合并前的版本还在历史里', () => {
  const insp = withThreeSupplements();
  const folded = foldIntoText(insp, { supplementId: 'sup_3', historyId: 'tex_1', now: NOW + 4000 });
  const edited = updateText(folded, { text: '又改了一次', historyId: 'tex_2', now: NOW + 5000 });

  assert.strictEqual(edited.text, '又改了一次');
  assert.deepStrictEqual(
    edited.textHistory.map((v) => v.text),
    ['做一个记账小程序', '做一个记账小程序\n\n数据量太小的话看不出来']
  );
});

test('合并撑破正文上限时整条拒绝，不做截断', () => {
  // 正文接近上限，再来一条补充必然越界
  const insp = appendSupplement(
    createInspiration({ text: '啊'.repeat(LIMITS.textMaxLength - 10), id: 'insp_a', now: NOW }),
    { content: '啊'.repeat(100), id: 'sup_1', now: NOW + 1 }
  );

  assert.throws(
    () => foldIntoText(insp, { supplementId: 'sup_1', historyId: 'tex_1', now: NOW + 2 }),
    hasCode(ERROR_CODES.TEXT_TOO_LONG)
  );
  assert.strictEqual(insp.text.length, LIMITS.textMaxLength - 10, '失败后正文不该被改动');
  assert.strictEqual(insp.supplements[0].foldedAt, null, '失败后不该留下半合并状态');
});

test('重复合并同一条被拒绝', () => {
  const insp = withThreeSupplements();
  const folded = foldIntoText(insp, { supplementId: 'sup_1', historyId: 'tex_1', now: NOW + 4000 });

  assert.throws(
    () => foldIntoText(folded, { supplementId: 'sup_1', historyId: 'tex_2', now: NOW + 5000 }),
    hasCode(ERROR_CODES.ALREADY_FOLDED)
  );
});

test('恢复已并入的补充：重新出现在时间线，原文不回退', () => {
  const insp = withThreeSupplements();
  const folded = foldIntoText(insp, { supplementId: 'sup_3', historyId: 'tex_1', now: NOW + 4000 });
  const restored = unfoldSupplement(folded, { supplementId: 'sup_3' });

  assert.strictEqual(restored.supplements.find((s) => s.id === 'sup_3').foldedAt, null);
  assert.strictEqual(restored.text, folded.text, '原文不该回退——合并进去的内容应当留着');
  assert.strictEqual(restored.textHistory.length, 1, '历史不该被清掉');
  assert.strictEqual(activeSupplements(restored).length, 3);
});

test('恢复一条没合并过的补充是空操作', () => {
  const insp = withThreeSupplements();
  assert.strictEqual(unfoldSupplement(insp, { supplementId: 'sup_1' }), insp);
});

test('删除补充：从时间线移除', () => {
  const insp = withThreeSupplements();
  const after = removeSupplement(insp, { supplementId: 'sup_2' });

  assert.deepStrictEqual(after.supplements.map((s) => s.id), ['sup_1', 'sup_3']);
  assert.strictEqual(after.updatedAt, insp.updatedAt, '删除不是编辑，不应让条目重新排序');
  assert.strictEqual(insp.supplements.length, 3, '入参被就地修改了');
});

test('删除汇总结果时，指向它的补充一并恢复——不留悬空引用', () => {
  const insp = withThreeSupplements();
  const merged = mergeSupplements(insp, {
    summary: { id: 'sup_sum', content: '汇总结果' },
    sourceIds: ['sup_1', 'sup_2'],
    mode: 'overwrite',
    now: NOW + 4000
  });
  // sup_3 没被选中，仍在时间线上；sup_1 与 sup_2 被收进 sup_sum
  assert.deepStrictEqual(activeSupplements(merged).map((s) => s.id), ['sup_3', 'sup_sum']);

  const after = removeSupplement(merged, { supplementId: 'sup_sum' });

  assert.ok(!after.supplements.some((s) => s.id === 'sup_sum'), '汇总结果应被真删');
  assert.strictEqual(after.supplements.find((s) => s.id === 'sup_1').mergedInto, null, 'sup_1 应被恢复');
  assert.strictEqual(after.supplements.find((s) => s.id === 'sup_2').mergedInto, null, 'sup_2 应被恢复');
  assert.deepStrictEqual(activeSupplements(after).map((s) => s.id), ['sup_1', 'sup_2', 'sup_3']);

  for (const item of after.supplements) {
    assert.ok(item.mergedInto === null || after.supplements.some((s) => s.id === item.mergedInto),
      `${item.id} 留下了指向不存在目标的引用`);
  }
});

test('删除不存在的补充被拒绝', () => {
  const insp = withThreeSupplements();
  assert.throws(() => removeSupplement(insp, { supplementId: 'sup_nope' }), hasCode(ERROR_CODES.SUPPLEMENT_NOT_FOUND));
});
