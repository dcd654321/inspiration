'use strict';
// 启动过渡页（pages/launch）：冷启动读取云端快照期间的品牌时刻。
// 行为用假 Page/getApp/wx 直接驱动；结构与入口配置按文件断言。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pagePath = require.resolve('../miniprogram/pages/launch/index');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** 用假全局驱动一次页面加载；返回控制对象。测试结束务必调用 done() 清理。 */
function drive({ cloudEnabled = true, ensureReady, refreshAccount, accountError = '' } = {}) {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let opened = '';
  const app = {
    globalData: { cloudEnabled, accountError, store: { ready: true } },
    ensureReady: ensureReady || function () { return Promise.resolve(this.globalData.store); },
    refreshAccount: refreshAccount || function () { return Promise.resolve(this.globalData.store); }
  };
  global.Page = (value) => { definition = value; };
  global.getApp = () => app;
  global.wx = { switchTab: ({ url }) => { opened = url; }, cloud: {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(next) { Object.assign(this.data, next); }
  });
  return {
    definition, page, app,
    opened: () => opened,
    done() {
      if (typeof definition.onUnload === 'function') definition.onUnload.call(page);
      delete require.cache[pagePath];
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete global[key]; else global[key] = value;
      }
    }
  };
}

test('启动页：快照就绪即切入记录页，不额外停留', async () => {
  const ctx = drive();
  try {
    await ctx.definition.onLoad.call(ctx.page);
    assert.strictEqual(ctx.opened(), '/pages/capture/index');
    assert.strictEqual(ctx.page.data.failed, false);
  } finally { ctx.done(); }
});

test('启动页：云能力关闭时直接进入，不空转', async () => {
  let ensureCalled = false;
  const ctx = drive({ cloudEnabled: false, ensureReady() { ensureCalled = true; return Promise.resolve(null); } });
  try {
    await ctx.definition.onLoad.call(ctx.page);
    assert.strictEqual(ctx.opened(), '/pages/capture/index');
    assert.strictEqual(ensureCalled, false, '没有可读的云能力时不应等待读取');
  } finally { ctx.done(); }
});

test('启动页：读取失败给出原因与两条出路，重试成功即进入', async () => {
  const ctx = drive({ ensureReady: async () => null, accountError: '暂时无法确认账户，请联网后重试。' });
  try {
    await ctx.definition.onLoad.call(ctx.page);
    assert.strictEqual(ctx.page.data.failed, true);
    assert.strictEqual(ctx.page.data.error, '暂时无法确认账户，请联网后重试。');
    assert.strictEqual(ctx.opened(), '', '失败时不自动进入，给出选择');
    assert.strictEqual(ctx.page.data.loading, false);

    // 「先进入记录页」：不阻塞在启动页，账户未就绪时文字输入仍可用（既有行为）
    ctx.definition.onEnterAnyway.call(ctx.page);
    assert.strictEqual(ctx.opened(), '/pages/capture/index');
  } finally { ctx.done(); }
});

test('启动页：重试走 refreshAccount，成功后进入记录页', async () => {
  const ctx = drive({ ensureReady: async () => null, accountError: '失败' });
  try {
    await ctx.definition.onLoad.call(ctx.page);
    assert.strictEqual(ctx.page.data.failed, true);

    let refreshed = 0;
    ctx.app.refreshAccount = async () => { refreshed += 1; return ctx.app.globalData.store; };
    await ctx.definition.onRetry.call(ctx.page);
    assert.strictEqual(refreshed, 1);
    assert.strictEqual(ctx.opened(), '/pages/capture/index');
  } finally { ctx.done(); }
});

test('启动页：慢读取露出重试与先进入，不永远转圈', async () => {
  let resolveReady;
  const ctx = drive({ ensureReady: () => new Promise((resolve) => { resolveReady = resolve; }) });
  try {
    const pending = ctx.definition.onLoad.call(ctx.page);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(ctx.page.data.loading, true);
    assert.strictEqual(ctx.page.data.slow, false);

    ctx.definition.markSlow.call(ctx.page);
    assert.strictEqual(ctx.page.data.slow, true, '8 秒后应露出人工出路');

    ctx.definition.onEnterAnyway.call(ctx.page);
    assert.strictEqual(ctx.opened(), '/pages/capture/index');
    resolveReady({ ready: true });
    await pending;
  } finally { ctx.done(); }
});

test('启动页：卸载后迟到结果不落回页面', async () => {
  let resolveReady;
  const ctx = drive({ ensureReady: () => new Promise((resolve) => { resolveReady = resolve; }) });
  try {
    const pending = ctx.definition.onLoad.call(ctx.page);
    ctx.definition.onUnload.call(ctx.page);
    resolveReady({ ready: true });
    await pending;
    assert.strictEqual(ctx.opened(), '', '页面已卸载，不应再跳转');
  } finally { ctx.done(); }
});

test('启动页：入口配置、结构与动效按约定就位', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.strictEqual(app.pages[0], 'pages/launch/index', '启动过渡页必须是小程序默认入口');
  const sitemap = JSON.parse(read('miniprogram/sitemap.json'));
  assert.ok(sitemap.rules.some((rule) => rule.page === 'pages/launch/index' && rule.action === 'disallow'));

  const json = JSON.parse(read('miniprogram/pages/launch/index.json'));
  assert.strictEqual(json.navigationStyle, 'custom', '过渡页没有导航栏，用自定义导航');

  const page = read('miniprogram/pages/launch/index.wxml');
  assert.match(page, /让想法慢慢成形。/);           // 品牌独立句（C01），带句号
  assert.match(page, /正在读取你的灵感…/);          // 进行中用单个「…」
  assert.match(page, /读取还在进行…/);
  assert.match(page, /bindtap="onRetry">重试</);
  assert.match(page, /bindtap="onEnterAnyway">先进入记录页</);
  assert.match(page, /\{\{error\}\}/);

  const styles = read('miniprogram/pages/launch/index.wxss');
  assert.match(styles, /\.launch-spark[\s\S]*?animation:\s*launch-travel/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /font-size:\s*max\(27rpx,\s*14px\)/);

  // 按钮复位包含 .launch，面板外的按钮不会缩成 184px 居中
  const globalStyles = read('miniprogram/app.wxss');
  assert.match(globalStyles, /\.launch button \{/);
});
