'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('界面整改：主按钮和次按钮都保留 88rpx 触控高度', () => {
  const styles = read('miniprogram/app.wxss');
  assert.match(styles, /\.btn\s*\{[\s\S]*?min-height:\s*88rpx;/);
  assert.match(styles, /\.btn-sm\s*\{[\s\S]*?min-height:\s*88rpx;/);
  assert.match(styles, /\.btn-link\s*\{[\s\S]*?min-height:\s*88rpx;/);
});

test('界面整改：列表首次读取失败不会落入正常空状态', () => {
  const page = read('miniprogram/pages/list/index.wxml');
  const errorState = page.indexOf('error && items.length === 0');
  const emptyState = page.indexOf('wx:elif="{{items.length === 0}}"');
  assert.ok(errorState >= 0, '缺少首次读取失败状态');
  assert.ok(emptyState > errorState, '读取失败状态必须先于正常空状态判断');
  assert.match(page, /暂时无法读取灵感/);
  assert.match(page, /\{\{error\}\}/);
});

test('界面整改：补充操作有可见入口且未接通能力不展示空壳区块', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  assert.match(page, />更多<\/button>/);
  assert.match(page, /aria-label="打开补充操作"/);
  assert.match(page, />并入正文</);
  assert.doesNotMatch(page, /照片还不支持添加|AI 扩展还没开放/);
});

test('界面整改：记录页只允许有实际内容时保存', () => {
  const logic = read('miniprogram/pages/capture/index.js');
  const page = read('miniprogram/pages/capture/index.wxml');
  // 空白与超限都不能提交；输入框放开长度限制、保留粘贴全文，超限在提交层拦住
  assert.match(logic, /canEdit = value\.trim\(\)\.length > 0 && overBy === 0/);
  assert.match(page, /disabled="\{\{!canSave \|\| saving\}\}"/);
  assert.match(page, /maxlength="-1"/);
  assert.match(page, /超出\{\{overBy\}\}字符，请缩短后保存。/);
});

test('界面整改：我的页不暴露开发能力开关', () => {
  const page = read('miniprogram/pages/mine/index.wxml');
  assert.doesNotMatch(page, /云端同步|AI 扩展|已启用|未启用/);
  assert.match(page, /数据与隐私/);
  assert.match(page, /open-type="feedback"/);
});

test('界面整改：品牌图已进入小程序包', () => {
  const asset = path.join(root, 'miniprogram/assets/brand-mark.png');
  assert.ok(fs.existsSync(asset), '缺少品牌图 miniprogram/assets/brand-mark.png');
  assert.ok(fs.statSync(asset).size > 0, '品牌图为空文件');
});

test('公众首用：三个 Tab 均配置轻量的普通态和选中态图标', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.strictEqual(app.tabBar.list.length, 3);
  for (const tab of app.tabBar.list) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      assert.ok(tab[key], `${tab.text} 缺少 ${key}`);
      const icon = fs.readFileSync(path.join(root, 'miniprogram', tab[key]));
      assert.deepStrictEqual(icon.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
      assert.strictEqual(icon.readUInt32BE(16), 81);
      assert.strictEqual(icon.readUInt32BE(20), 81);
      assert.ok(icon.length < 40 * 1024, `${tab.text} 的 ${key} 超过 40KB`);
    }
  }
});

test('公众首用：保存后成功卡带摘录与两条下一步，继续输入时旧入口消失', async () => {
  const pagePath = require.resolve('../miniprogram/pages/capture/index');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition;
  let saved;
  let opened;

  try {
    global.Page = (page) => { definition = page; };
    global.getApp = () => ({
      ensureReady() { return Promise.resolve(this.globalData.store); },
      globalData: {
        sessionEpoch: 1,
        store: {
          async saveInspiration(inspiration) {
            saved = inspiration;
            return { ok: true, synced: true };
          }
        }
      }
    });
    global.wx = { navigateTo: (options) => { opened = options.url; } };
    delete require.cache[pagePath];
    require(pagePath);

    const page = {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    };

    definition.onInput.call(page, { detail: { value: '想做一个周末散步路线图' } });
    await definition.onSave.call(page);
    assert.strictEqual(page.data.lastSavedId, saved.id);
    // 摘录的是这次确认保存的内容，不是列表第一条
    assert.strictEqual(page.data.lastSavedExcerpt, '想做一个周末散步路线图');
    assert.strictEqual(page.data.draft, '');

    definition.onContinueSupplement.call(page);
    assert.strictEqual(opened, '/pages/detail/index?id=' + encodeURIComponent(saved.id) + '&focus=supplement');

    definition.onInput.call(page, { detail: { value: '另一个想法' } });
    assert.strictEqual(page.data.lastSavedId, '');
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test('本轮整改：列表只统计当前可见补充，不把已收起内容或照片数堆在列表行', () => {
  const pagePath = require.resolve('../miniprogram/pages/list/index');
  const previous = { Page: global.Page, getApp: global.getApp };
  let definition;
  try {
    global.Page = (page) => { definition = page; };
    const rows = [{
      id: 'ins_1', text: '一个想法', updatedAt: Date.now(), photos: [{ id: 'photo_1' }],
      supplements: [
        { id: 'sup_1', content: '仍可见', mergedInto: null, foldedAt: null },
        { id: 'sup_2', content: '已并入', mergedInto: null, foldedAt: 123 },
        { id: 'sup_3', content: '已合并', mergedInto: 'sup_1', foldedAt: null }
      ]
    }];
    global.getApp = () => ({ globalData: { cacheScope: '', store: {
      listInspirations: () => rows,
      readSnapshot: () => ({ inspirations: rows })
    } } });
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      data: Object.assign({}, definition.data),
      setData(next) { Object.assign(this.data, next); }
    };
    definition.load.call(page);
    assert.strictEqual(page.data.items[0].supplements, '1 条补充');
    assert.ok(!Object.hasOwn(page.data.items[0], 'photos'));
    assert.doesNotMatch(read('miniprogram/pages/list/index.wxml'), /item\.photos/);
  } finally {
    delete require.cache[pagePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

test('本轮整改：详情先提供补充，再展示时间线；整理与复制入口仍可达', () => {
  const page = read('miniprogram/pages/detail/index.wxml');
  const compose = page.indexOf('class="compose"');
  const timeline = page.indexOf('class="timeline"');
  assert.ok(compose >= 0 && timeline > compose);
  assert.match(page, /bindtap="onOpenOutput">整理成稿/);
  // 复制全文收进「更多」面板，但仍然可达且范围不变
  assert.match(page, /bindtap="onMoreCopy"/);
  const logic = read('miniprogram/pages/detail/index.js');
  assert.match(logic, /仅复制正文/);
  assert.match(logic, /复制正文与当前补充/);
  assert.strictEqual((page.match(/class="compose"/g) || []).length, 1);
});

test('本轮整改：我的页不再重复列表入口，分组按用途排列', () => {
  const page = read('miniprogram/pages/mine/index.wxml');
  // 重复的「查看我的灵感」入口已删除；分组按用途排列
  assert.doesNotMatch(page, /从记录到使用/);
  assert.doesNotMatch(page, /查看我的灵感/);
  const share = page.indexOf('我的分享');
  const privacy = page.indexOf('数据与隐私');
  const help = page.indexOf('使用帮助');
  const feedback = page.indexOf('意见反馈');
  const about = page.indexOf('关于');
  assert.ok(share >= 0 && privacy > share && help > privacy && feedback > help && about > feedback);
  const logic = read('miniprogram/pages/mine/index.js');
  assert.doesNotMatch(logic, /照片不会被分享/);
});

test('WXML 表达式不使用 HTML 实体转义逻辑运算符', () => {
  const pages = path.join(root, 'miniprogram/pages');
  for (const name of fs.readdirSync(pages)) {
    const file = path.join(pages, name, 'index.wxml');
    if (fs.existsSync(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\{\{[^}]*&(?:amp|lt|gt);/);
  }
});
