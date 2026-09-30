'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('我的页按用途分组，不再重复列表入口', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  const share = wxml.indexOf('>我的分享</text>');
  const privacy = wxml.indexOf('>数据与隐私</text>');
  const help = wxml.indexOf('>使用帮助</text>');
  const feedback = wxml.indexOf('>意见反馈</text>');
  const about = wxml.indexOf('>关于</text>');
  assert.ok(share >= 0 && privacy > share && help > privacy && feedback > help && about > feedback);
  // 「查看我的灵感」是重复入口，已删除；功能本身在 tab 里
  assert.doesNotMatch(wxml, /查看我的灵感/);
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
    global.wx = { navigateTo: ({ url }) => { opened = url; } };
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
    page.onOpenMyShares();
    assert.equal(opened, '/pages/my-shares/index');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
