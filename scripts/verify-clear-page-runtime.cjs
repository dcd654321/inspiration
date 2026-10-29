'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const automator = require('D:/codex/tmp/jiancheng-design-audit-runtime/node_modules/miniprogram-automator');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/audits/2026-10-28-clear-page');
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { date: '2026-10-28', checkedAtUtc: new Date().toISOString(), synthetic: true, cloudCalls: false,
  realPhotoUpload: false, deviceAcceptance: false, states: [], exceptions: [] };
const save = () => fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9468' });
  mp.on('exception', event => report.exceptions.push(String(event)));
  const capture = async name => {
    await pause(300);
    const page = await mp.currentPage();
    const layout = await mp.evaluate(() => new Promise(resolve => {
      const query = wx.createSelectorQuery();
      query.selectAll('button').fields({ size: true, rect: true, computedStyle: ['font-size', 'color', 'background-color'] });
      query.select('.page').boundingClientRect();
      query.select('textarea').boundingClientRect();
      query.exec(values => resolve({ window: wx.getWindowInfo(), buttons: values[0], page: values[1], editor: values[2] }));
    }));
    const data = await page.data();
    const state = { name, route: page.path, layout, state: {
      ready: data.ready, status: data.status, draft: data.draft, todoEnabled: data.todoEnabled,
      lastSaved: Boolean(data.lastSavedId), items: data.items && data.items.length,
      photos: data.photos && data.photos.map(photo => ({ id: photo.id, failed: photo.failed, visible: Boolean(photo.src) })),
      current: data.current, error: data.error || '', readError: data.readError, counts: data.counts,
      supplementCount: data.supplements && data.supplements.length
    } };
    await mp.screenshot({ path: path.join(out, name + '.png') });
    report.states.push(state); save(); console.log(name);
    return page;
  };
  try {
    const fixture = await mp.evaluate(() => getApp().globalData.qaFixture);
    assert.equal(fixture, 'clear-page-20261028', '只能操作隔离合成工程');
    report.environment = await mp.systemInfo();
    await mp.reLaunch('/pages/capture/index'); await pause(600);
    let page = await capture('01-capture-empty');
    await (await page.$('.editor')).input('合成验收：记下一个周末散步的想法。');
    await (await page.$('.todo-setting-toggle')).tap();
    page = await capture('02-capture-todo'); assert.equal(await page.data('todoEnabled'), true);
    await (await page.$('.save-btn')).tap(); await pause(300);
    page = await capture('03-capture-confirmed');
    assert.equal(await page.data('draft'), ''); assert.ok(await page.data('lastSavedId'));
    assert.ok(await page.$('.editor'), '确认后输入仍常驻');
    await mp.switchTab('/pages/list/index'); await capture('04-list');
    page = await mp.currentPage(); await (await page.$('.search-box input')).input('合成无结果关键词XYZ');
    page = await capture('05-list-no-match'); assert.equal((await page.data('items')).length, 0);
    await page.callMethod('onClearAll');
    await mp.switchTab('/pages/todos/index'); page = await capture('06-todos');
    const check = await page.$('.todo-check'); if (check) {
      await check.tap(); await pause(150); assert.equal(await page.data('undoVisible'), true);
      await page.callMethod('onUndo'); await pause(150);
    }
    await mp.switchTab('/pages/mine/index'); await capture('07-mine');
    await mp.navigateTo('/pages/archived/index'); await capture('08-archived');
    await mp.reLaunch('/pages/detail/index?id=demo_walk'); page = await capture('09-detail');
    const photos = await page.data('photos'); assert.equal(photos.length, 2);
    assert.equal(photos[0].failed, false); assert.equal(photos[1].failed, true);
    await mp.navigateTo('/pages/photo-viewer/index?id=demo_walk&photo=demo_photo');
    page = await capture('10-photo-visible');
    await page.callMethod('onChange', { detail: { current: 1 } });
    page = await capture('11-photo-failed'); assert.equal(await page.data('current'), 1);
    await page.callMethod('onReload'); page = await capture('12-photo-retry-position');
    assert.equal(await page.data('current'), 1);
    await mp.reLaunch('/pages/history/index?id=demo_walk'); await capture('13-history');
    await mp.reLaunch('/pages/output/index?id=demo_walk'); await capture('14-output');
    await mp.reLaunch('/pages/material-output/index'); await capture('15-material');
    await mp.reLaunch('/pages/feedback/index'); await capture('16-feedback');
    await mp.reLaunch('/pages/welcome/index'); await capture('17-welcome');
    assert.equal(report.exceptions.length, 0); report.ok = true;
  } finally { save(); await mp.disconnect(); }
})().catch(error => { report.failure = error.message; save(); console.error(error.message); process.exitCode = 1; });
