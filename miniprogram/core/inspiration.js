'use strict';
// 灵感领域模型。
//
// 三条硬约束，改动前请先确认规范是否也跟着改了：
//   1. 纯函数：不读写存储、不调用 wx API、**不自行取当前时间**。所有时间由调用方
//      经 now 注入，否则同一份数据在不同时刻会得到不同结果，测试无法稳定断言。
//   2. 改原文必须留历史：唯一的改写路径是 updateText，它的签名**强制要求**同时
//      提供 historyId。被替换掉的版本压入 textHistory，只增不减。本模块不提供
//      「改写但不留历史」的调用方式，也不导出任何删除历史的函数。
//   3. 汇总只标记不删除：markSupplementMerged / markMerged 只写 mergedInto，
//      被合并的内容原样保留，必须完整可读、可恢复。
//
// 返回的对象一律深冻结。它防的是误改内存中的对象，**不是**阻止合法改写——
// 改写一律走「返回新对象」。
//
// 标识（id）由调用方生成并传入，本模块不生成——生成要用 Date.now() 与随机数，
// 会把不确定性带进纯函数。生成入口在 core/limits.js 的 createId。

const { LIMITS } = require('./limits');
const { ERROR_CODES, ValidationError } = require('./errors');

// 标识字符集刻意收窄：标识会参与云存储路径拼接
// （linggan/{accountKey}/{inspirationId}/{photoId}），放行 `/`、`\`、`.` 会带来越权拼接风险。
const ID_PATTERN = new RegExp('^[A-Za-z0-9_]{1,' + LIMITS.idMaxLength + '}$');

const SUPPLEMENT_SOURCES = ['user', 'ai'];
const MERGE_MODES = ['overwrite', 'append'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isValidTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// 深冻结：只冻结外层的话，补充数组仍可被 push。
function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  return value;
}

// 对早期数据（本次修订之前创建的、没有 textHistory / mergedInto 字段）保持宽容，
// 读取时一律给默认值，避免旧快照在升级后直接读崩。
function historyOf(inspiration) {
  return Array.isArray(inspiration.textHistory) ? inspiration.textHistory : [];
}

function supplementsOf(inspiration) {
  return Array.isArray(inspiration.supplements) ? inspiration.supplements : [];
}

function contentHistoryOf(supplement) {
  return Array.isArray(supplement.contentHistory) ? supplement.contentHistory : [];
}

/** 一条补充是否已经不在时间线上正常显示（被 AI 汇总合并，或已合并进灵感）。 */
function isSupplementHidden(supplement) {
  return Boolean(supplement && (supplement.mergedInto || supplement.foldedAt));
}

function checkId(id, field) {
  if (id === undefined || id === null || id === '') {
    return { field, code: ERROR_CODES.MISSING_FIELD };
  }
  if (!isValidId(id)) {
    return { field, code: ERROR_CODES.INVALID_ID };
  }
  return null;
}

function checkNow(now, field) {
  if (now === undefined || now === null) {
    return { field, code: ERROR_CODES.MISSING_FIELD };
  }
  if (!isValidTimestamp(now)) {
    return { field, code: ERROR_CODES.INVALID_NOW };
  }
  return null;
}

// 正文与补充共用的文本校验。空判定用 trim，因此纯空白视为空。
// 不 trim 后存储：用户写下的内容原样保留，只做校验，不做静默改写。
function checkText(text, field, maxLength, emptyCode, tooLongCode) {
  if (text === undefined || text === null) {
    return { field, code: ERROR_CODES.MISSING_FIELD };
  }
  if (typeof text !== 'string') {
    return { field, code: ERROR_CODES.INVALID_TYPE };
  }
  if (text.trim().length === 0) {
    return { field, code: emptyCode };
  }
  if (text.length > maxLength) {
    return { field, code: tooLongCode };
  }
  return null;
}

function assertInspiration(inspiration) {
  if (!isPlainObject(inspiration) || typeof inspiration.text !== 'string') {
    throw new ValidationError([{ field: 'inspiration', code: ERROR_CODES.INVALID_TYPE }]);
  }
}

function throwIfAny(errors) {
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * 不抛错版校验，供页面做即时提示（逐字段展示哪里不合法）。
 * 硬校验请用 createInspiration，它会抛 ValidationError。
 */
function validateInspiration(input) {
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const textError = checkText(
    source.text, 'text', LIMITS.textMaxLength, ERROR_CODES.EMPTY_TEXT, ERROR_CODES.TEXT_TOO_LONG
  );
  if (textError) errors.push(textError);

  const idError = checkId(source.id, 'id');
  if (idError) errors.push(idError);

  const nowError = checkNow(source.now, 'now');
  if (nowError) errors.push(nowError);

  return { ok: errors.length === 0, errors };
}

/**
 * 创建一条灵感。正文此**可以**再改写——改写走 updateText，旧版本会进 textHistory。
 */
function createInspiration(input) {
  const result = validateInspiration(input);
  throwIfAny(result.errors);

  const { text, id, now } = input;
  return deepFreeze({
    id,
    text,
    textHistory: [],
    createdAt: now,
    updatedAt: now,
    supplements: [],
    photos: [],
    mergedInto: null,
    deletedAt: null
  });
}

/**
 * 改写原文。这是唯一的改写路径，且**必须**同时提供 historyId。
 *
 * historyId 不是可选项：签名强制要求它，是为了让「改写但不留历史」在调用层面
 * 根本写不出来，而不是靠实现者记得。被替换掉的旧正文在同一次返回里压入
 * textHistory，不存在「新正文已写、历史还没补」的中间态。
 *
 * 历史只增不减。本模块不导出任何删除历史的函数。
 */
function updateText(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const textError = checkText(
    source.text, 'text', LIMITS.textMaxLength, ERROR_CODES.EMPTY_TEXT, ERROR_CODES.TEXT_TOO_LONG
  );
  if (textError) errors.push(textError);

  if (source.historyId === undefined || source.historyId === null || source.historyId === '') {
    errors.push({ field: 'historyId', code: ERROR_CODES.EMPTY_HISTORY_ID });
  } else if (!isValidId(source.historyId)) {
    errors.push({ field: 'historyId', code: ERROR_CODES.INVALID_ID });
  } else if (historyOf(inspiration).some((version) => version.id === source.historyId)) {
    errors.push({ field: 'historyId', code: ERROR_CODES.DUPLICATE_HISTORY_ID });
  }

  const nowError = checkNow(source.now, 'replacedAt');
  if (nowError) errors.push(nowError);

  throwIfAny(errors);

  const archived = { id: source.historyId, text: inspiration.text, replacedAt: source.now };

  return deepFreeze(Object.assign({}, inspiration, {
    text: source.text,
    textHistory: historyOf(inspiration).concat([archived]),
    updatedAt: source.now
  }));
}

/**
 * 追加一条补充。返回新对象，入参不被修改。
 * 内容为空或超长时抛错——不写入，也不改变 updatedAt，与规范「空补充不改更新时间」一致。
 */
function appendSupplement(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const contentError = checkText(
    source.content, 'supplements[].content', LIMITS.supplementMaxLength,
    ERROR_CODES.EMPTY_SUPPLEMENT, ERROR_CODES.SUPPLEMENT_TOO_LONG
  );
  if (contentError) errors.push(contentError);

  const idError = checkId(source.id, 'supplements[].id');
  if (idError) errors.push(idError);

  if (source.source !== undefined && SUPPLEMENT_SOURCES.indexOf(source.source) === -1) {
    errors.push({ field: 'supplements[].source', code: ERROR_CODES.INVALID_SOURCE });
  }

  const nowError = checkNow(source.now, 'supplements[].createdAt');
  if (nowError) errors.push(nowError);

  throwIfAny(errors);

  const entry = {
    id: source.id,
    content: source.content,
    contentHistory: [],   // 这条补充自己的历史，与原文的 textHistory 同一套规则
    createdAt: source.now,
    // 来源默认 user；AI 产出必须显式传 'ai'，界面据此标注，不得把本地结果说成 AI 生成。
    source: source.source === undefined ? 'user' : source.source,
    mergedInto: null,     // 被 AI 汇总时指向汇总结果
    foldedAt: null        // 被合并进灵感的时刻（界面标签「合并进灵感」）
  };

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration).concat([entry]),
    updatedAt: source.now
  }));
}

/**
 * 把一条补充标记为「已合并进 targetId」。内容原样保留，只是默认收起。
 * 不改变 updatedAt：这是元数据变更，不是内容编辑。
 *
 * 幂等：已经指向同一个目标时原样返回，重试不产生额外效果。
 */
function markSupplementMerged(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const supplementIdError = checkId(source.supplementId, 'supplementId');
  if (supplementIdError) errors.push(supplementIdError);

  const targetError = checkId(source.targetId, 'mergedInto');
  if (targetError) errors.push(targetError);

  if (!supplementIdError && !targetError) {
    if (source.supplementId === source.targetId) {
      errors.push({ field: 'mergedInto', code: ERROR_CODES.MERGE_SELF });
    }

    const target = supplementsOf(inspiration).find((item) => item.id === source.targetId);
    if (!target) {
      errors.push({ field: 'mergedInto', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
    }

    const item = supplementsOf(inspiration).find((s) => s.id === source.supplementId);
    if (!item) {
      errors.push({ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
    } else if (item.mergedInto && item.mergedInto !== source.targetId) {
      errors.push({ field: 'supplementId', code: ERROR_CODES.ALREADY_MERGED });
    }
  }

  const nowError = checkNow(source.now, 'now');
  if (nowError) errors.push(nowError);

  throwIfAny(errors);

  const current = supplementsOf(inspiration).find((s) => s.id === source.supplementId);
  if (current.mergedInto === source.targetId) {
    return inspiration;
  }

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration).map((item) => (
      item.id === source.supplementId ? Object.assign({}, item, { mergedInto: source.targetId }) : item
    ))
  }));
}

/**
 * 取消一条补充的「已合并」标记。内容与时间不受影响，汇总结果也不受影响——两者并存。
 * 不改变 updatedAt：恢复是元数据变更，条目在时间线上的位置由 createdAt 决定。
 */
function unmergeSupplement(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.supplementId, 'supplementId');
  if (idError) errors.push(idError);
  throwIfAny(errors);

  const current = supplementsOf(inspiration).find((s) => s.id === source.supplementId);
  if (!current) {
    throw new ValidationError([{ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND }]);
  }
  if (!current.mergedInto) {
    return inspiration;   // 本来就没合并，原样返回
  }

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration).map((item) => (
      item.id === source.supplementId ? Object.assign({}, item, { mergedInto: null }) : item
    ))
  }));
}

/**
 * 修改一条补充的内容。与 updateText 同一套规则：**必须**同时提供 historyId，
 * 被替换掉的旧内容进入这条补充自己的 contentHistory。
 *
 * 已合并或已合并进灵感的补充不允许直接修改——它们已经不在时间线上正常显示，
 * 先恢复再改，用户才看得清自己在改什么。
 */
function editSupplement(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.supplementId, 'supplementId');
  if (idError) errors.push(idError);

  const contentError = checkText(
    source.content, 'supplements[].content', LIMITS.supplementMaxLength,
    ERROR_CODES.EMPTY_SUPPLEMENT, ERROR_CODES.SUPPLEMENT_TOO_LONG
  );
  if (contentError) errors.push(contentError);

  if (source.historyId === undefined || source.historyId === null || source.historyId === '') {
    errors.push({ field: 'historyId', code: ERROR_CODES.EMPTY_HISTORY_ID });
  } else if (!isValidId(source.historyId)) {
    errors.push({ field: 'historyId', code: ERROR_CODES.INVALID_ID });
  }

  const nowError = checkNow(source.now, 'replacedAt');
  if (nowError) errors.push(nowError);

  if (!idError) {
    const item = supplementsOf(inspiration).find((s) => s.id === source.supplementId);
    if (!item) {
      errors.push({ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
    } else if (item.mergedInto) {
      errors.push({ field: 'supplementId', code: ERROR_CODES.ALREADY_MERGED });
    } else if (item.foldedAt) {
      errors.push({ field: 'supplementId', code: ERROR_CODES.ALREADY_FOLDED });
    } else if (isValidId(source.historyId)
      && contentHistoryOf(item).some((version) => version.id === source.historyId)) {
      errors.push({ field: 'historyId', code: ERROR_CODES.DUPLICATE_HISTORY_ID });
    }
  }

  throwIfAny(errors);

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration).map((item) => (
      item.id === source.supplementId
        ? Object.assign({}, item, {
            content: source.content,
            contentHistory: contentHistoryOf(item).concat([
              { id: source.historyId, content: item.content, replacedAt: source.now }
            ])
          })
        : item
    )),
    updatedAt: source.now
  }));
}

const FOLD_SEPARATOR = '\n\n';

/**
 * 把一条补充合并进灵感：内容追加到原文末尾，本条标记为已并入并默认收起。
 * 界面上这个动作叫「合并进灵感」，函数名保留 foldIntoText——它描述的是机制
 * （把内容折进正文），比跟着文案改名更准确。
 *
 * 用的是与 updateText 同一套历史机制——合并前的原文照常进 textHistory，
 * 所以「合并」不会让任何一句话消失。
 *
 * **合并可能撑破正文长度上限**，所以长度校验必须在这里做，超了整条拒绝、不做截断。
 * 这一条容易漏：补充上限 1000、正文上限 2000，一条接近上限的补充汇进一条已经
 * 接近上限的正文就会越界。
 */
function foldIntoText(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.supplementId, 'supplementId');
  if (idError) errors.push(idError);

  if (source.historyId === undefined || source.historyId === null || source.historyId === '') {
    errors.push({ field: 'historyId', code: ERROR_CODES.EMPTY_HISTORY_ID });
  } else if (!isValidId(source.historyId)) {
    errors.push({ field: 'historyId', code: ERROR_CODES.INVALID_ID });
  } else if (historyOf(inspiration).some((version) => version.id === source.historyId)) {
    errors.push({ field: 'historyId', code: ERROR_CODES.DUPLICATE_HISTORY_ID });
  }

  const nowError = checkNow(source.now, 'now');
  if (nowError) errors.push(nowError);

  const item = idError ? null : supplementsOf(inspiration).find((s) => s.id === source.supplementId);
  if (!idError && !item) {
    errors.push({ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
  } else if (item && item.mergedInto) {
    errors.push({ field: 'supplementId', code: ERROR_CODES.ALREADY_MERGED });
  } else if (item && item.foldedAt) {
    errors.push({ field: 'supplementId', code: ERROR_CODES.ALREADY_FOLDED });
  }

  const nextText = item === null
    ? null
    : (inspiration.text.length === 0 ? item.content : inspiration.text + FOLD_SEPARATOR + item.content);
  if (nextText !== null && nextText.length > LIMITS.textMaxLength) {
    errors.push({ field: 'text', code: ERROR_CODES.TEXT_TOO_LONG });
  }

  throwIfAny(errors);

  const archived = { id: source.historyId, text: inspiration.text, replacedAt: source.now };

  return deepFreeze(Object.assign({}, inspiration, {
    text: nextText,
    textHistory: historyOf(inspiration).concat([archived]),
    supplements: supplementsOf(inspiration).map((s) => (
      s.id === source.supplementId ? Object.assign({}, s, { foldedAt: source.now }) : s
    )),
    updatedAt: source.now
  }));
}

/**
 * 恢复一条已并入灵感的补充。
 *
 * **原文不回退**——合并进去的内容照常留在原文里。回退原文是另一回事（走 updateText
 * 从历史里取回），把它塞进这里会让用户以为「恢复」是撤销，而它只是让这一条重新
 * 出现在时间线上。
 */
function unfoldSupplement(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.supplementId, 'supplementId');
  if (idError) errors.push(idError);
  throwIfAny(errors);

  const current = supplementsOf(inspiration).find((s) => s.id === source.supplementId);
  if (!current) {
    throw new ValidationError([{ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND }]);
  }
  if (!current.foldedAt) {
    return inspiration;
  }

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration).map((s) => (
      s.id === source.supplementId ? Object.assign({}, s, { foldedAt: null }) : s
    ))
  }));
}

/**
 * 删除一条补充。**真删**——规范里写明了：「说删除却只是收起，是欺骗」。
 *
 * 但删除必须顺带处理指向它的引用：如果别的补充被汇总合并进了它，直接删会留下
 * 指向不存在目标的悬空 mergedInto，那些补充就永远收在时间线里出不来了。
 * 所以删掉一条补充时，把指向它的那些补充一并恢复。
 *
 * 不改变 updatedAt：删除不是编辑，不应让条目在列表里重新排序。
 */
function removeSupplement(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.supplementId, 'supplementId');
  if (idError) errors.push(idError);
  throwIfAny(errors);

  const exists = supplementsOf(inspiration).some((s) => s.id === source.supplementId);
  if (!exists) {
    throw new ValidationError([{ field: 'supplementId', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND }]);
  }

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: supplementsOf(inspiration)
      .filter((s) => s.id !== source.supplementId)
      .map((s) => (s.mergedInto === source.supplementId ? Object.assign({}, s, { mergedInto: null }) : s))
  }));
}

/**
 * 把多条补充汇总成一条。**这是汇总写入的唯一入口**，一次调用返回一个完整的新对象。
 *
 * 之所以把它做成一个原子操作而不是让调用方自己拼 appendSupplement + markSupplementMerged：
 * 规范要求「失败不留痕」。分成两步，中间任何一步出错都可能留下一个空汇总结果或
 * 半合并状态。这里全部在内存里算完再一次性返回，调用方拿到的要么是完整结果，
 * 要么什么都没发生。
 *
 * mode 没有默认值——必须是 'overwrite' 或 'append' 之一，由用户在界面上选。
 */
function mergeSupplements(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];
  const summary = isPlainObject(source.summary) ? source.summary : {};

  const contentError = checkText(
    summary.content, 'summary.content', LIMITS.summaryMaxLength,
    ERROR_CODES.EMPTY_SUPPLEMENT, ERROR_CODES.SUPPLEMENT_TOO_LONG
  );
  if (contentError) errors.push(contentError);

  const summaryIdError = checkId(summary.id, 'summary.id');
  if (summaryIdError) errors.push(summaryIdError);

  const sourceIds = Array.isArray(source.sourceIds) ? source.sourceIds : null;
  if (!sourceIds) {
    errors.push({ field: 'sourceIds', code: ERROR_CODES.MISSING_FIELD });
  } else {
    if (sourceIds.length < LIMITS.mergeMinItems) {
      // 少于两条没有汇总的意义。界面应当在调用前就拦住，这里是服务端的兜底。
      errors.push({ field: 'sourceIds', code: ERROR_CODES.LIMIT_EXCEEDED });
    }
    if (summaryIdError === null && sourceIds.indexOf(summary.id) !== -1) {
      errors.push({ field: 'sourceIds', code: ERROR_CODES.MERGE_SELF });
    }
    sourceIds.forEach((id) => {
      const target = supplementsOf(inspiration).find((item) => item.id === id);
      if (!target) {
        errors.push({ field: 'sourceIds', code: ERROR_CODES.SUPPLEMENT_NOT_FOUND });
      } else if (target.mergedInto) {
        errors.push({ field: 'sourceIds', code: ERROR_CODES.ALREADY_MERGED });
      }
    });
  }

  if (MERGE_MODES.indexOf(source.mode) === -1) {
    errors.push({ field: 'mode', code: ERROR_CODES.INVALID_MERGE_MODE });
  }

  const nowError = checkNow(source.now, 'now');
  if (nowError) errors.push(nowError);

  throwIfAny(errors);

  let next = appendSupplement(inspiration, {
    content: summary.content,
    id: summary.id,
    source: 'ai',
    now: source.now
  });

  if (source.mode === 'overwrite') {
    sourceIds.forEach((id) => {
      next = markSupplementMerged(next, {
        supplementId: id, targetId: summary.id, now: source.now
      });
    });
  }

  return next;
}

/**
 * 追加一张图片记录。返回新对象，入参不被修改。
 *
 * 只有上传成功、拿到有效 fileId 的照片才应走到这里；上传中与上传失败属于本机临时状态，
 * 不进入 photos 数组，因此云端不存在「半张照片」。
 *
 * 同一 id 重复追加按覆盖处理而非新增，这是重试幂等的落点：重传覆盖同一对象，
 * 记录数保持为 1。
 */
function appendPhoto(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const idError = checkId(source.id, 'photos[].id');
  if (idError) errors.push(idError);

  if (source.fileId === undefined || source.fileId === null || source.fileId === '') {
    errors.push({ field: 'photos[].fileId', code: ERROR_CODES.MISSING_FIELD });
  } else if (typeof source.fileId !== 'string' || source.fileId.trim().length === 0) {
    errors.push({ field: 'photos[].fileId', code: ERROR_CODES.INVALID_FILE_ID });
  }

  const nowError = checkNow(source.now, 'photos[].createdAt');
  if (nowError) errors.push(nowError);

  const photos = Array.isArray(inspiration.photos) ? inspiration.photos : [];
  const existingIndex = photos.findIndex((photo) => photo.id === source.id);
  const isNew = existingIndex === -1;

  if (isNew && photos.length >= LIMITS.photosPerInspiration) {
    errors.push({ field: 'photos', code: ERROR_CODES.LIMIT_EXCEEDED });
  }

  throwIfAny(errors);

  // 覆盖时保留原 createdAt：重试是同一张图，创建时间不应被重试时刻改写。
  const entry = isNew
    ? { id: source.id, fileId: source.fileId, createdAt: source.now }
    : { id: source.id, fileId: source.fileId, createdAt: photos[existingIndex].createdAt };
  const nextPhotos = isNew
    ? photos.concat([entry])
    : photos.map((photo, index) => (index === existingIndex ? entry : photo));

  return deepFreeze(Object.assign({}, inspiration, {
    photos: nextPhotos,
    updatedAt: isNew ? source.now : inspiration.updatedAt
  }));
}

/**
 * 把整条灵感标记为「已合并进 targetId」。内容原样保留。
 * 不改变 updatedAt：删除与合并都不是编辑，不应让条目在列表里重新排序。
 *
 * 幂等：已经指向同一个目标时原样返回。
 */
function markMerged(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const errors = [];

  const targetError = checkId(source.targetId, 'mergedInto');
  if (targetError) {
    errors.push(targetError);
  } else if (source.targetId === inspiration.id) {
    errors.push({ field: 'mergedInto', code: ERROR_CODES.MERGE_SELF });
  } else if (inspiration.mergedInto && inspiration.mergedInto !== source.targetId) {
    errors.push({ field: 'mergedInto', code: ERROR_CODES.ALREADY_MERGED });
  }

  const nowError = checkNow(source.now, 'now');
  if (nowError) errors.push(nowError);

  throwIfAny(errors);

  if (inspiration.mergedInto === source.targetId) {
    return inspiration;
  }

  return deepFreeze(Object.assign({}, inspiration, { mergedInto: source.targetId }));
}

/** 取消整条灵感的「已合并」标记，让它重新成为独立灵感。汇总结果不受影响。 */
function unmerge(inspiration) {
  assertInspiration(inspiration);
  if (!inspiration.mergedInto) {
    return inspiration;
  }
  return deepFreeze(Object.assign({}, inspiration, { mergedInto: null }));
}

/**
 * 标记删除。只打标记，不做清理——云端确认后才由服务层移除本机记录。
 * 不改 updatedAt：删除不是编辑，不应让条目在列表里重新排序。
 */
function markDeleted(inspiration, input) {
  assertInspiration(inspiration);
  const source = isPlainObject(input) ? input : {};
  const nowError = checkNow(source.now, 'deletedAt');
  throwIfAny(nowError ? [nowError] : []);

  return deepFreeze(Object.assign({}, inspiration, { deletedAt: source.now }));
}

function isDeleted(inspiration) {
  return Boolean(inspiration && inspiration.deletedAt);
}

function isMerged(inspiration) {
  return Boolean(inspiration && inspiration.mergedInto);
}

/** 时间线上默认展示的那些补充：既没被 AI 汇总合并、也没被合并进灵感的。 */
function activeSupplements(inspiration) {
  return supplementsOf(inspiration).filter((item) => !isSupplementHidden(item));
}

/** 因 AI 汇总而默认收起的补充，展开后可查看与恢复。 */
function mergedSupplements(inspiration) {
  return supplementsOf(inspiration).filter((item) => Boolean(item.mergedInto));
}

/** 因合并进灵感而默认收起的补充，展开后可查看与恢复。 */
function foldedSupplements(inspiration) {
  return supplementsOf(inspiration).filter((item) => Boolean(item.foldedAt));
}

/**
 * 列表展示用：默认排除已合并与已删除的灵感。
 * 已合并的必须另有入口可见、可恢复——**默认隐藏 + 没有入口 = 删除**。
 */
function byUpdatedAtDesc(a, b) {
  return b.updatedAt - a.updatedAt;
}

module.exports = {
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
  byUpdatedAtDesc,
  ID_PATTERN,
  FOLD_SEPARATOR
};
