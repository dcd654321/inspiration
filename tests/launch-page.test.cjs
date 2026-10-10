'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = require.resolve('../miniprogram/pages/launch/index');
function drive() {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  const state = { calls: [] };
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ ensureReady: () => { throw Error('启动页不得阻塞账户读取'); } });
  global.wx = { switchTab: (options) => state.calls.push(options) };
  delete require.cache[file]; require(file);
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(next) { Object.assign(this.data, next); } });
  return { page, state, done() { delete require.cache[file]; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } } };
}
test('可写入口：启动页直接切入记录页，不调用或等待读取账户', () => {
  const ctx = drive(); try { ctx.page.onLoad(); assert.equal(ctx.state.calls.length, 0); ctx.page.onReady(); assert.equal(ctx.state.calls[0].url, '/pages/capture/index'); assert.equal(ctx.page.data.failed, false); } finally { ctx.done(); }
});
test('可写入口：跳转失败有重试且当前页面只触发一次有效跳转', () => {
  const ctx = drive(); try { ctx.page.onLoad(); ctx.page.onReady(); ctx.page.onEnterAnyway(); assert.equal(ctx.state.calls.length, 1); ctx.state.calls[0].fail(); assert.equal(ctx.page.data.failed, true); ctx.page.onRetry(); assert.equal(ctx.state.calls.length, 2); } finally { ctx.done(); }
});
test('可写入口：卸载后的旧跳转失败不更新新状态', () => {
  const ctx = drive(); try { ctx.page.onLoad(); ctx.page.onReady(); ctx.page.onUnload(); ctx.state.calls[0].fail(); assert.equal(ctx.page.data.failed, false); ctx.page.onRetry(); assert.equal(ctx.state.calls.length, 1); } finally { ctx.done(); }
});
test('可写入口：入口配置与私人启动页索引保持一致', () => {
  const root = path.resolve(__dirname, '..');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.equal(app.pages[0], 'pages/launch/index');
  const sitemap = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/sitemap.json'), 'utf8'));
  assert.ok(sitemap.rules.some((rule) => rule.page === 'pages/launch/index' && rule.action === 'disallow'));
});
