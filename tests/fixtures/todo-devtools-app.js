// 仅供隔离模拟器工程使用的合成账户，不调用 wx.cloud，不保存到设备。
const core = require('./core/inspiration');
const todo = require('./core/todo');
const { createCloudOnlyStore } = require('./services/cloud-only-store');
const { createCaptureDrafts } = require('./services/capture-drafts');
const { createSessionDrafts } = require('./services/session-drafts');
const scope = 'a'.repeat(32), now = Date.now();
const make = (id, text, day) => core.createInspiration({ id, text, now: now - 50000,
  todo: todo.makeTodo(now - 40000, day) });
let first = make('demo_walk', '做一期城市漫步视频，保留街区里值得停留的细节。', todo.localDate());
first = core.appendSupplement(first, { id: 'demo_route', content: '提前查好两小时内的路线，补充休息点和雨天替代安排。', now: now - 30000,
  todo: todo.makeTodo(now - 30000, todo.dateAfter(1)) });
first = core.appendSupplement(first, { id: 'demo_done', content: '确定本次拍摄的主题。', now: now - 20000,
  todo: { createdAt: now - 20000, completedAt: now - 10000, dueDate: null } });
first = core.appendSupplement(first, { id: 'demo_folded', content: '确认出发点附近是否方便停车。', now: now - 15000,
  todo: todo.makeTodo(now - 15000) });
first = core.foldIntoText(first, { supplementId: 'demo_folded', historyId: 'demo_history', now: now - 12000 });
let archived = make('demo_archived', '整理上次旅行的照片和路线，暂时收起，之后继续处理。', todo.dateAfter(-2));
archived = core.markArchived(archived, { now: now - 5000 });
let items = [first, make('demo_overdue', '查一查拍摄地点的开放时间。', todo.dateAfter(-1)),
  make('demo_future', '周末整理配乐清单。', todo.dateAfter(3)), make('demo_undated', '记录沿途的街区小店。', null), archived,
  make('demo_long', '给城市漫步准备一段较长的观察清单。\n' + '留意门牌、窗边的植物、路边摊、树荫和行人的节奏。'.repeat(8), null)];
let version = 1;
const transport = { async send(action, payload) {
  if (action === 'snapshot.pull') return { ok: true, data: { cacheScope: scope, generation: 1, version, inspirations: items } };
  if (payload.generation !== 1 || payload.baseVersion !== version) return { ok: false, code: 'CONFLICT' };
  if (action === 'snapshot.push') {
    const map = new Map(items.map(item => [item.id, item]));
    payload.upserts.forEach(item => map.set(item.id, item)); items = Array.from(map.values());
    version++; return { ok: true, data: { version, applied: payload.upserts.map(item => item.id) } };
  }
  if (action === 'inspiration.delete') {
    items = items.filter(item => item.id !== payload.inspirationId); version++;
    return { ok: true, data: { version, deletedPhotos: 0 } };
  }
  throw Error('UNEXPECTED_FIXTURE_ACTION');
} };
const store = createCloudOnlyStore({ transport, cacheScope: scope,
  remoteSnapshot: { cacheScope: scope, generation: 1, version, inspirations: items } });
const sessionDrafts = createSessionDrafts(); sessionDrafts.bind({ cacheScope: scope, generation: 1 });
App({ globalData: { qaFixture: 'todos-20261021', store, cacheScope: scope, sessionEpoch: 1, accountError: '',
  drafts: createCaptureDrafts(), sessionDrafts, photos: null, metrics: null },
  ensureReady: async () => store,
  refreshAccount: async () => { await store.refresh(); return store; } });
