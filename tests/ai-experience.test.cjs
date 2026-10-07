'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/core/inspiration');
const input = (value) => ({ detail: { value } });
const draft = { points: ['先梳理路线范围'], nextSteps: ['试走一条两小时的路线'], risks: ['雨天安排待确认'] };
const create = (id, text = '整理一份城市周末散步指南') => core.createInspiration({ id, text, now: 1000 });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function withPage(scope, run, { failLoad = false } = {}) {
  const old = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const file = require.resolve('../miniprogram/pages/ai-workbench/index');
  let definition;
  const state = { items: [create('a'), create('b')], saves: [], alerts: [], dialogs: [], copies: [], routes: [], modalConfirm: true };
  const store = {
    getInspiration: (id) => state.items.find((x) => x.id === id), listInspirations: () => state.items,
    readSnapshot: () => ({ inspirations: state.items }),
    async saveInspirations(items) {
      state.saves.push(structuredClone(items));
      const result = state.save ? await state.save(items) : { ok: true, synced: true };
      if (result && result.ok && result.synced) state.items = state.items.filter((x) => !items.some((next) => next.id === x.id)).concat(items);
      return result;
    }
  };
  const app = { globalData: { store, sessionEpoch: 1 }, ensureReady: async () => { if (failLoad) throw Error('NETWORK'); return store; } };
  try {
    global.Page = (value) => { definition = value; }; global.getApp = () => app;
    global.wx = { enableAlertBeforeUnload: (o) => state.alerts.push(o.message), disableAlertBeforeUnload() {}, pageScrollTo() {},
      showModal: (o) => { state.dialogs.push(o); if (!state.deferModal) o.success({ confirm: state.modalConfirm }); },
      setClipboardData: (o) => { state.copies.push(o.data); o.success(); },
      navigateBack: () => state.routes.push('back'), redirectTo: (o) => state.routes.push(o.url), switchTab: (o) => state.routes.push(o.url) };
    delete require.cache[file]; require(file);
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(data) { Object.assign(this.data, data); } });
    await page.onLoad({ scope, id: 'a' });
    page.ai = { expand: async () => ({ ok: true, value: draft }), summarize: async () => ({ ok: true, value: { text: '把周末散步与旧想法整理成一份路线指南。' } }) };
    await run({ page, state, app, store });
  } finally {
    delete require.cache[file]; for (const [key, value] of Object.entries(old)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

test('AI 体验：素材数量字数与短正文预检不调用模型', async () => {
  await withPage('inspirations', async ({ page, state }) => {
    let calls = 0; page.ai.summarize = async () => { calls++; return { ok: false }; };
    await page.onGenerate(); assert.equal(calls, 0); assert.equal(page.data.canGenerate, false);
    page.onSelect(input(['a', 'b'])); assert.equal(page.data.selectedCount, 2); assert.equal(page.data.canGenerate, true);
    page.data.options = Array.from({ length: 21 }, (_, i) => ({ id: 'i' + i, content: '内容', selected: true }));
    await page.onGenerate(); assert.equal(calls, 0); assert.match(page.data.selectionHint, /20/);
    page.data.options = [{ id: 'a', content: '字'.repeat(6001), selected: true }, { id: 'b', content: '字'.repeat(6001), selected: true }];
    await page.onGenerate(); assert.equal(calls, 0); assert.equal(page.data.sourceChars, 12002);
  });
  await withPage('expand', async ({ page }) => {
    let calls = 0; page.ai.expand = async () => { calls++; return { ok: false }; }; page.data.original = '短';
    await page.onGenerate(); assert.equal(calls, 0); assert.match(page.data.selectionHint, /8/);
  });
});

test('AI 体验：读取失败独立显示且可重读', async () => {
  await withPage('expand', async ({ page, app, store }) => {
    assert.equal(page.data.ready, true); assert.equal(page.data.loadError, true); assert.match(page.data.error, /重新读取/);
    app.ensureReady = async () => store; await page.onRetryLoad(); assert.equal(page.data.loadError, false); assert.equal(page.data.enabled, true);
  }, { failLoad: true });
});

test('AI 体验：预览计数与汇总默认新增不自动写入', async () => {
  await withPage('expand', async ({ page, state }) => {
    await page.onGenerate(); assert.equal(page.data.acceptedCount, 3); assert.equal(state.saves.length, 0);
    page.onEntrySelect(input(['points0'])); assert.equal(page.data.acceptedCount, 1);
    page.onCopy(); assert.equal(state.copies[0], '要点：先梳理路线范围');
    assert.equal(state.alerts.length, 1);
  });
  await withPage('inspirations', async ({ page, state }) => {
    page.onSelect(input(['a', 'b'])); await page.onGenerate();
    assert.equal(page.data.mode, 'append'); assert.equal(page.data.canAccept, true); assert.equal(state.saves.length, 0);
    await page.onAccept(); assert.equal(state.saves[0].length, 1); assert.equal(state.items.filter((x) => x.mergedInto).length, 0);
    assert.equal(page.data.completed, true); page.onOpenSaved(); assert.match(state.routes[0], /pages\/detail\/index\?id=/);
  });
});

test('AI 体验：保存等待冻结文本选项且重复确认不写入', async () => {
  await withPage('expand', async ({ page, state }) => {
    await page.onGenerate(); const pending = deferred(); state.save = () => pending.promise;
    const saving = page.onAccept(); const before = structuredClone(page.data);
    page.onEntryEdit({ detail: { value: '迟到编辑' }, currentTarget: { dataset: { id: 'points0' } } });
    page.onEntrySelect(input([])); page.onSummaryEdit(input('迟到汇总')); page.onMode(input('overwrite')); page.onTarget(input('b'));
    await page.onAccept(); page.onDiscard();
    assert.deepEqual(page.data.entries, before.entries); assert.equal(page.data.mode, before.mode); assert.equal(state.saves.length, 1);
    pending.resolve({ ok: true, synced: true }); await saving; assert.equal(page.data.completed, true);
    assert.equal(state.items.find((x) => x.id === 'a').supplements.length, 3);
  });
});

test('AI 体验：保存失败重试复用产物标识且未知时保留预览', async () => {
  for (const scope of ['expand', 'inspirations']) await withPage(scope, async ({ page, state }) => {
    if (scope === 'inspirations') page.onSelect(input(['a', 'b'])); await page.onGenerate();
    state.save = async () => ({ ok: false, code: 'NETWORK' }); await page.onAccept();
    assert.equal(page.data.preview, true); assert.equal(page.data.saveUnknown, true); assert.match(page.data.error, /尚未确认保存/);
    const summary = page.data.summary; page.onSummaryEdit(input('不应改动')); assert.equal(page.data.summary, summary);
    state.save = async () => ({ ok: true, synced: true }); await page.onAccept();
    assert.deepEqual(state.saves[1], state.saves[0]); assert.equal(page.data.completed, true);
  });
});

test('AI 体验：丢失回执后已确认同产物直接完成不重复写入', async () => {
  await withPage('expand', async ({ page, state }) => {
    await page.onGenerate(); state.save = async (items) => {
      state.items = state.items.filter((x) => x.id !== 'a').concat(items.map((item) => Object.fromEntries(Object.entries(item).reverse())));
      return { ok: false, code: 'NETWORK' };
    };
    await page.onAccept(); await page.onAccept();
    assert.equal(state.saves.length, 1); assert.equal(page.data.completed, true);
  });
});

test('AI 体验：保存回执跨页面和账户不更新新状态', async () => {
  for (const leave of ['page', 'account']) await withPage('expand', async ({ page, state, app }) => {
    await page.onGenerate(); const pending = deferred(); state.save = () => pending.promise; const saving = page.onAccept();
    if (leave === 'page') { page.onUnload(); await page.onLoad({ scope: 'expand', id: 'a' }); }
    else { app.globalData.sessionEpoch++; app.globalData.store = {}; }
    page.setData({ notice: '新状态', completed: false }); pending.resolve({ ok: true, synced: true }); await saving;
    assert.equal(page.data.notice, '新状态'); assert.equal(page.data.completed, false);
  });
});

test('AI 体验：返回放弃取消保留预览且覆盖确认冻结保存方式', async () => {
  await withPage('expand', async ({ page, state }) => {
    await page.onGenerate(); state.modalConfirm = false; page.onDiscard(); page.onBack();
    assert.equal(page.data.preview, true); assert.equal(state.routes.length, 0);
    state.modalConfirm = true; page.onDiscard(); assert.equal(page.data.preview, false);
  });
  await withPage('inspirations', async ({ page, state }) => {
    page.onSelect(input(['a', 'b'])); await page.onGenerate(); page.onMode(input('overwrite')); page.onTarget(input('a'));
    state.deferModal = true; const saving = page.onAccept();
    assert.equal(page.data.busyKind, 'confirm'); page.onMode(input('append')); assert.equal(page.data.mode, 'overwrite');
    state.dialogs[0].success({ confirm: false }); await saving; assert.equal(page.data.busy, false); assert.equal(state.saves.length, 0);
    state.deferModal = false; await page.onAccept(); assert.equal(state.items.find((x) => x.id === 'b').mergedInto, 'a');
  });
});

test('AI 体验：AI 失败保留选材并提供手动整理出口', async () => {
  await withPage('expand', async ({ page, state }) => {
    page.ai.expand = async () => ({ ok: false, message: 'AI 暂时无法使用。' }); await page.onGenerate();
    assert.equal(page.data.busy, false); assert.equal(page.data.preview, false); assert.match(page.data.error, /暂时无法使用/);
    page.onManual(); assert.equal(state.routes[0], '/pages/output/index?id=a'); assert.equal(state.saves.length, 0);
  });
});

test('AI 体验：生成前素材变化须重选且不向模型发送旧内容', async () => {
  for (const scope of ['expand', 'inspirations']) await withPage(scope, async ({ page, state }) => {
    let calls = 0; page.ai.expand = page.ai.summarize = async () => { calls++; return { ok: false }; };
    if (scope === 'inspirations') page.onSelect(input(['a', 'b']));
    state.items[0] = core.updateText(state.items[0], { text: '这条素材期间更新为不同内容', historyId: 'h', now: 2000 });
    await page.onGenerate(); assert.equal(calls, 0); assert.match(page.data.error, /素材已更新/); assert.equal(page.data.selectedCount, 0);
  });
});

test('全量复核：AI 汇总两千字契约与普通补充边界独立', async () => {
  await withPage('supplements', async ({ page, state }) => {
    state.items[0] = core.appendSupplement(core.appendSupplement(state.items[0], { id: 's1', content: '路线范围', now: 1100 }), { id: 's2', content: '沿途公共空间', now: 1200 });
    await page.onLoad({ scope: 'supplements', id: 'a' });
    const text = '汇'.repeat(1200);
    page.ai.summarize = async () => ({ ok: true, value: { text } });
    page.onSelect(input(['s1', 's2'])); await page.onGenerate();
    assert.equal(page.data.summary, text); assert.equal(page.data.canAccept, true);
    assert.equal(page.data.summarySaveMax, 2000); assert.equal(page.data.acceptHint, '');
    page.onSummaryEdit(input('汇'.repeat(2100)));
    assert.equal(page.data.summary.length, 2100); assert.equal(page.data.canAccept, false);
    assert.match(page.data.acceptHint, /100/);
    await page.onAccept(); assert.equal(state.saves.length, 0);
    page.onCopy(); assert.equal(state.copies[0].length, 2100);
    page.onSummaryEdit(input(text)); assert.equal(page.data.canAccept, true);
    await page.onAccept(); assert.equal(page.data.completed, true);
    const saved = state.items.find((x) => x.id === 'a');
    assert.equal(saved.supplements.at(-1).content.length, 1200);
    assert.equal(require('../server/record-validation').validRecord(saved), true);
    assert.throws(() => core.appendSupplement(saved, { id: 'ordinary', content: text, now: 2200 }));
  });
  await withPage('inspirations', async ({ page }) => {
    page.ai.summarize = async () => ({ ok: true, value: { text: '汇'.repeat(1200) } });
    page.onSelect(input(['a', 'b'])); await page.onGenerate();
    assert.equal(page.data.summarySaveMax, 2000); assert.equal(page.data.canAccept, true);
    page.onSummaryEdit(input('汇'.repeat(2000))); assert.equal(page.data.canAccept, true);
    page.onSummaryEdit(input('汇'.repeat(2001))); assert.equal(page.data.canAccept, false);
  });
});

test('复核：来源字段排列变化不误判真实内容冲突', async () => {
  await withPage('expand', async ({ page, state }) => {
    await page.onGenerate();
    state.items[0] = Object.fromEntries(Object.entries(state.items[0]).reverse());
    await page.onAccept(); assert.equal(state.saves.length, 1); assert.equal(page.data.completed, true);
  });
});
