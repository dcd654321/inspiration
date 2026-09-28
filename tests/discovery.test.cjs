'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchInspirations, createReviewService } = require('../miniprogram/services/discovery');
const { USE_TEMPLATES, buildTemplateText } = require('../miniprogram/services/content-output');
const DAY = 86400000;
const at = Date.UTC(2026, 8, 27, 6);
function item(id, text, updatedAt = at - 3 * DAY) {
  return { id, text, updatedAt, deletedAt: null, mergedInto: null, supplements: [] };
}

test('搜索只命中正文和有效补充，筛选与无结果不泄露历史照片', () => {
  const one = item('one', '学习 JavaScript');
  one.supplements = [{ id: 's1', content: '测试关键词', createdAt: 1 },
    { id: 's2', content: '隐藏内容', foldedAt: 1 }, { id: 's3', content: '汇总来源', mergedInto: 's1' }];
  one.textHistory = [{ text: '历史机密' }]; one.photos = [{ fileId: '照片机密' }];
  const two = item('two', '旧想法', at - 20 * DAY);
  const deleted = Object.assign(item('deleted', '关键词'), { deletedAt: 1 });
  const merged = Object.assign(item('merged', '关键词'), { mergedInto: 'one' });
  const rows = [one, two, deleted, merged];
  assert.equal(searchInspirations(rows, { query: 'javascript' })[0].matchSource, '正文');
  assert.equal(searchInspirations(rows, { query: '关键词' })[0].matchSource, '补充');
  for (const query of ['隐藏内容', '汇总来源', '历史机密', '照片机密']) {
    assert.equal(searchInspirations(rows, { query }).length, 0);
  }
  assert.equal(searchInspirations(rows, { filter: 'recent', now: at }).length, 1);
  assert.equal(searchInspirations(rows, { filter: 'supplemented', now: at }).length, 1);
  assert.equal(searchInspirations(rows, { query: '' }).length, 2);
});

test('回顾每天固定一条，跳过当日不替换，删除来源不回显旧内容', () => {
  let clock = at;
  const map = new Map();
  const storage = { get: (key) => map.get(key), set: (key, value) => map.set(key, structuredClone(value)) };
  const service = createReviewService({ storage, cacheScope: 'a'.repeat(32), now: () => clock });
  const rows = [item('a', '甲'), item('b', '乙')];
  const first = service.getRecommendation(rows);
  assert.ok(first);
  assert.equal(service.getRecommendation(rows).id, first.id);
  assert.equal(service.getRecommendation(rows.filter((x) => x.id !== first.id)), null);
  service.dismiss();
  assert.equal(service.getRecommendation(rows), null);
  clock += DAY;
  assert.ok(service.getRecommendation(rows));
  assert.equal(JSON.stringify(Array.from(map.values())).includes('甲'), false);
});

test('回顾偏好按可信账户分区，写入失败不假报设置成功', () => {
  const map = new Map();
  let fail = false;
  const storage = { get: (key) => map.get(key), set: (key, value) => { if (fail) throw Error('FULL'); map.set(key, structuredClone(value)); } };
  const a = createReviewService({ storage, cacheScope: 'a'.repeat(32), now: () => at });
  const b = createReviewService({ storage, cacheScope: 'b'.repeat(32), now: () => at });
  a.setEnabled(false);
  assert.equal(a.getRecommendation([item('a', '甲')]), null);
  assert.equal(b.isEnabled(), true);
  fail = true;
  assert.throws(() => a.setEnabled(true));
  assert.equal(a.isEnabled(), false);
  assert.throws(() => createReviewService({ storage, cacheScope: '../other' }));
});

test('用途模板完整保留选中素材，不带历史照片且不改写原记录', () => {
  const source = item('a', '原始文字'.repeat(900));
  source.supplements = [{ id: 'yes', content: '选中素材', createdAt: 1 }, { id: 'no', content: '未选内容', createdAt: 2 }];
  source.textHistory = [{ text: '历史机密' }];
  const original = JSON.stringify(source);
  for (const template of USE_TEMPLATES) {
    const result = buildTemplateText(source, ['yes'], template.id);
    assert.ok(result.includes(source.text));
    assert.ok(result.includes('选中素材'));
    assert.equal(result.includes('未选内容'), false);
    assert.equal(result.includes('历史机密'), false);
    assert.equal(result.includes('AI 生成'), false);
  }
  assert.equal(JSON.stringify(source), original);
});

test('重新生成使用稿先确认，取消保留编辑并可返回旧稿', async () => {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let definition, confirm;
  const source = item('a', '原文');
  const store = { getInspiration: () => source };
  const app = { globalData: { store, sessionEpoch: 1 }, ensureReady: async () => store };
  const target = require.resolve('../miniprogram/pages/output/index');
  try {
    global.Page = (page) => { definition = page; };
    global.getApp = () => app;
    global.wx = { showModal: (options) => { confirm = options.success; } };
    delete require.cache[target]; require(target);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } });
    await page.onLoad({ id: 'a' });
    page.onGenerate();
    page.onDraftInput({ detail: { value: '用户精心修改的稿件' } });
    page.onBackToSelection();
    page.onTemplateChange({ currentTarget: { dataset: { template: 'work' } } });
    page.onGenerate();
    assert.equal(page.data.draft, '用户精心修改的稿件');
    confirm({ confirm: false });
    page.onResumeDraft();
    assert.equal(page.data.phase, 'edit');
    assert.equal(page.data.draft, '用户精心修改的稿件');
    page.onGenerate(); confirm({ confirm: true });
    assert.match(page.data.draft, /【背景与材料】/);
    assert.equal(source.text, '原文');
  } finally {
    delete require.cache[target];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});
