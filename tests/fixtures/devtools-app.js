// 仅用于 qa/local 中的离线模拟器工程，所有数据均为合成样例，不调用云函数或持久化 API。
const core = require('./core/inspiration');
const { createCaptureDrafts } = require('./services/capture-drafts');
const { createReviewService } = require('./services/discovery');
const { createUsageMetrics } = require('./services/usage-metrics');
const data = new Map(), scope = 'a'.repeat(32), now = Date.now();
let first = core.createInspiration({ id: 'demo_1', text: '整理一份城市周末散步指南，记录街区里值得停留的小店和公共空间。', now: now - 4 * 86400000 });
first = core.appendSupplement(first, { id: 'demo_s1', content: '每条路线控制在两小时内，补充休息点和雨天替代安排。', now: now - 3 * 86400000 });
first = core.appendSupplement(first, { id: 'demo_s2', content: '先从自己熟悉的三个街区开始，照片仅留作个人参考。', now: now - 3 * 86400000 });
first = Object.assign({}, first, { tags: ['内容选题', '城市散步'], stage: 'growing', photos: [{ id: 'demo_p', fileId: '/assets/brand-mark.png', createdAt: now }] });
let items = [first, core.createInspiration({ id: 'demo_2', text: '做一个方便回顾旧想法的小工具，让记录之后的整理更加自然。', now: now - 5 * 86400000 })];
const storage = { get: (key) => data.get(key), set: (key, value) => data.set(key, value) };
const store = {
  listInspirations: () => items.filter((x) => !x.mergedInto), getInspiration: (id) => items.find((x) => x.id === id),
  readSnapshot: () => ({ inspirations: items }), getQueue: () => [], getConflict: () => null, getRecoveries: () => [],
  getBackupStatus: () => ({ state: 'synced', pendingCount: 0 }), retryPending: async () => ({ ok: true, synced: true }),
  async saveInspirations(next) { next.forEach((item) => { items = items.filter((x) => x.id !== item.id).concat([item]); }); return { ok: true, synced: true }; },
  async saveInspiration(item) { return this.saveInspirations([item]); }
};
App({ globalData: { store, aiEnabled: true, cacheScope: scope, sessionEpoch: 1, accountError: '', drafts: createCaptureDrafts(),
  review: createReviewService({ storage, cacheScope: scope }), metrics: createUsageMetrics({ storage, cacheScope: scope }), photos: null },
  ensureReady: async () => store, refreshAccount: async () => store });
