'use strict';
// 设计契约守卫。
//
// 前两道闸门守的是「规范」和「措辞」。这一道守的是**详设与数据库设计**：
// 文档里写的模块签名、取值边界、字段清单，必须和代码里实际的一致。
//
// 没有这道闸门时发生过什么：`core/limits.js` 有 15 个键，详设 §7.3 只记了 5 个；
// 其中 4 个还是同一轮里新加的——**加了代码忘了改文档，没有任何东西会响。**
//
// 各处的字段清单由代码侧驱动：调用真实的构造函数，比对它实际产出的字段，
// 而不是去解析源码。这样重命名、增删字段都会立刻暴露。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DETAILED = path.join(root, 'docs/detailed-design.md');
const DATABASE = path.join(root, 'docs/database-design.md');

const inspiration = require('../miniprogram/core/inspiration');
const store = require('../miniprogram/services/store');
const captureDrafts = require('../miniprogram/services/capture-drafts');
const wxStorage = require('../miniprogram/services/wx-storage');
const wxTransport = require('../miniprogram/services/wx-transport');
const format = require('../miniprogram/core/format');
const merge = require('../miniprogram/core/merge');
const photo = require('../miniprogram/services/photo');
const upload = require('../miniprogram/services/upload');
const ai = require('../miniprogram/services/ai');
const repository = require('../server/repository');
const protocol = require('../server/protocol');
const { LIMITS } = require('../miniprogram/core/limits');

/** 取出一段章节内容。找不到起点直接报错——静默返回空串会让闸门变成摆设。 */
function section(text, startMarker, endMarker) {
  const from = text.indexOf(startMarker);
  assert.ok(from !== -1, `在文档里找不到章节「${startMarker}」——章节标题改了就要同步这里`);
  const rest = text.slice(from + startMarker.length);
  const to = endMarker ? rest.indexOf(endMarker) : -1;
  return to === -1 ? rest : rest.slice(0, to);
}

/** 取出 markdown 表格第一列里的反引号标识符。 */
function firstColumnNames(sectionText) {
  const names = [];
  for (const line of sectionText.split('\n')) {
    const m = line.match(/^\|\s*`([A-Za-z0-9_[\]-]+)`\s*\|/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 取出文档里列出的、且没标「不写入」的字段名。 */
function documentedFields(sectionText) {
  const names = [];
  for (const line of sectionText.split('\n')) {
    const m = line.match(/^\|\s*`([A-Za-z0-9_]+)`\s*\|(.+)$/);
    if (!m) continue;
    if (line.indexOf('不写入') !== -1) continue;  // 明确标注本变更不写入的字段，代码里不该有
    names.push(m[1]);
  }
  return names;
}

function diff(actual, documented) {
  return {
    missingInDoc: actual.filter((x) => documented.indexOf(x) === -1),
    missingInCode: documented.filter((x) => actual.indexOf(x) === -1)
  };
}

// ---------------------------------------------------------------- 详设 §7.1 模块签名

test('core/inspiration.js 的导出与详设 §7.1 一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.1 `core/inspiration.js`',
    '约束：'
  );

  // 从代码块里取形如 `name(...)` 的函数名
  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(inspiration).filter((k) => typeof inspiration[k] === 'function');

  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(
    missingInCode, [],
    `详设 §7.1 列了这些函数，但 core/inspiration.js 没有导出：\n  ${missingInCode.join('\n  ')}`
  );
  assert.deepStrictEqual(
    missingInDoc, [],
    `core/inspiration.js 导出了这些函数，但详设 §7.1 没记。改了签名或加了函数就要同步文档：\n  ${missingInDoc.join('\n  ')}`
  );
});

// ---------------------------------------------------------------- 详设 §7.3 取值边界

test('core/limits.js 的键与详设 §7.3 的清单一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.3 `core/errors.js` 与 `core/limits.js`',
    '### 7.4'
  );

  const documented = firstColumnNames(section(doc, '| 键 | 值 | 来源 | 用途 |', '**最后四项'));
  const actual = Object.keys(LIMITS);

  const { missingInDoc, missingInCode } = diff(actual, documented);

  assert.deepStrictEqual(
    missingInCode, [],
    `详设 §7.3 记了这些取值，但 core/limits.js 里没有：\n  ${missingInCode.join('\n  ')}`
  );
  assert.deepStrictEqual(
    missingInDoc, [],
    `core/limits.js 里有这些取值，但详设 §7.3 没记。加取值就要同步这张表：\n  ${missingInDoc.join('\n  ')}`
  );
});

// ---------------------------------------------------------------- 详设 §7.5 服务层

test('services/store.js 的导出与详设 §7.5 一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.5 `services/store.js`',
    '`Store` 实例上的方法：'
  );

  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(store).filter((k) => typeof store[k] === 'function');

  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(
    missingInCode, [],
    `详设 §7.5 列了这些导出，但 services/store.js 没有：\n  ${missingInCode.join('\n  ')}`
  );
  assert.deepStrictEqual(
    missingInDoc, [],
    `services/store.js 导出了这些，但详设 §7.5 没记。改了接口就要同步文档：\n  ${missingInDoc.join('\n  ')}`
  );
});

test('services/capture-drafts.js 的导出与详设 §7.6 一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.6 `services/capture-drafts.js`',
    'Drafts 实例上的方法'
  );

  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(captureDrafts).filter((k) => typeof captureDrafts[k] === 'function');

  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(
    missingInCode, [],
    `详设 §7.6 列了这些导出，但 services/capture-drafts.js 没有：\n  ${missingInCode.join('\n  ')}`
  );
  assert.deepStrictEqual(
    missingInDoc, [],
    `services/capture-drafts.js 导出了这些，但详设 §7.6 没记：\n  ${missingInDoc.join('\n  ')}`
  );
});

test('services/wx-storage.js 的导出与详设 §7.7 一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.7 `services/wx-storage.js`',
    'Storage 实例上的方法'
  );

  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(wxStorage).filter((k) => typeof wxStorage[k] === 'function');

  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(missingInCode, [], `详设 §7.7 列了但代码没有：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `代码导出了但详设 §7.7 没记：\n  ${missingInDoc.join('\n  ')}`);
});

test('core/format.js 的导出与详设 §7.8 一致', () => {
  const doc = section(
    fs.readFileSync(DETAILED, 'utf8'),
    '### 7.8 `core/format.js`',
    '按经过时间分桶'
  );

  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(format).filter((k) => typeof format[k] === 'function');

  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(missingInCode, [], `详设 §7.8 列了但代码没有：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `代码导出了但详设 §7.8 没记：\n  ${missingInDoc.join('\n  ')}`);
});

// ---------------------------------------------------------------- 详设 §7.9—§7.14

/** §7.9 之后每一节的核对长得一样，抽出来避免抄六遍。 */
function assertExportsMatch(startMarker, endMarker, mod, label) {
  const doc = section(fs.readFileSync(DETAILED, 'utf8'), startMarker, endMarker);
  const documented = [...doc.matchAll(/^([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  const actualFunctions = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
  const { missingInDoc, missingInCode } = diff(actualFunctions, documented);

  assert.deepStrictEqual(missingInCode, [], `${label}：文档列了但代码没有：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `${label}：代码导出了但文档没记：\n  ${missingInDoc.join('\n  ')}`);
}

test('core/merge.js 的导出与详设 §7.9 一致', () => {
  assertExportsMatch('### 7.9 `core/merge.js`', '### 7.10', merge, '详设 §7.9');
});

// 每节都分「模块级导出」与「实例方法」两段代码块，只核对前一段——
// 实例方法是方法，不是模块导出，混在一起会让闸门报假警。
test('services/photo.js 的导出与详设 §7.10 一致', () => {
  assertExportsMatch('### 7.10 `services/photo.js`', 'PhotoService 实例上的方法', photo, '详设 §7.10');
});

test('services/upload.js 的导出与详设 §7.11 一致', () => {
  assertExportsMatch('### 7.11 `services/upload.js`', 'Uploader 实例上的方法', upload, '详设 §7.11');
});

test('services/ai.js 的导出与详设 §7.12 一致', () => {
  assertExportsMatch('### 7.12 `services/ai.js`', 'AiService 实例上的方法', ai, '详设 §7.12');
});

test('server/repository.js 的导出与详设 §7.13 一致', () => {
  assertExportsMatch('### 7.13 `server/repository.js`', 'Repository 实例上的方法', repository, '详设 §7.13');
});

test('server/protocol.js 的导出与详设 §7.14 一致', () => {
  assertExportsMatch('### 7.14 `server/protocol.js`', 'Protocol 实例上的方法', protocol, '详设 §7.14');
});

test('services/wx-transport.js 的导出与详设 §7.15 一致', () => {
  assertExportsMatch('### 7.15 `services/wx-transport.js`', 'Transport 实例上的方法', wxTransport, '详设 §7.15');
});

// ---------------------------------------------------------------- 数据库设计字段

test('createInspiration 产出的字段与数据库设计 §3.2 一致', () => {
  const doc = section(
    fs.readFileSync(DATABASE, 'utf8'),
    '### 3.2 `inspirations[]` 元素',
    '### 3.3'
  );

  const documented = documentedFields(doc);
  const actual = Object.keys(inspiration.createInspiration({
    text: '字段契约核对', id: 'insp_contract', now: 1758500000000
  }));

  const { missingInDoc, missingInCode } = diff(actual, documented);

  assert.deepStrictEqual(
    missingInCode, [],
    `数据库设计 §3.2 记了这些字段，但 createInspiration 不产出：\n  ${missingInCode.join('\n  ')}`
  );
  assert.deepStrictEqual(
    missingInDoc, [],
    `createInspiration 产出了这些字段，但数据库设计 §3.2 没记：\n  ${missingInDoc.join('\n  ')}`
  );
});

test('textHistory 条目的字段与数据库设计 §3.3 一致', () => {
  const doc = section(
    fs.readFileSync(DATABASE, 'utf8'),
    '### 3.3 `textHistory[]` 元素',
    '### 3.4'
  );

  const base = inspiration.createInspiration({ text: '第一版', id: 'insp_contract', now: 1758500000000 });
  const edited = inspiration.updateText(base, { text: '第二版', historyId: 'tex_1', now: 1758500000001 });

  const documented = documentedFields(doc);
  const actual = Object.keys(edited.textHistory[0]);

  const { missingInDoc, missingInCode } = diff(actual, documented);

  assert.deepStrictEqual(missingInCode, [], `§3.3 记了但代码不产出：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `代码产出了但 §3.3 没记：\n  ${missingInDoc.join('\n  ')}`);
});

test('supplements 条目的字段与数据库设计 §3.4 一致', () => {
  const doc = section(
    fs.readFileSync(DATABASE, 'utf8'),
    '### 3.4 `supplements[]` 元素',
    '### 3.5'
  );

  const base = inspiration.createInspiration({ text: '字段契约核对', id: 'insp_contract', now: 1758500000000 });
  const withOne = inspiration.appendSupplement(base, {
    content: '一条补充', id: 'sup_1', now: 1758500000001
  });

  const documented = documentedFields(doc);
  const actual = Object.keys(withOne.supplements[0]);

  const { missingInDoc, missingInCode } = diff(actual, documented);

  assert.deepStrictEqual(missingInCode, [], `§3.4 记了但代码不产出：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `代码产出了但 §3.4 没记：\n  ${missingInDoc.join('\n  ')}`);
});

test('photos 条目的字段与数据库设计 §3.5 一致', () => {
  const doc = section(
    fs.readFileSync(DATABASE, 'utf8'),
    '### 3.5 `photos[]` 元素',
    '## 4.'
  );

  const base = inspiration.createInspiration({ text: '字段契约核对', id: 'insp_contract', now: 1758500000000 });
  const withPhoto = inspiration.appendPhoto(base, {
    id: 'pho_1', fileId: 'cloud://contract', now: 1758500000001
  });

  const documented = documentedFields(doc);
  const actual = Object.keys(withPhoto.photos[0]);

  const { missingInDoc, missingInCode } = diff(actual, documented);

  assert.deepStrictEqual(missingInCode, [], `§3.5 记了但代码不产出：\n  ${missingInCode.join('\n  ')}`);
  assert.deepStrictEqual(missingInDoc, [], `代码产出了但 §3.5 没记：\n  ${missingInDoc.join('\n  ')}`);
});

// ---------------------------------------------------------------- 闸门自身

test('设计契约闸门能读到东西', () => {
  assert.ok(fs.existsSync(DETAILED), '找不到 docs/detailed-design.md');
  assert.ok(fs.existsSync(DATABASE), '找不到 docs/database-design.md');
  assert.ok(Object.keys(LIMITS).length > 0, 'LIMITS 是空的');
  assert.ok(
    Object.keys(inspiration).filter((k) => typeof inspiration[k] === 'function').length > 0,
    'core/inspiration.js 没有导出任何函数'
  );
});
