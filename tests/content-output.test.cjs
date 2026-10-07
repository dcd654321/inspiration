'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { currentSupplements, buildUseText, buildArchiveText } = require('../miniprogram/services/content-output');

function sample() {
  return {
    id: 'ins_sample',
    text: '当前正文',
    textHistory: [{ id: 'tex_1', text: '旧正文', replacedAt: 2000 }],
    createdAt: 1000,
    updatedAt: 4000,
    supplements: [
      { id: 'sup_b', content: '第二条补充', createdAt: 3000, source: 'ai', mergedInto: null, foldedAt: null, contentHistory: [] },
      { id: 'sup_a', content: '第一条补充', createdAt: 2000, mergedInto: null, foldedAt: null,
        contentHistory: [{ id: 'chg_1', text: '第一条旧稿', replacedAt: 2500 }] },
      { id: 'sup_fold', content: '已并入正文的内容', createdAt: 1500, mergedInto: null, foldedAt: 3200, contentHistory: [] },
      { id: 'sup_merge', content: '已合并的内容', createdAt: 3500, mergedInto: 'sup_b', foldedAt: null, contentHistory: [] }
    ],
    photos: []
  };
}

test('复制正文与当前补充：按时间排列且不重复已收起内容', () => {
  const item = sample();
  assert.deepStrictEqual(currentSupplements(item).map((entry) => entry.id), ['sup_a', 'sup_b']);
  assert.strictEqual(buildUseText(item), '当前正文\n\n第一条补充\n\n第二条补充');
  assert.strictEqual(buildUseText(item, []), '当前正文');
});

test('选择补充生成使用稿：只带选中项且不修改来源', () => {
  const item = sample();
  const before = JSON.stringify(item);
  assert.strictEqual(buildUseText(item, ['sup_b', 'sup_fold']), '当前正文\n\n第二条补充');
  assert.strictEqual(JSON.stringify(item), before);
});

test('留档包含现存正文、历史、时间及收起状态，不包含照片', () => {
  const archive = buildArchiveText(sample(), 5000);
  for (const phrase of ['当前正文', '旧正文', '第一条补充', '第一条旧稿', 'AI 生成', '已并入正文', '已合并']) {
    assert.ok(archive.includes(phrase), `留档缺少 ${phrase}`);
  }
  assert.ok(archive.includes('生成时间：'));
  assert.ok(archive.includes('修改记录：'));
  assert.ok(!archive.includes('photos'));
});

test('输出页可选择、编辑、复制，并另存独立灵感', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let saved;
  let clipboard = '';
  const original = sample();

  try {
    global.Page = (page) => { definition = page; };
    const app = { ensureReady() { return Promise.resolve(this.globalData.store); }, globalData: { store: {
      getInspiration: () => original,
      async saveInspiration(item) { saved = item; return { ok: true, synced: true }; }
    } } };
    global.getApp = () => app;
    global.wx = {
      setClipboardData({ data, success }) { clipboard = data; success(); },
      navigateTo() {}
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });

    await page.onLoad({ id: original.id });
    assert.strictEqual(page.data.options.length, 2);
    // 进入即有可编辑的自由稿，补充默认全选——看结果不必先做选择
    assert.strictEqual(page.data.draft, '当前正文\n\n第一条补充\n\n第二条补充');
    assert.strictEqual(page.data.summary, '正文 + 2条补充');
    page.onToggleSupplement({ currentTarget: { dataset: { id: 'sup_a' } } });
    page.onApply();
    // 未编辑过：应用选择直接替换，不走确认
    assert.strictEqual(page.data.draft, '当前正文\n\n第二条补充');
    assert.strictEqual(page.data.summary, '正文 + 1条补充');
    page.onDraftInput({ detail: { value: '整理后的可用文字' } });
    page.onCopyDraft();
    assert.strictEqual(clipboard, '整理后的可用文字');
    await page.onSaveAsNew();
    assert.ok(saved && saved.id !== original.id);
    assert.strictEqual(saved.text, '整理后的可用文字');
    assert.strictEqual(original.text, '当前正文');
    assert.strictEqual(page.data.savedId, saved.id);
    assert.strictEqual(page.data.notice, '已另存为新灵感');
    // 同一稿件重复点击不得新增第二条
    const firstSaved = saved;
    await page.onSaveAsNew();
    assert.strictEqual(saved, firstSaved);
    assert.strictEqual(page.data.notice, '这份稿件已另存，可以直接查看。');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('使用稿超长或保存失败时不截断内容，也不报告另存成功', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let attempts = 0;
  let confirmed = false;
  const attemptedIds = [];
  try {
    global.Page = (page) => { definition = page; };
    const store = {
      getInspiration: sample,
      async saveInspiration(value) { attempts += 1; attemptedIds.push(value.id); return confirmed ? { ok: true, synced: true } : { ok: false }; }
    };
    const app = { ensureReady: async () => store, globalData: { store } };
    global.getApp = () => app;
    global.wx = {};
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: 'ins_sample' });
    const tooLong = '长'.repeat(2001);
    page.setData({ draft: tooLong });
    await page.onSaveAsNew();
    assert.strictEqual(attempts, 0);
    assert.strictEqual(page.data.draft, tooLong);
    page.setData({ draft: '短稿' });
    await page.onSaveAsNew();
    assert.strictEqual(attempts, 1);
    assert.strictEqual(page.data.savedId, '');
    assert.strictEqual(page.data.draft, '短稿');
    confirmed = true;
    await page.onSaveAsNew();
    assert.strictEqual(attemptedIds[0], attemptedIds[1], '同一稿件重试应复用会话内标识');
    assert.strictEqual(page.data.savedId, attemptedIds[1]);
    await page.onSaveAsNew();
    assert.strictEqual(attempts, 2, '确认成功后不重复另存同一稿件');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('复制失败与 TXT 生成失败均保留页面内容和可复制入口', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  try {
    global.Page = (page) => { definition = page; };
    const app = { ensureReady() { return Promise.resolve(this.globalData.store); }, globalData: { store: { getInspiration: sample } } };
    global.getApp = () => app;
    global.wx = {
      env: { USER_DATA_PATH: '/mock' },
      setClipboardData({ fail }) { fail(); },
      getFileSystemManager() { return { writeFile({ fail }) { fail(); } }; },
      openDocument() {}
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: 'ins_sample' });
    page.onCopyArchive();
    assert.match(page.data.error, /复制未完成/);
    page.onCreateTxt();
    assert.match(page.data.error, /文件生成失败/);
    assert.ok(page.data.archive.includes('当前正文'));
    assert.strictEqual(page.data.busy, false);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('TXT 只在主动点击后生成，再次点击才请求发送，离开页面清理临时文件', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let written;
  let sent;
  let removed;
  try {
    global.Page = (page) => { definition = page; };
    const app = { ensureReady() { return Promise.resolve(this.globalData.store); }, globalData: { store: { getInspiration: sample } } };
    global.getApp = () => app;
    global.wx = {
      env: { USER_DATA_PATH: '/mock' },
      getFileSystemManager() { return {
        writeFile(options) { written = options; options.success(); },
        unlink(options) { removed = options.filePath; }
      }; },
      shareFileMessage(options) { sent = options; options.success(); }
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: 'ins_sample' });
    assert.strictEqual(written, undefined);
    assert.strictEqual(sent, undefined);
    page.onCreateTxt();
    assert.ok(written.filePath.endsWith('.txt'));
    assert.strictEqual(written.encoding, 'utf8');
    assert.strictEqual(written.data, page.data.archive);
    assert.strictEqual(sent, undefined);
    page.onShareTxt();
    assert.strictEqual(sent.filePath, written.filePath);
    assert.match(page.data.notice, /已发送/);
    page.onUnload();
    assert.strictEqual(removed, written.filePath);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('详情页可分别复制正文、正文与补充、单条补充，原记录不变', async () => {
  const pagePath = require.resolve('../miniprogram/pages/detail/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let actionSheet;
  const copied = [];
  const original = sample();
  const store = { getInspiration: () => original };
  const app = { globalData: { store, sessionEpoch: 1 }, ensureReady: async () => store };
  try {
    global.Page = (page) => { definition = page; };
    global.getApp = () => app;
    global.wx = {
      showActionSheet(options) { actionSheet = options; },
      setClipboardData(options) { copied.push(options.data); options.success(); },
      showToast() {}
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      id: original.id,
      data: Object.assign({}, definition.data, {
        supplements: [{ id: 'sup_a', content: '第一条补充' }],
        sheetTargetId: 'sup_a'
      }),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: original.id });
    page.onCopyContent();
    actionSheet.success({ tapIndex: 0 });
    page.onCopyContent();
    actionSheet.success({ tapIndex: 1 });
    page.onSheetCopy();
    assert.deepStrictEqual(copied, [
      '当前正文',
      '当前正文\n\n第一条补充\n\n第二条补充',
      '第一条补充'
    ]);
    assert.strictEqual(original.text, '当前正文');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('发送 TXT 取消或失败时不报告已发送', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  try {
    global.Page = (page) => { definition = page; };
    const app = { ensureReady() { return Promise.resolve(this.globalData.store); }, globalData: { store: { getInspiration: sample } } };
    global.getApp = () => app;
    global.wx = { shareFileMessage({ fail }) { fail({ errMsg: 'cancel' }); } };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data, { txtPath: '/mock/archive.txt' }),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: 'ins_sample' });
    page.setData({ txtPath: '/mock/archive.txt' });
    page.onShareTxt();
    assert.match(page.data.error, /未发送/);
    assert.ok(!page.data.notice.includes('已发送'));
    assert.strictEqual(page.data.busy, false);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('写 TXT 时离开页面仍会在写入完成后清理临时文件', async () => {
  const pagePath = require.resolve('../miniprogram/pages/output/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let completion;
  let removed;
  try {
    global.Page = (page) => { definition = page; };
    const app = { ensureReady() { return Promise.resolve(this.globalData.store); }, globalData: { store: { getInspiration: sample } } };
    global.getApp = () => app;
    global.wx = {
      env: { USER_DATA_PATH: '/mock' },
      getFileSystemManager() { return {
        writeFile(options) { completion = options; },
        unlink(options) { removed = options.filePath; }
      }; }
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onLoad({ id: 'ins_sample' });
    page.onCreateTxt();
    page.onUnload();
    completion.success();
    assert.strictEqual(removed, completion.filePath);
    assert.strictEqual(page.data.txtPath, '');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('详情页提供三种复制路径和整理入口', () => {
  const detail = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/detail/index.wxml'), 'utf8');
  const output = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/output/index.wxml'), 'utf8');
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  // 复制全文（可选范围）在「更多」面板里，单条补充复制在操作面板里
  assert.match(detail, /bindtap="onMoreCopy"/);
  assert.match(detail, /bindtap="onSheetCopy"/);
  assert.match(detail, /bindtap="onOpenOutput"/);
  assert.match(output, /bindtap="onCopyDraft"/);
  assert.match(output, /bindtap="onCopyArchive"/);
  assert.match(output, /bindtap="onCreateTxt"/);
  assert.match(output, /bindtap="onShareTxt"/);
  assert.ok(app.pages.includes('pages/output/index'));
});

test('私人页面不被小程序页面索引', () => {
  const sitemap = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/sitemap.json'), 'utf8'));
  for (const page of ['pages/list/index', 'pages/detail/index', 'pages/history/index', 'pages/output/index']) {
    assert.ok(sitemap.rules.some((rule) => rule.page === page && rule.action === 'disallow'), `${page} 未禁止收录`);
  }
});
