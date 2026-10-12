'use strict';
const crypto = require('node:crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const MONITOR_WAIT_MS = 500;

async function settleMonitoring(work, onFailure = () => {}) {
  let timer, finished = false;
  const report = (code) => { if (!finished) { try { onFailure(code); } catch (_) {} } };
  const pending = Promise.resolve().then(work).then(() => true, () => { report('MONITOR_WRITE_FAILED'); return false; });
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { report('MONITOR_WRITE_TIMEOUT'); resolve(false); }, MONITOR_WAIT_MS); });
  try { return await Promise.race([pending, deadline]); }
  finally { finished = true; clearTimeout(timer); }
}

function createCommittedMonitor({ db, now = Date.now, onFailure = () => {} }) {
  return async function committed({ accountKey, sourceUserId, before, after }) {
    if (!/^user_[a-f0-9]{24}$/.test(sourceUserId || '')) return;
    const previous = new Map((before.inspirations || []).map((item) => [item.id, item]));
    const events = [];
    function add(type, recordId, entityId) {
      const eventId = 'lg:' + hash([after.generation, accountKey, after.version, type, recordId, entityId].join('|'));
      const at = new Date(now());
      events.push({ _id: 'evt_' + hash('linggan|' + sourceUserId + '|' + eventId), appId: 'linggan',
        type, sourceUserId, eventId, occurredAt: at, createdAt: at, payload: {} });
    }
    for (const item of after.inspirations || []) {
      const old = previous.get(item.id);
      if (!old) {
        add('record_saved', item.id, item.id);
        if (Object.prototype.hasOwnProperty.call(item, 'templateId')) add('output_saved', item.id, item.id);
      }
      const oldSupplements = new Set((old && old.supplements || []).map((entry) => entry.id));
      for (const entry of item.supplements || []) if (!oldSupplements.has(entry.id)) add('supplement_saved', item.id, entry.id);
    }
    for (const event of events) {
      try {
        const found = await db.collection('linggan_accounts').where({ accountKey }).limit(1).get();
        const account = found && Array.isArray(found.data) ? found.data[0] : null;
        if (!account || !account._id) continue;
        await db.runTransaction(async (transaction) => {
          const accountRef = transaction.collection('linggan_accounts').doc(account._id);
          const result = await accountRef.get();
          const current = result && (Array.isArray(result.data) ? result.data[0] : result.data);
          if (!current || current.accountKey !== accountKey || current.generation !== after.generation) return;
          // 快照只读不能阻挡代际变更；实际更新同账户使旧事件事务产生写冲突。
          await accountRef.update({ data: { _monitorFence: db.command.inc(1) } });
          await transaction.collection('monitor_events').add({ data: event });
        });
      }
      catch (error) {
        // 重复 add 不覆盖首次服务端时间；其他失败只报告固定码。
        const duplicate = error && (error.code === 'DUPLICATE' || error.code === 'DATABASE_DUPLICATE_KEY' || error.code === 11000 ||
          /\bE11000\b/.test(typeof error.errMsg === 'string' ? error.errMsg : typeof error.message === 'string' ? error.message : ''));
        if (!duplicate) { try { onFailure('MONITOR_EVENT_WRITE_FAILED'); } catch (_) { /* 诊断也不改变业务确认。 */ } }
      }
    }
  };
}
module.exports = { createCommittedMonitor, settleMonitoring, MONITOR_WAIT_MS };
