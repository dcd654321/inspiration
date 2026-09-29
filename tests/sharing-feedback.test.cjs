'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSharingFeedbackService: rawSharingService, makeSnapshot, dayStart } = require('../server/sharing-feedback');
const createSharingFeedbackService = (options) => rawSharingService(Object.assign({ rateLimit: async () => true }, options));
const { createProtocol } = require('../server/protocol');
const { createRepository } = require('../server/repository');
const { paginatePoster } = require('../miniprogram/services/share-poster');
const { selectedPreview, shareRevision } = require('../miniprogram/services/sharing');

function fixture() {
  let clock = Date.UTC(2026, 8, 24, 6, 0, 0);
  const accounts = new Map();
  const shares = [];
  const feedback = [];
  const baseItem = {
    id: 'idea_1', text: '原文\n第二行', textHistory: [{ id: 'old', text: '旧版' }],
    photos: [{ id: 'p', fileId: 'secret-photo' }], deletedAt: null,
    supplements: [
      { id: 'a', content: '可见补充', createdAt: 1, mergedInto: null, foldedAt: null, contentHistory: [{ text: '旧补充' }] },
      { id: 'b', content: '已收起', createdAt: 2, mergedInto: 'x', foldedAt: null },
      { id: 'c', content: '未选择', createdAt: 3, mergedInto: null, foldedAt: null }
    ]
  };
  accounts.set('owner', { generation: 1, version: 2, inspirations: [baseItem] });
  accounts.set('reader', { generation: 1, version: 0, inspirations: [] });
  const db = {
    getAccount: async (key) => accounts.get(key) || null,
    findShareByRequest: async (owner, id) => shares.find((s) => s.ownerAccountKey === owner && s.requestId === id) || null,
    findShareByHash: async (hash) => shares.find((s) => s.tokenHash === hash) || null,
    findShareById: async (id) => shares.find((s) => s._id === id) || null,
    insertShare: async (doc) => {
      if (shares.some((s) => s.tokenHash === doc.tokenHash ||
        (s.ownerAccountKey === doc.ownerAccountKey && s.requestId === doc.requestId))) throw Error('DUPLICATE');
      shares.push(doc);
    },
    listShares: async (owner, before, limit) => shares.filter((s) => s.ownerAccountKey === owner && (!before || s._id < before))
      .sort((a, b) => b._id.localeCompare(a._id)).slice(0, limit),
    countActiveShares: async (owner, at) => shares.filter((s) => s.ownerAccountKey === owner && s.revokedAt == null && s.expiresAt > at).length,
    countSharesSince: async (owner, since) => shares.filter((s) => s.ownerAccountKey === owner && s.createdAt >= since).length,
    revokeShare: async (owner, id, at) => {
      const doc = shares.find((s) => s.ownerAccountKey === owner && s._id === id);
      if (doc) doc.revokedAt = at;
    },
    revokeSharesForSource: async (owner, source, at) => {
      shares.filter((s) => s.ownerAccountKey === owner && s.sourceInspirationId === source).forEach((s) => { s.revokedAt = at; });
    },
    findFeedbackByRequest: async (account, id) => feedback.find((f) => f.accountKey === account && f.requestId === id) || null,
    findFeedbackByDedupeKey: async (key) => feedback.find((f) => f.dedupeKey === key) || null,
    insertFeedback: async (doc) => {
      if (feedback.some((f) => f.dedupeKey === doc.dedupeKey ||
        (f.accountKey === doc.accountKey && f.requestId === doc.requestId))) throw Error('DUPLICATE');
      feedback.push(doc);
    },
    listFeedback: async (owner, before, limit) => feedback.filter((f) => f.accountKey === owner && (!before || f._id < before))
      .sort((a, b) => b._id.localeCompare(a._id)).slice(0, limit),
    countFeedbackSince: async (owner, since) => feedback.filter((f) => f.accountKey === owner && f.createdAt >= since).length
  };
  const tokenKey = crypto.randomBytes(32);
  const service = createSharingFeedbackService({ db, now: () => clock,
    tokenKey, createEnabled: true, checkPublicText: async () => true,
    generateCode: async () => Buffer.from([137, 80, 78, 71]) });
  const payload = { inspirationId: 'idea_1', selectedSupplementIds: ['a'],
    baseVersion: 2, generation: 1, channelIntent: 'chat' };
  return { db, service, accounts, shares, feedback, payload, tokenKey,
    setClock: (value) => { clock = value; }, now: () => clock };
}

test('分享快照只取选中且有效的当前文字，排除照片与历史', async () => {
  const f = fixture();
  const result = await f.service.createShare('owner', f.payload, 'req_share_001');
  assert.equal(result.ok, true);
  assert.equal(result.data.preview.body, '原文\n第二行\n\n可见补充');
  assert.equal(f.shares.length, 1);
  assert.equal(JSON.stringify(f.shares[0].snapshot).includes('secret-photo'), false);
  assert.equal(JSON.stringify(f.shares[0].snapshot).includes('旧版'), false);
  assert.equal(JSON.stringify(f.shares[0].snapshot).includes('已收起'), false);
  assert.equal(JSON.stringify(f.shares[0].snapshot).includes('未选择'), false);
  assert.notEqual(f.shares[0].tokenHash, result.data.token);
});

test('另一个账户凭有效令牌只读快照，不得到所有者身份或照片', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_002');
  const viewed = await f.service.getShare('reader', { token: created.data.token });
  assert.equal(viewed.ok, true);
  assert.deepEqual(Object.keys(viewed.data).sort(), ['body', 'createdAt', 'expiresAt', 'title']);
  assert.equal(JSON.stringify(viewed.data).includes('owner'), false);
  assert.equal(JSON.stringify(viewed.data).includes('secret-photo'), false);
});

test('分享创建后改原文不改旧快照；源删除、代际变化、到期均阻止新读取', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_003');
  f.accounts.get('owner').inspirations[0].text = '新版';
  assert.match((await f.service.getShare('reader', { token: created.data.token })).data.body, /原文/);
  f.accounts.get('owner').inspirations = [];
  assert.equal((await f.service.getShare('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
  assert.equal((await f.service.listMine('owner', {})).data.items[0].status, 'unavailable');
  f.accounts.get('owner').inspirations = [{ id: 'idea_1', deletedAt: null }];
  f.accounts.get('owner').generation = 2;
  assert.equal((await f.service.getShare('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
  f.accounts.get('owner').generation = 1;
  f.setClock(created.data.expiresAt);
  assert.equal((await f.service.getShare('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
});

test('密钥轮换保留旧密钥时，同一创建请求仍返回原令牌', async () => {
  const f = fixture();
  const first = await f.service.createShare('owner', f.payload, 'req_rotate_01');
  const rotated = createSharingFeedbackService({ db: f.db, now: f.now,
    tokenKey: crypto.randomBytes(32), keyId: 'v2', tokenKeys: { v1: f.tokenKey }, createEnabled: true,
    checkPublicText: async () => true });
  const retry = await rotated.createShare('owner', f.payload, 'req_rotate_01');
  assert.equal(retry.data.token, first.data.token);
});

test('服务端每日限额拒绝多余的分享和反馈，不将失败当成功', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await f.service.createShare('owner', f.payload, 'req_limit_' + i)).ok, true);
  }
  assert.equal((await f.service.createShare('owner', f.payload, 'req_limit_more')).code, 'SHARE_LIMIT');
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望加入一个有用的新功能' }, 'req_fb_limit_' + i)).ok, true);
  }
  assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望加入一个有用的新功能' }, 'req_fb_limit_more')).code, 'FEEDBACK_LIMIT');
});

test('撤销仅本人可做，列表仅本人可见且不返回令牌', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_004');
  assert.equal((await f.service.revokeShare('reader', { shareId: created.data.shareId })).code, 'NOT_FOUND');
  assert.equal((await f.service.listMine('reader', {})).data.items.length, 0);
  const mine = await f.service.listMine('owner', {});
  assert.equal(mine.data.items.length, 1);
  assert.equal(JSON.stringify(mine.data).includes(created.data.token), false);
  assert.equal((await f.service.revokeShare('owner', { shareId: created.data.shareId })).ok, true);
  assert.equal((await f.service.revokeShare('owner', { shareId: created.data.shareId })).ok, true);
  assert.equal((await f.service.getShare('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
});

test('暂停新建分享不影响既有分享读取撤销和意见反馈', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_pause_001');
  const paused = createSharingFeedbackService({ db: f.db, now: f.now,
    tokenKey: f.tokenKey, createEnabled: false, checkPublicText: async () => true });
  assert.equal((await paused.createShare('owner', f.payload, 'req_pause_002')).code, 'SHARE_NOT_CONFIGURED');
  assert.equal(f.shares.length, 1);
  assert.equal((await paused.getShare('reader', { token: created.data.token })).ok, true);
  assert.equal((await paused.createFeedback('reader', { category: 'idea', body: '希望能增加一些文字整理功能' }, 'req_pause_fb_1')).ok, true);
  assert.equal((await paused.revokeShare('owner', { shareId: created.data.shareId })).ok, true);
  assert.equal((await paused.getShare('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
});

test('开启分享仍拒绝审核不通过或审核不可用的内容', async () => {
  const f = fixture();
  const rejected = createSharingFeedbackService({ db: f.db, now: f.now,
    tokenKey: f.tokenKey, createEnabled: true, checkPublicText: async () => false });
  assert.equal((await rejected.createShare('owner', f.payload, 'req_review_no')).code, 'SHARE_CONTENT_REJECTED');
  const unavailable = createSharingFeedbackService({ db: f.db, now: f.now,
    tokenKey: f.tokenKey, createEnabled: true, checkPublicText: async () => { throw Error('UNAVAILABLE'); } });
  assert.equal((await unavailable.createShare('owner', f.payload, 'req_review_err')).code, 'SHARE_REVIEW_UNAVAILABLE');
  assert.equal(f.shares.length, 0);
});

test('同请求同参数跨实例重试只产生一条分享；不同参数拒绝', async () => {
  const f = fixture();
  const first = await f.service.createShare('owner', f.payload, 'req_share_005');
  const again = await f.service.createShare('owner', f.payload, 'req_share_005');
  assert.equal(first.data.token, again.data.token);
  assert.equal(f.shares.length, 1);
  const other = await f.service.createShare('owner', Object.assign({}, f.payload, { selectedSupplementIds: [] }), 'req_share_005');
  assert.equal(other.code, 'REQUEST_ID_REUSED');
});

test('并发插入回退路径不返回已撤销分享的令牌', async () => {
  const f = fixture();
  const insert = f.db.insertShare;
  f.db.insertShare = async (doc) => {
    await insert(doc);
    doc.revokedAt = f.now();
    throw Error('DUPLICATE');
  };
  const result = await f.service.createShare('owner', f.payload, 'req_race_revoke_01');
  assert.equal(result.code, 'SHARE_RETRY_UNAVAILABLE');
  assert.equal(result.data, undefined);
});

test('未同步版本、无审核、超长及未配置密钥均不创建分享', async () => {
  const f = fixture();
  assert.equal((await f.service.createShare('owner', Object.assign({}, f.payload, { baseVersion: 1 }), 'req_bad_001')).code, 'BACKUP_PENDING');
  const badSelection = Object.assign({}, f.payload, { selectedSupplementIds: ['b'] });
  assert.equal((await f.service.createShare('owner', badSelection, 'req_bad_002')).code, 'INVALID_PAYLOAD');
  f.accounts.get('owner').inspirations[0].text = '字'.repeat(1801);
  assert.equal((await f.service.createShare('owner', Object.assign({}, f.payload, { channelIntent: 'timeline_poster' }), 'req_bad_003')).code, 'SHARE_TOO_LONG');
  const noKey = createSharingFeedbackService({ db: f.db, now: f.now, createEnabled: true, checkPublicText: async () => true });
  assert.equal((await noKey.createShare('owner', f.payload, 'req_bad_004')).code, 'SHARE_NOT_CONFIGURED');
  const noReview = createSharingFeedbackService({ db: f.db, now: f.now, tokenKey: crypto.randomBytes(32), createEnabled: true });
  assert.equal((await noReview.createShare('owner', f.payload, 'req_bad_005')).code, 'SHARE_REVIEW_UNAVAILABLE');
  assert.equal(f.shares.length, 0);
});

test('有效令牌才可生成小程序码，scene 保持 32 字符内', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_006');
  const qr = await f.service.getShareCode('reader', { token: created.data.token });
  assert.equal(qr.ok, true);
  assert.equal(Buffer.from(qr.data.pngBase64, 'base64').length, 4);
  assert.equal(('s=' + created.data.token).length, 30);
  await f.service.revokeShare('owner', { shareId: created.data.shareId });
  assert.equal((await f.service.getShareCode('reader', { token: created.data.token })).code, 'SHARE_UNAVAILABLE');
});

test('反馈只归提交者，重复请求幂等且类别/状态不能由客户端越权指定', async () => {
  const f = fixture();
  const first = await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能' }, 'req_feedback_01');
  assert.equal(first.ok, true);
  assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能' }, 'req_feedback_01')).data.feedbackId, first.data.feedbackId);
  assert.equal((await f.service.createFeedback('owner', { category: 'bug', body: '使用时遇到了一个具体问题' }, 'req_feedback_01')).code, 'REQUEST_ID_REUSED');
  assert.equal((await f.service.createFeedback('owner', { category: 'idea', body: '希望增加搜索和筛选功能', status: 'closed' }, 'req_feedback_02')).code, 'INVALID_PAYLOAD');
  assert.equal((await f.service.listFeedback('reader', {})).data.items.length, 0);
  assert.equal((await f.service.listFeedback('owner', {})).data.items[0].status, 'submitted');
  assert.equal(f.feedback.length, 1);
});

test('分享举报从有效令牌关联，且同账户同分享同日去重', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_007');
  const body = '这份内容似乎违反了使用规则，请核查';
  const first = await f.service.reportShare('reader', { token: created.data.token, body }, 'req_report_01');
  assert.equal(first.ok, true);
  const second = await f.service.reportShare('reader', { token: created.data.token, body }, 'req_report_02');
  assert.equal(second.data.feedbackId, first.data.feedbackId);
  assert.equal(f.feedback.length, 1);
  assert.equal(f.feedback[0].relatedShareId, created.data.shareId);
  assert.equal(JSON.stringify(f.feedback[0]).includes(created.data.token), false);
});

test('协议层不缓存分享读取：撤销后同 requestId 也读不到旧快照', async () => {
  const f = fixture();
  const created = await f.service.createShare('owner', f.payload, 'req_share_008');
  const cache = new Map();
  const protocol = createProtocol({ repository: { pull() {} }, sharing: f.service,
    requestCache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }, now: f.now });
  const event = { action: 'share.get', payload: { token: created.data.token }, requestId: 'req_read_001' };
  assert.equal((await protocol.handle({ accountKey: 'reader' }, event)).ok, true);
  await f.service.revokeShare('owner', { shareId: created.data.shareId });
  assert.equal((await protocol.handle({ accountKey: 'reader' }, event)).code, 'SHARE_UNAVAILABLE');
});

test('源删除在写入前先撤销分享；撤销失败时不写账户', async () => {
  const calls = [];
  const doc = { accountKey: 'owner', generation: 1, version: 2,
    inspirations: [{ id: 'idea_1', text: '文字', photos: [] }] };
  const repo = createRepository({ db: { get: async () => doc,
    compareAndSwap: async () => { calls.push('write'); return true; } }, now: () => 123,
    beforeRemove: async () => { calls.push('revoke'); } });
  assert.equal((await repo.remove('owner', { inspirationId: 'idea_1', generation: 1, baseVersion: 2 })).ok, true);
  assert.deepEqual(calls, ['revoke', 'write']);
  const denied = createRepository({ db: { get: async () => doc,
    compareAndSwap: async () => { calls.push('unexpected'); return true; } }, now: () => 123,
    beforeRemove: async () => { throw Error('no access'); } });
  await assert.rejects(denied.remove('owner', { inspirationId: 'idea_1', generation: 1, baseVersion: 2 }));
  assert.equal(calls.includes('unexpected'), false);
});

test('海报分页不截断，超出可读页数拒绝；前端只允许已同步快照分享', () => {
  const text = '想法'.repeat(700);
  const pages = paginatePoster(text);
  assert.ok(pages && pages.length > 1 && pages.length <= 9);
  assert.equal(pages.flat().join(''), text);
  assert.equal(paginatePoster('字'.repeat(1801)), null);
  const f = fixture();
  const item = f.accounts.get('owner').inspirations[0];
  assert.equal(selectedPreview(item, ['a']), '原文\n第二行\n\n可见补充');
  assert.equal(shareRevision({}), null);
  assert.deepEqual(shareRevision({ getConfirmedRevision: () => ({ baseVersion: 2, generation: 1 }) }),
    { baseVersion: 2, generation: 1 });
  assert.equal(makeSnapshot(item, ['b'], 'chat'), null);
  assert.equal(dayStart(Date.UTC(2026, 8, 24, 7)), Date.UTC(2026, 8, 23, 16));
});
