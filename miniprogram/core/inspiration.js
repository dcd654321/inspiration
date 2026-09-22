'use strict';
// 灵感领域模型。
//
// 三条硬约束，改动前请先确认规范是否也跟着改了：
//   1. 纯函数：不读写存储、不调用 wx API、**不自行取当前时间**。所有时间由调用方
//      经 now 注入，否则同一份数据在不同时刻会得到不同结果，测试无法稳定断言。
//   2. 原始正文不可改写：本模块不导出任何改写 text 的函数，追加一律产生新对象。
//      对应 core/ai-contract.js 之外的规范「原始记录不可改写」。
//   3. 返回的对象是冻结的：运行时改不动，而不是只靠约定。
//
// 标识（id）由调用方生成并传入，本模块不生成——生成要用 Date.now() 与随机数，
// 会把不确定性带进纯函数。生成入口在 core/limits.js 的 createId。

const { LIMITS } = require('./limits');
const { ERROR_CODES, ValidationError } = require('./errors');

// 标识字符集刻意收窄：标识会参与云存储路径拼接
// （linggan/{accountKey}/{inspirationId}/{photoId}），放行 `/`、`\`、`.` 会带来越权拼接风险。
const ID_PATTERN = new RegExp('^[A-Za-z0-9_]{1,' + LIMITS.idMaxLength + '}$');

const SUPPLEMENT_SOURCES = ['user', 'ai'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isValidTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// 深冻结：只冻结外层的话，补充数组仍可被 push，不可变约束就不成立。
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
 * 创建一条灵感。创建成功即代表原始正文定稿，此后不可改写。
 */
function createInspiration(input) {
  const result = validateInspiration(input);
  throwIfAny(result.errors);

  const { text, id, now } = input;
  return deepFreeze({
    id,
    text,
    createdAt: now,
    updatedAt: now,
    supplements: [],
    photos: [],
    deletedAt: null
  });
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
    createdAt: source.now,
    // 来源默认 user；AI 产出必须显式传 'ai'，界面据此标注，不得把本地结果说成 AI 生成。
    source: source.source === undefined ? 'user' : source.source
  };

  return deepFreeze(Object.assign({}, inspiration, {
    supplements: inspiration.supplements.concat([entry]),
    updatedAt: source.now
  }));
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

  const existingIndex = inspiration.photos.findIndex((photo) => photo.id === source.id);
  const isNew = existingIndex === -1;

  if (isNew && inspiration.photos.length >= LIMITS.photosPerInspiration) {
    errors.push({ field: 'photos', code: ERROR_CODES.LIMIT_EXCEEDED });
  }

  throwIfAny(errors);

  // 覆盖时保留原 createdAt：重试是同一张图，创建时间不应被重试时刻改写。
  const entry = isNew
    ? { id: source.id, fileId: source.fileId, createdAt: source.now }
    : { id: source.id, fileId: source.fileId, createdAt: inspiration.photos[existingIndex].createdAt };
  const photos = isNew
    ? inspiration.photos.concat([entry])
    : inspiration.photos.map((photo, index) => (index === existingIndex ? entry : photo));

  return deepFreeze(Object.assign({}, inspiration, {
    photos,
    updatedAt: isNew ? source.now : inspiration.updatedAt
  }));
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

/** 列表排序依据：按最近更新时间倒序，最近有补充的排在前面。 */
function byUpdatedAtDesc(a, b) {
  return b.updatedAt - a.updatedAt;
}

module.exports = {
  createInspiration,
  validateInspiration,
  appendSupplement,
  appendPhoto,
  markDeleted,
  isDeleted,
  byUpdatedAtDesc,
  ID_PATTERN
};
