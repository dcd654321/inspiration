'use strict';

// 分享与反馈的服务端业务。db、公开内容审核与小程序码都从入口注入，便于单测。
// 这里永远不接受客户端身份、正文或分享记录作为事实来源。

const crypto = require('node:crypto');

const TOKEN_RE = /^[A-Za-z0-9]{28}$/;
const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REQUEST_RE = /^[A-Za-z0-9_-]{8,128}$/;
const DAY = 24 * 60 * 60 * 1000;
const SHARE_LIFETIME = 30 * DAY;
const MAX_ACTIVE = 20;
const MAX_SHARE_DAY = 10;
const MAX_FEEDBACK_DAY = 5;

function ok(data) { return { ok: true, data }; }
function fail(code, message) { return { ok: false, code, message }; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ownKeysOnly(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
}
function dayStart(ms) { return Math.floor((ms + 8 * 3600000) / DAY) * DAY - 8 * 3600000; }
function validRequest(id) { return typeof id === 'string' && REQUEST_RE.test(id); }
function isActiveSupplement(item) { return !item.mergedInto && !item.foldedAt; }

function makeRandomToken(randomBytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (result.length < 28) {
    for (const byte of randomBytes(36)) {
      if (byte < 248) result += chars[byte % 62];
      if (result.length === 28) break;
    }
  }
  return result;
}

function makeId(at, randomBytes) {
  return at.toString(36).padStart(10, '0') + '_' + randomBytes(8).toString('hex');
}

function makeSnapshot(item, selectedIds, channel) {
  if (!item || typeof item.text !== 'string' || !item.text.trim() || !Array.isArray(item.supplements)) return null;
  if (!Array.isArray(selectedIds) || selectedIds.length > 100 ||
    selectedIds.some((id) => typeof id !== 'string' || !ID_RE.test(id)) ||
    new Set(selectedIds).size !== selectedIds.length) return null;
  const selected = new Set(selectedIds);
  const valid = item.supplements.filter(isActiveSupplement);
  if (selectedIds.some((id) => !valid.some((s) => s.id === id))) return null;
  const contents = valid.filter((s) => selected.has(s.id))
    .sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))
    .map((s) => typeof s.content === 'string' ? s.content.trim() : '');
  if (contents.some((text) => !text)) return null;
  const body = [item.text.trim()].concat(contents).join('\n\n');
  const max = channel === 'timeline_poster' ? 1800 : 6000;
  if (body.length > max) return { tooLong: true, max };
  const title = item.text.trim().split(/\r?\n/)[0].slice(0, 50);
  return { title, body };
}

function publicView(doc) {
  return {
    title: doc.snapshot.title,
    body: doc.snapshot.body,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt
  };
}

function createSharingFeedbackService(options) {
  const opts = options || {};
  const db = opts.db;
  const now = opts.now || Date.now;
  const randomBytes = opts.randomBytes || crypto.randomBytes;
  const checkPublicText = opts.checkPublicText;
  const generateCode = opts.generateCode;
  const keyId = opts.keyId || 'v1';
  const createEnabled = opts.createEnabled === true;
  const tokenKey = Buffer.isBuffer(opts.tokenKey) && opts.tokenKey.length === 32 ? opts.tokenKey : null;
  const tokenKeys = Object.assign({}, opts.tokenKeys || {});
  if (tokenKey) tokenKeys[keyId] = tokenKey;
  if (!db) throw new Error('createSharingFeedbackService 需要 db');

  function encryptToken(token) {
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey, iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  function decryptToken(record) {
    if (!record) return null;
    const decryptKey = tokenKeys[record.keyId];
    if (!Buffer.isBuffer(decryptKey) || decryptKey.length !== 32) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', decryptKey, Buffer.from(record.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const token = Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
      return TOKEN_RE.test(token) ? token : null;
    } catch (err) { return null; }
  }

  async function activeShare(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const doc = await db.findShareByHash(sha(token));
    if (!doc || doc.revokedAt != null || doc.payloadPurgedAt != null || doc.expiresAt <= now() ||
      !doc.snapshot || !doc.snapshot.body) return null;
    const account = await db.getAccount(doc.ownerAccountKey);
    if (!account || account.generation !== doc.sourceGeneration || !Array.isArray(account.inspirations) ||
      !account.inspirations.some((item) => item.id === doc.sourceInspirationId && item.deletedAt == null)) return null;
    return doc;
  }

  async function createShare(accountKey, payload, requestId) {
    if (!createEnabled) return fail('SHARE_NOT_CONFIGURED', '分享暂不可用，请稍后再试');
    if (!validRequest(requestId) || !ownKeysOnly(payload,
      ['inspirationId', 'selectedSupplementIds', 'baseVersion', 'generation', 'channelIntent']) ||
      !ID_RE.test(payload.inspirationId || '') || !Number.isSafeInteger(payload.baseVersion) ||
      payload.baseVersion < 0 || !Number.isSafeInteger(payload.generation) || payload.generation < 1 ||
      !['chat', 'timeline_poster'].includes(payload.channelIntent)) {
      return fail('INVALID_PAYLOAD', '分享参数无效');
    }
    const selected = payload.selectedSupplementIds;
    if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string')) {
      return fail('INVALID_PAYLOAD', '请选择要分享的文字');
    }
    const digest = sha(JSON.stringify([payload.inspirationId, selected, payload.baseVersion,
      payload.generation, payload.channelIntent]));
    const previous = await db.findShareByRequest(accountKey, requestId);
    if (previous) {
      if (previous.requestDigest !== digest) return fail('REQUEST_ID_REUSED', '请求标识与操作内容不一致');
      const token = decryptToken(previous.tokenCiphertext);
      if (!token || previous.revokedAt != null || previous.expiresAt <= now() || !previous.snapshot) {
        return fail('SHARE_RETRY_UNAVAILABLE', '原分享已无法继续，请重新创建');
      }
      if (!await activeShare(token)) return fail('SHARE_RETRY_UNAVAILABLE', '原分享已无法继续，请重新创建');
      return ok({ shareId: previous._id, token, expiresAt: previous.expiresAt, preview: publicView(previous) });
    }
    if (!tokenKey) return fail('SHARE_NOT_CONFIGURED', '分享暂不可用，请稍后再试');
    if (typeof checkPublicText !== 'function') return fail('SHARE_REVIEW_UNAVAILABLE', '暂时无法审核分享内容');

    const account = await db.getAccount(accountKey);
    if (!account || account.generation !== payload.generation || account.version !== payload.baseVersion) {
      return fail('BACKUP_PENDING', '请先完成备份或处理冲突');
    }
    const item = account.inspirations && account.inspirations.find((x) => x.id === payload.inspirationId && x.deletedAt == null);
    if (!item) return fail('NOT_FOUND', '这条灵感已经不存在');
    const snapshot = makeSnapshot(item, selected, payload.channelIntent);
    if (!snapshot) return fail('INVALID_PAYLOAD', '分享范围无效');
    if (snapshot.tooLong) return fail('SHARE_TOO_LONG', '本次最多分享 ' + snapshot.max + ' 字，请缩小范围');

    const at = now();
    const activeCount = await db.countActiveShares(accountKey, at);
    const todayCount = await db.countSharesSince(accountKey, dayStart(at));
    if (activeCount >= MAX_ACTIVE || todayCount >= MAX_SHARE_DAY) return fail('SHARE_LIMIT', '今天创建的分享或有效分享已达上限');
    let reviewed;
    try { reviewed = await checkPublicText(snapshot.body); }
    catch (err) { return fail('SHARE_REVIEW_UNAVAILABLE', '暂时无法审核分享内容'); }
    if (reviewed !== true) return fail('SHARE_CONTENT_REJECTED', '这段内容暂时无法公开分享');

    // 审核可能耗时；写前再次确认同一云端版本，避免把审核期间的新编辑误当旧稿。
    const latest = await db.getAccount(accountKey);
    if (!latest || latest.generation !== payload.generation || latest.version !== payload.baseVersion ||
      !latest.inspirations.some((x) => x.id === payload.inspirationId && x.deletedAt == null)) {
      return fail('CONFLICT', '内容已变化，请重新预览后分享');
    }
    const token = makeRandomToken(randomBytes);
    const doc = {
      _id: makeId(at, randomBytes), ownerAccountKey: accountKey,
      sourceInspirationId: payload.inspirationId, sourceGeneration: payload.generation,
      sourceVersion: payload.baseVersion, selectedSupplementIds: selected.slice(), snapshot,
      snapshotDigest: sha(JSON.stringify(snapshot)), channelIntent: payload.channelIntent,
      tokenHash: sha(token), tokenCiphertext: encryptToken(token), requestId,
      requestDigest: digest, createdAt: at, expiresAt: at + SHARE_LIFETIME,
      revokedAt: null, payloadPurgedAt: null
    };
    try { await db.insertShare(doc); }
    catch (err) {
      const raced = await db.findShareByRequest(accountKey, requestId);
      if (!raced || raced.requestDigest !== digest) return fail('INTERNAL', '分享暂时无法创建');
      const oldToken = decryptToken(raced.tokenCiphertext);
      if (!oldToken || !await activeShare(oldToken)) {
        return fail('SHARE_RETRY_UNAVAILABLE', '原分享已无法继续，请重新创建');
      }
      return ok({ shareId: raced._id, token: oldToken, expiresAt: raced.expiresAt, preview: publicView(raced) });
    }
    return ok({ shareId: doc._id, token, expiresAt: doc.expiresAt, preview: publicView(doc) });
  }

  async function getShare(accountKey, payload) {
    if (!ownKeysOnly(payload, ['token'])) return fail('SHARE_UNAVAILABLE', '这份分享已无法查看');
    const doc = await activeShare(payload.token);
    return doc ? ok(publicView(doc)) : fail('SHARE_UNAVAILABLE', '这份分享已无法查看');
  }

  async function listMine(accountKey, payload) {
    if (!ownKeysOnly(payload, ['before']) ||
      (payload.before != null && (typeof payload.before !== 'string' || payload.before.length > 80))) {
      return fail('INVALID_PAYLOAD', '列表参数无效');
    }
    const records = await db.listShares(accountKey, payload.before || null, 20);
    const account = await db.getAccount(accountKey);
    const items = records.map((doc) => ({
      shareId: doc._id, sourceInspirationId: doc.sourceInspirationId,
      title: doc.snapshot ? doc.snapshot.title : '',
      preview: doc.snapshot ? doc.snapshot.body.slice(0, 90) : '',
      createdAt: doc.createdAt, expiresAt: doc.expiresAt, channelIntent: doc.channelIntent,
      status: doc.revokedAt != null ? 'revoked' : doc.expiresAt <= now() || doc.payloadPurgedAt != null ? 'expired' :
        !account || account.generation !== doc.sourceGeneration ||
        !Array.isArray(account.inspirations) ||
        !account.inspirations.some((item) => item.id === doc.sourceInspirationId && item.deletedAt == null)
          ? 'unavailable' : 'active'
    }));
    return ok({ items, nextBefore: records.length === 20 ? records[records.length - 1]._id : null });
  }

  async function revokeShare(accountKey, payload) {
    if (!ownKeysOnly(payload, ['shareId']) || typeof payload.shareId !== 'string' || payload.shareId.length > 80) {
      return fail('INVALID_PAYLOAD', '分享标识无效');
    }
    const doc = await db.findShareById(payload.shareId);
    if (!doc || doc.ownerAccountKey !== accountKey) return fail('NOT_FOUND', '找不到这份分享');
    if (doc.revokedAt == null) await db.revokeShare(accountKey, doc._id, now());
    return ok({ revoked: true });
  }

  async function revokeForSource(accountKey, inspirationId) {
    await db.revokeSharesForSource(accountKey, inspirationId, now());
  }

  async function getShareCode(accountKey, payload) {
    if (!ownKeysOnly(payload, ['token']) || typeof generateCode !== 'function') {
      return fail('TOKEN_OR_QR_FAILED', '暂时无法生成小程序码');
    }
    const doc = await activeShare(payload.token);
    if (!doc) return fail('SHARE_UNAVAILABLE', '这份分享已无法查看');
    try {
      const image = await generateCode('s=' + payload.token, 'pages/shared/index');
      if (!Buffer.isBuffer(image) || image.length === 0 || image.length > 512 * 1024) throw Error('INVALID_IMAGE');
      return ok({ pngBase64: image.toString('base64') });
    } catch (err) { return fail('TOKEN_OR_QR_FAILED', '暂时无法生成小程序码'); }
  }

  function feedbackView(doc) {
    return { feedbackId: doc._id, category: doc.category, body: doc.body,
      status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  }

  async function saveFeedback(accountKey, category, body, requestId, shareId) {
    if (!validRequest(requestId) || typeof body !== 'string' || body.trim().length < 10 || body.trim().length > 1000) {
      return fail('INVALID_PAYLOAD', '请填写 10 到 1000 字的意见');
    }
    const text = body.trim();
    const previous = await db.findFeedbackByRequest(accountKey, requestId);
    const digest = sha(JSON.stringify([category, text, shareId || null]));
    if (previous) return previous.requestDigest === digest
      ? ok(feedbackView(previous)) : fail('REQUEST_ID_REUSED', '请求标识与操作内容不一致');
    const at = now();
    if (await db.countFeedbackSince(accountKey, dayStart(at)) >= MAX_FEEDBACK_DAY) {
      return fail('FEEDBACK_LIMIT', '今天提交的反馈已达上限');
    }
    const day = new Date(at + 8 * 3600000).toISOString().slice(0, 10);
    const id = makeId(at, randomBytes);
    const dedupeKey = category === 'share_report'
      ? 'r_' + sha(JSON.stringify([accountKey, shareId, day]))
      : 'f_' + randomBytes(16).toString('hex');
    if (category === 'share_report') {
      const existing = await db.findFeedbackByDedupeKey(dedupeKey);
      if (existing) return ok(feedbackView(existing));
    }
    const doc = { _id: id, accountKey, requestId, requestDigest: digest, dedupeKey, category,
      body: text, relatedShareId: shareId || null, reportDayKey: shareId ? day : null,
      status: 'submitted', createdAt: at, updatedAt: at, closedAt: null };
    try { await db.insertFeedback(doc); }
    catch (err) {
      const raced = await db.findFeedbackByRequest(accountKey, requestId) ||
        (category === 'share_report' ? await db.findFeedbackByDedupeKey(dedupeKey) : null);
      if (!raced || raced.accountKey !== accountKey) return fail('INTERNAL', '反馈暂时无法提交');
      return ok(feedbackView(raced));
    }
    return ok(feedbackView(doc));
  }

  async function createFeedback(accountKey, payload, requestId) {
    if (!ownKeysOnly(payload, ['category', 'body']) || !['bug', 'idea', 'other'].includes(payload.category)) {
      return fail('INVALID_PAYLOAD', '反馈类别无效');
    }
    return saveFeedback(accountKey, payload.category, payload.body, requestId, null);
  }

  async function reportShare(accountKey, payload, requestId) {
    if (!ownKeysOnly(payload, ['token', 'body'])) return fail('INVALID_PAYLOAD', '举报内容无效');
    const doc = await activeShare(payload.token);
    if (!doc) return fail('SHARE_UNAVAILABLE', '这份分享已无法查看');
    return saveFeedback(accountKey, 'share_report', payload.body, requestId, doc._id);
  }

  async function listFeedback(accountKey, payload) {
    if (!ownKeysOnly(payload, ['before']) ||
      (payload.before != null && (typeof payload.before !== 'string' || payload.before.length > 80))) {
      return fail('INVALID_PAYLOAD', '列表参数无效');
    }
    const records = await db.listFeedback(accountKey, payload.before || null, 20);
    return ok({ items: records.map(feedbackView), nextBefore: records.length === 20 ? records[records.length - 1]._id : null });
  }

  return { createShare, getShare, listMine, revokeShare, revokeForSource,
    getShareCode, createFeedback, reportShare, listFeedback };
}

module.exports = { createSharingFeedbackService, makeSnapshot, dayStart, TOKEN_RE };
