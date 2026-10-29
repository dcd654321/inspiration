'use strict';

const { updateTodo, normalizeTodo } = require('../core/todo');
const { unarchive } = require('../core/inspiration');
const { createRequestId } = require('./wx-transport');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function sameTodo(left, right) {
  const a = normalizeTodo(left), b = normalizeTodo(right);
  return a === null && b === null || Boolean(a && b && a.createdAt === b.createdAt &&
    a.completedAt === b.completedAt && a.dueDate === b.dueDate);
}
function readTodo(item, supplementId) {
  const source = item && (supplementId ? (item.supplements || []).find((row) => row.id === supplementId) : item);
  return source ? normalizeTodo(source.todo) : undefined;
}

function prepareTodoOperation(store, options = {}) {
  if (!store || typeof store.getConfirmedRevision !== 'function') fail('ACCOUNT_SESSION_CHANGED', '请重新读取账户后再操作');
  const item = store.getInspiration(options.inspirationId);
  if (!item) fail('NOT_FOUND', '找不到这条灵感');
  const supplementId = options.supplementId || '';
  const beforeTodo = readTodo(item, supplementId);
  if (beforeTodo === undefined && supplementId) fail('SUPPLEMENT_NOT_FOUND', '这条补充已经不存在');
  const now = options.now === undefined ? Date.now() : options.now;
  const target = options.action === 'unarchive' ? unarchive(item)
    : updateTodo(item, Object.assign({}, options, { supplementId, now }));
  return { store, inspirationId: item.id, supplementId, action: options.action,
    revision: Object.assign({}, store.getConfirmedRevision()), target, beforeTodo,
    targetTodo: readTodo(target, supplementId), requestId: createRequestId(), attempted: false, inFlight: null };
}

async function perform(operation) {
  const op = operation, store = op.store;
  if (op.attempted) {
    let refreshed;
    try { refreshed = await store.refresh(); } catch (error) { refreshed = { ok: false, code: 'NETWORK' }; }
    if (!refreshed || !refreshed.ok) return refreshed || { ok: false, code: 'NETWORK' };
  }
  const revision = store.getConfirmedRevision();
  if (revision.generation !== op.revision.generation) return { ok: false, code: 'STALE_GENERATION', message: '账户状态已变化，请重新核对待办' };
  const item = store.getInspiration(op.inspirationId);
  if (!item) return { ok: false, code: 'NOT_FOUND', message: '这条灵感已经不存在' };
  const actual = readTodo(item, op.supplementId);
  const confirmed = op.action === 'unarchive' ? item.archivedAt == null : actual !== undefined && sameTodo(actual, op.targetTodo);
  if (confirmed) return { ok: true, synced: true };
  if (revision.baseVersion !== op.revision.baseVersion) return { ok: false, code: 'CONFLICT', message: '内容已更新，请核对后重新操作' };
  op.attempted = true;
  try {
    const result = await store.saveInspiration(op.target, { expectedRevision: op.revision, requestId: op.requestId });
    return result || { ok: false, code: 'NETWORK' };
  } catch (error) { return { ok: false, code: 'NETWORK' }; }
}

function runTodoOperation(operation) {
  if (!operation || !operation.store) return Promise.resolve({ ok: false, code: 'INVALID_PAYLOAD' });
  if (operation.inFlight) return operation.inFlight;
  operation.inFlight = perform(operation).catch(() => ({ ok: false, code: 'NETWORK' })).finally(() => { operation.inFlight = null; });
  return operation.inFlight;
}

module.exports = { prepareTodoOperation, runTodoOperation };
