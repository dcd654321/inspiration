'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('我的页按用途分组：我的分享 / 数据与隐私 / 意见反馈 / 关于', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  const share = wxml.indexOf('>我的分享</text>');
  const privacy = wxml.indexOf('>数据与隐私</text>');
  const feedback = wxml.indexOf('>意见反馈</text>');
  const about = wxml.indexOf('>关于</text>');
  assert.ok(share >= 0 && privacy > share && feedback > privacy && about > feedback);
  // 「查看我的灵感」是重复入口，已删除；功能本身在 tab 里
  assert.doesNotMatch(wxml, /查看我的灵感/);
  // 「使用帮助」组已按用户 2026-09-30 决定删除：会话级回顾开关与诊断信息对真实用户无用；
  // 回顾的会话内控制保留为列表里的「本次先不看」
  assert.doesNotMatch(wxml, /使用帮助|显示回顾入口|诊断信息|使用统计/);
  assert.doesNotMatch(wxml, /记录状态|recordText|recordError|onRetryRead|backupText|onUseRemote|recoveryItems/);
});

test('我的页反馈入口：「提交反馈」走微信原生通道，自建入口隐藏但方法与页面保留', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  // 按钮就叫「提交反馈」（用户决定，不写「向微信反馈」）；当前接 open-type 原生通道
  assert.match(wxml, /open-type="feedback">提交反馈</);
  assert.doesNotMatch(wxml, /bindtap="onOpenFeedback">提交反馈</);
  const logic = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.js'), 'utf8');
  assert.match(logic, /onOpenFeedback/, '恢复自建入口要用到的方法不应被删');
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
    // 页面本身不再持有回顾或统计状态（对应区块已删除）
    assert.equal(Object.hasOwn(page.data, 'usageAvailable'), false);
    assert.equal(Object.hasOwn(page.data, 'reviewAvailable'), false);
    assert.equal(typeof page.onRetryRead, 'undefined');
    page.onOpenMyShares();
    assert.equal(opened, '/pages/my-shares/index');
    page.onOpenFeedback();
    assert.equal(opened, '/pages/feedback/index');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
