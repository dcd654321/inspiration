'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInspiration } = require('../miniprogram/core/inspiration');

test('恢复入口在页面可见，云端与本机副本均有复制按钮', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  assert.match(wxml, /bindtap="onUseRemote"/);
  assert.match(wxml, /bindtap="onCopyRemote"/);
  assert.match(wxml, /bindtap="onCopyRecovery"/);
});

test('用户确认采用云端后才切换，恢复副本仍可查看复制', async () => {
  const pagePath = require.resolve('../miniprogram/pages/mine/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let modal;
  let copied = '';
  let resolved = false;
  let failNext = true;
  const local = createInspiration({ id: 'insp_local', text: '本机未备份内容', now: 1000 });
  const remote = createInspiration({ id: 'insp_remote', text: '云端新内容', now: 1000 });
  const store = {
    getBackupStatus() { return resolved ? { state: 'synced', pendingCount: 0 } : { state: 'CONFLICT', pendingCount: 1 }; },
    getConflict() { return resolved ? null : { code: 'CONFLICT', remote: { inspirations: [remote] } }; },
    getRecoveries() { return resolved ? [{ savedAt: 2000, snapshot: { inspirations: [local] }, pendingOps: [{ kind: 'upsert' }] }] : []; },
    async resolveUseRemote() {
      if (failNext) { failNext = false; return { ok: false, code: 'LOCAL_WRITE_FAILED' }; }
      resolved = true;
      return { ok: true };
    }
  };
  const app = { globalData: { store, legacyCachePresent: false }, ensureReady: async () => store };
  try {
    global.Page = (value) => { definition = value; };
    global.getApp = () => app;
    global.wx = {
      showModal(options) { modal = options; },
      setClipboardData({ data, success }) { copied = data; success(); },
      showToast() {}
    };
    delete require.cache[pagePath];
    require(pagePath);
    const page = Object.assign({}, definition, {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    });
    await page.onShow();
    assert.equal(page.data.backupConflict, true);
    assert.equal(page.data.remoteItems[0].id, 'insp_remote');
    const originalStatus = store.getBackupStatus;
    store.getBackupStatus = () => ({ state: 'STALE_GENERATION', pendingCount: 1 });
    page.updateBackup(store);
    assert.match(page.data.backupText, /版本已失效/);
    store.getBackupStatus = () => ({ state: 'REQUEST_ID_REUSED', pendingCount: 1 });
    page.updateBackup(store);
    assert.equal(page.data.backupConflict, true);
    assert.match(page.data.backupText, /标识冲突/);
    store.getBackupStatus = originalStatus;
    page.updateBackup(store);
    page.onUseRemote();
    assert.equal(resolved, false, '确认前不得切换');
    await modal.success({ confirm: false });
    assert.equal(resolved, false, '取消不得切换');
    page.onUseRemote();
    await modal.success({ confirm: true });
    assert.equal(resolved, false);
    assert.match(page.data.backupText, /恢复副本未写入/);
    page.onUseRemote();
    await modal.success({ confirm: true });
    assert.equal(resolved, true);
    assert.equal(page.data.backupConflict, false);
    assert.equal(page.data.recoveryCount, 1);
    assert.equal(page.data.recoveryItems[0].text.includes('本机未备份内容'), true);
    page.onCopyRecovery({ currentTarget: { dataset: { key: page.data.recoveryItems[0].key } } });
    assert.equal(copied.includes('本机未备份内容'), true);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});
