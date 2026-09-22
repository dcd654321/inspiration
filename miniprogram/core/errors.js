'use strict';
// 领域层共用的错误码与校验异常。
// 只放本机可判定的校验错误；云端返回的协议错误码属于 server/ 协议层，不在本文件内。
// 错误码值是稳定的字符串常量，会出现在测试断言与降级判断里，不得随意改名。

const ERROR_CODES = {
  // 通用
  INVALID_TYPE: 'INVALID_TYPE',
  MISSING_FIELD: 'MISSING_FIELD',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',

  // 灵感与补充
  EMPTY_TEXT: 'EMPTY_TEXT',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  EMPTY_SUPPLEMENT: 'EMPTY_SUPPLEMENT',
  SUPPLEMENT_TOO_LONG: 'SUPPLEMENT_TOO_LONG',
  INVALID_SOURCE: 'INVALID_SOURCE',

  // 标识与时间
  INVALID_ID: 'INVALID_ID',
  INVALID_NOW: 'INVALID_NOW',

  // 原文历史
  EMPTY_HISTORY_ID: 'EMPTY_HISTORY_ID',
  DUPLICATE_HISTORY_ID: 'DUPLICATE_HISTORY_ID',

  // 汇总与已合并
  MERGE_SELF: 'MERGE_SELF',
  SUPPLEMENT_NOT_FOUND: 'SUPPLEMENT_NOT_FOUND',
  ALREADY_MERGED: 'ALREADY_MERGED',
  ALREADY_FOLDED: 'ALREADY_FOLDED',
  INVALID_MERGE_MODE: 'INVALID_MERGE_MODE',

  // 图片
  INVALID_FILE_ID: 'INVALID_FILE_ID',

  // AI 输出契约
  MISSING_SECTION: 'MISSING_SECTION',
  TOO_FEW_ITEMS: 'TOO_FEW_ITEMS',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  EMPTY_ITEM: 'EMPTY_ITEM',
  ITEM_TOO_LONG: 'ITEM_TOO_LONG',
  UNSAFE_CONTENT: 'UNSAFE_CONTENT'
};

// 校验错误文案。界面可直接展示，因此不使用「参数非法」这类只有开发者能读懂的措辞。
const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_TYPE]: '内容格式不正确',
  [ERROR_CODES.MISSING_FIELD]: '缺少必要内容',
  [ERROR_CODES.LIMIT_EXCEEDED]: '已超出上限',
  [ERROR_CODES.EMPTY_TEXT]: '先写点什么再保存',
  [ERROR_CODES.TEXT_TOO_LONG]: '正文超出字数上限',
  [ERROR_CODES.EMPTY_SUPPLEMENT]: '补充内容不能为空',
  [ERROR_CODES.SUPPLEMENT_TOO_LONG]: '补充内容超出字数上限',
  [ERROR_CODES.INVALID_SOURCE]: '补充来源不正确',
  [ERROR_CODES.INVALID_ID]: '标识格式不正确',
  [ERROR_CODES.INVALID_NOW]: '时间戳不正确',
  [ERROR_CODES.EMPTY_HISTORY_ID]: '缺少原文历史标识',
  [ERROR_CODES.DUPLICATE_HISTORY_ID]: '原文历史标识重复',
  [ERROR_CODES.MERGE_SELF]: '不能合并到自身',
  [ERROR_CODES.SUPPLEMENT_NOT_FOUND]: '找不到要合并的补充',
  [ERROR_CODES.ALREADY_MERGED]: '这条内容已经合并过了',
  [ERROR_CODES.ALREADY_FOLDED]: '这条补充已经合并进灵感了',
  [ERROR_CODES.INVALID_MERGE_MODE]: '汇总的写入方式不正确',
  [ERROR_CODES.INVALID_FILE_ID]: '图片标识不正确',
  [ERROR_CODES.MISSING_SECTION]: 'AI 返回的内容不完整',
  [ERROR_CODES.TOO_FEW_ITEMS]: 'AI 返回的内容过少',
  [ERROR_CODES.TOO_MANY_ITEMS]: 'AI 返回的内容过多',
  [ERROR_CODES.EMPTY_ITEM]: 'AI 返回的内容存在空项',
  [ERROR_CODES.ITEM_TOO_LONG]: 'AI 返回的内容存在超长项',
  [ERROR_CODES.UNSAFE_CONTENT]: 'AI 返回的内容不适合展示'
};

function describe(errors) {
  return errors.map((e) => ERROR_MESSAGES[e.code] || e.code).join('；');
}

// 领域校验失败的统一异常。
// errors 为 [{ field, code }]，field 用来定位是哪一项输入不合法。
class ValidationError extends Error {
  constructor(errors, message) {
    const list = Array.isArray(errors) ? errors : [{ field: '', code: String(errors) }];
    super(message || describe(list));
    this.name = 'ValidationError';
    this.errors = list;
    this.code = list.length > 0 ? list[0].code : ERROR_CODES.INVALID_TYPE;
  }
}

module.exports = { ERROR_CODES, ERROR_MESSAGES, ValidationError };
