'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('我的页以可操作内容开头，不展示读取或备份状态卡', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  const use = wxml.indexOf('从记录到使用');
  const share = wxml.indexOf('>分享</text>');
  const privacy = wxml.indexOf('数据与隐私');
  assert.ok(use >= 0 && share > use && privacy > share);
  assert.doesNotMatch(wxml, /记录状态|recordText|recordError|onRetryRead|backupText|onUseRemote|recoveryItems/);
});

test('我的页不因账户读取失败生成无用状态，其他入口仍可使用', async () => {
  const pagePath = require.resolve('../miniprogram/pages/mine/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let opened = '';
  const app = { globalData: { metrics: null }, ensureReady: async () => null };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = { switchTab: ({ url }) => { opened = url; } };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onShow();
    assert.equal(Object.hasOwn(page.data, 'recordText'), false);
    assert.equal(typeof page.onRetryRead, 'undefined');
    assert.equal(page.data.usageAvailable, false);
    page.onOpenList();
    assert.equal(opened, '/pages/list/index');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
