'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('我的页按用途分组：一起进步 / 数据与支持，说明与反馈入口可达', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  const share = wxml.indexOf('一起进步');
  const support = wxml.indexOf('数据与支持');
  const privacy = wxml.indexOf('数据与隐私');
  const help = wxml.indexOf('>使用帮助</text>');
  const feedback = wxml.indexOf('>意见与问题反馈</text>');
  assert.ok(share >= 0 && support > share && privacy > support && help > privacy && feedback > help);
  assert.match(wxml, /bindtap="onToggleInfo"[^>]*data-section="privacy"|data-section="privacy"[^>]*bindtap="onToggleInfo"/);
  assert.match(wxml, /bindtap="onToggleInfo"[^>]*data-section="help"|data-section="help"[^>]*bindtap="onToggleInfo"/);
  // 「查看我的灵感」是重复入口，已删除；功能本身在 tab 里
  assert.doesNotMatch(wxml, /查看我的灵感/);
  // 产品说明不恢复旧诊断信息、统计或会话级回顾开关。
  assert.doesNotMatch(wxml, /显示回顾入口|诊断信息|使用统计/);
  assert.doesNotMatch(wxml, /记录状态|recordText|recordError|onRetryRead|backupText|onUseRemote|recoveryItems/);
});

test('我的页反馈入口：「意见与问题反馈」走微信原生通道，自建入口隐藏但方法与页面保留', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  assert.match(wxml, /open-type="feedback"[^>]*>[\s\S]*?<text class="menu-label">意见与问题反馈<\/text>/);
  assert.equal((wxml.match(/open-type="feedback"/g) || []).length, 1);
  assert.doesNotMatch(wxml, /bindtap="onOpenFeedback"/);
  const logic = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.js'), 'utf8');
  assert.match(logic, /onOpenFeedback/, '恢复自建入口要用到的方法不应被删');
});

test('我的页说明展开与入口导航不依赖账户读取，不生成无用状态', async () => {
  const pagePath = require.resolve('../miniprogram/pages/mine/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let opened = '';
  let accountReads = 0;
  const app = { globalData: { metrics: null }, ensureReady: async () => { accountReads++; return null; } };
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
    const toggle = (section) => page.onToggleInfo({ currentTarget: { dataset: { section } } });
    assert.equal(page.data.expandedInfo, '');
    toggle('privacy');
    assert.equal(page.data.expandedInfo, 'privacy');
    toggle('help');
    assert.equal(page.data.expandedInfo, 'help', '切换说明只展开新项');
    toggle('help');
    assert.equal(page.data.expandedInfo, '', '再次点击同项收起说明');
    toggle('privacy');
    toggle('unknown');
    assert.equal(page.data.expandedInfo, 'privacy', '非法项不改变已展开说明');
    toggle('privacy');
    assert.equal(page.data.expandedInfo, '');
    page.onOpenMyShares();
    assert.equal(opened, '/pages/my-shares/index');
    page.onOpenFeedback();
    assert.equal(opened, '/pages/feedback/index');
    assert.equal(accountReads, 0, '说明与导航不应读取账户');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
