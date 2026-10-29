const { boardView, collectTodos, localDate, dateAfter, isValidDate, formatTodoDate } = require('../../core/todo');
const { summarize, formatAbsolute } = require('../../core/format');
const { prepareTodoOperation, runTodoOperation } = require('../../services/todos');
const { beginPage, endPage, pageGuard, readPageAccount } = require('../../services/page-session');
const { startCapture } = require('../../services/capture-entry');

const UNKNOWN_CODES = ['NETWORK', 'INTERNAL', 'PULL_FAILED'];

function clearTimer(page, name) {
  if (page[name]) clearTimeout(page[name]);
  page[name] = null;
}

function syncAccount(page) {
  const app = getApp(), { store, sessionEpoch, cacheScope } = app.globalData;
  if (page.store !== store || page.epoch !== sessionEpoch || page.scope !== cacheScope || !store) {
    page.pendingOperation = null; page.operationPromise = null; page.settledOperation = null;
    page.undoOperation = null; page.expanded = {}; page.dateTargetTodo = null;
    clearTimer(page, 'undoTimer');
    page.setData({ groups: [], counts: { all: 0, pending: 0, done: 0 }, matchCount: 0,
      query: '', scope: 'pending', busy: false, blocked: false, operationError: '',
      undoVisible: false, dateVisible: false, dateKey: '', dateValue: '', error: '' });
  }
  page.store = store; page.epoch = sessionEpoch; page.scope = cacheScope;
}

function currentRows(page) {
  const app = getApp();
  if (page.visible === false || page.store !== app.globalData.store || page.epoch !== app.globalData.sessionEpoch ||
      page.scope !== app.globalData.cacheScope || !page.store) return [];
  try { return collectTodos(page.store.readSnapshot().inspirations); } catch (err) { return []; }
}

function rowFromEvent(page, event) {
  const key = event && event.currentTarget && event.currentTarget.dataset.key;
  return currentRows(page).find(row => row.key === key);
}

function renderedRow(page, event) {
  const key = event && event.currentTarget && event.currentTarget.dataset.key;
  for (const group of page.data.groups || []) {
    const row = group.items.find(item => item.key === key);
    if (row) return row;
  }
  return null;
}

function changedItem(page) {
  page.load();
  page.setData({ operationError: '事项已变化，请核对最新内容后重新操作。' });
}

function currentActionRow(page, rendered) {
  if (!rendered) return null;
  const actual = currentRows(page).find(row => row.key === rendered.key);
  if (!actual || rendered.archived || rendered.merged || actual.archived || actual.merged || !sameTodo(actual.todo, rendered.todo)) {
    changedItem(page); return null;
  }
  return actual;
}

function sameTodo(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return left.createdAt === right.createdAt && left.completedAt === right.completedAt &&
    (left.dueDate || null) === (right.dueDate || null);
}

function decorate(row, expanded, today) {
  return Object.assign({}, row, {
    expanded: Boolean(expanded && expanded[row.key]),
    longText: row.text.length > 110 || row.text.split('\n').length > 3,
    parentExcerpt: row.supplementId ? summarize(row.parentText, 38) : '',
    typeLabel: row.supplementId ? '补充待办' : '正文待办',
    dueLabel: formatTodoDate(row.todo.dueDate, today),
    completedLabel: row.completed ? formatAbsolute(row.todo.completedAt) : '',
    readOnly: row.archived || row.merged
  });
}

function actionError(result) {
  if (result && result.message) return result.message;
  if (result && ['CONFLICT', 'STALE_GENERATION'].includes(result.code)) return '内容已变化，请核对最新内容后重新操作。';
  if (result && ['ACCOUNT_SESSION_CHANGED', 'ACCOUNT_CHANGED'].includes(result.code)) return '账户状态已变化，请重新读取。';
  return '操作没有完成，请稍后重试。';
}

Page({
  data: {
    scopes: [{ id: 'all', label: '全部' }, { id: 'pending', label: '待办' }, { id: 'done', label: '已办' }],
    scope: 'pending', counts: { all: 0, pending: 0, done: 0 }, groups: [], matchCount: 0,
    query: '', loading: true, error: '', busy: false, blocked: false, operationError: '',
    undoVisible: false, dateVisible: false, dateKey: '', dateValue: ''
  },

  async onShow() {
    beginPage(this); syncAccount(this);
    this.setData({ loading: true, error: '' });
    const account = await readPageAccount(this);
    if (!account.isCurrent()) return;
    syncAccount(this);
    if (!account.store) {
      this.setData({ loading: false, error: account.app.globalData.accountError || '请稍后重试。' }); return;
    }
    this.load(); this.scheduleMidnight();
    const isCurrent = pageGuard(this);
    if (this.operationPromise) await this.operationPromise;
    if (!isCurrent()) return;
    if (this.settledOperation) {
      const settled = this.settledOperation; this.settledOperation = null;
      this.finishOperation(settled.operation, settled.result);
    }
    if (this.pendingOperation && !this.operationPromise) {
      this.setData({ operationError: '尚未确认操作结果，请重试确认。', blocked: true, busy: false });
    }
    // 返回看板时核对当前账户；失败保留已经确认过的内容与重试入口。
    await this.refreshView();
  },

  onHide() {
    endPage(this); clearTimer(this, 'midnightTimer'); clearTimer(this, 'undoTimer'); this.undoOperation = null; this.dateTargetTodo = null;
    this.setData({ groups: [], counts: { all: 0, pending: 0, done: 0 }, matchCount: 0,
      undoVisible: false, dateVisible: false, dateKey: '', dateValue: '', operationError: '' });
  },
  onUnload() { this.onHide(); this.pendingOperation = null; this.settledOperation = null; },

  scheduleMidnight() {
    clearTimer(this, 'midnightTimer');
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    this.midnightTimer = setTimeout(() => {
      if (this.visible === false) return;
      this.load(); this.scheduleMidnight();
    }, Math.max(1000, next - now.getTime() + 50));
    if (this.midnightTimer && this.midnightTimer.unref) this.midnightTimer.unref();
  },

  load() {
    syncAccount(this);
    if (!this.store) { this.setData({ loading: false, error: getApp().globalData.accountError || '请稍后重试。' }); return; }
    try {
      const today = localDate();
      const view = boardView(this.store.readSnapshot().inspirations, {
        scope: this.data.scope, query: this.data.query, today
      });
      this.setData({ groups: view.groups.map(group => Object.assign({}, group, {
        items: group.items.map(row => decorate(row, this.expanded, today))
      })), counts: view.counts, matchCount: view.matchCount, loading: false, error: '',
      blocked: Boolean(this.pendingOperation), busy: Boolean(this.operationPromise) });
    } catch (err) { this.setData({ loading: false, error: '暂时无法读取待办，请稍后重试。' }); }
  },

  async refreshView() {
    if (this.visible === false) return;
    syncAccount(this);
    const store = this.store, isCurrent = pageGuard(this), version = this.viewVersion;
    let task = this.refreshTask;
    if (!task || task.store !== store || task.epoch !== this.epoch) {
      task = { store, epoch: this.epoch, requestedEpoch: this.epoch };
      this.refreshTask = task;
      task.promise = (async () => {
        try {
          if (store && typeof store.refresh === 'function') return await store.refresh();
          const app = getApp(), pending = app.refreshAccount();
          task.requestedEpoch = app.globalData.sessionEpoch;
          return await pending ? { ok: true } : { ok: false };
        } catch (err) { return null; }
      })();
    }
    const result = await task.promise;
    if (this.refreshTask === task) this.refreshTask = null;
    if (store ? !isCurrent() : this.visible === false || this.viewVersion !== version ||
        getApp().globalData.sessionEpoch !== task.requestedEpoch) return;
    if (!store && result && result.ok) syncAccount(this);
    if (!result || !result.ok) {
      this.setData({ loading: false, error: this.data.groups.length
        ? '暂时无法更新，仍显示上次读取的内容。' : '暂时无法读取待办，请重试。' }); return;
    }
    this.load();
    this.reconcileOperation();
  },

  // 仅核对已读回的快照，不在刷新时重发未知写入。
  reconcileOperation() {
    const operation = this.pendingOperation;
    if (!operation || this.operationPromise || operation.store !== this.store) return;
    const revision = this.store.getConfirmedRevision();
    if (revision.generation !== operation.revision.generation) {
      this.finishOperation(operation, { ok: false, code: 'STALE_GENERATION' }); return;
    }
    const item = this.store.getInspiration(operation.inspirationId);
    const source = item && (operation.supplementId
      ? (item.supplements || []).find(row => row.id === operation.supplementId) : item);
    if (!source) {
      this.finishOperation(operation, { ok: false, code: 'NOT_FOUND', message: '这条内容已经不存在，请核对最新事项。' }); return;
    }
    const confirmed = operation.action === 'unarchive' ? item.archivedAt == null
      : sameTodo(source.todo, operation.targetTodo);
    if (confirmed) {
      this.finishOperation(operation, { ok: true, synced: true }); return;
    }
    if (revision.baseVersion !== operation.revision.baseVersion) {
      this.finishOperation(operation, { ok: false, code: 'CONFLICT' });
    }
  },

  onRetry() { return this.refreshView(); },
  onPullDownRefresh() { return this.refreshView().finally(() => { if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); }); },
  onScope(event) {
    const scope = event.currentTarget.dataset.scope;
    if (!['all', 'pending', 'done'].includes(scope)) return;
    this.setData({ scope }); this.load();
  },
  onSearch(event) { this.setData({ query: event.detail.value }); this.load(); },
  onClearQuery() { this.setData({ query: '' }); this.load(); },
  onShowDone() { this.setData({ scope: 'done', query: '' }); this.load(); },
  onAdd() { startCapture({ todo: true }); },

  onOpen(event) {
    const row = rowFromEvent(this, event);
    if (!row) { this.load(); return; }
    wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(row.inspirationId) +
      (row.supplementId ? '&supplementId=' + encodeURIComponent(row.supplementId) : '') });
  },
  onExpand(event) {
    const row = rowFromEvent(this, event); if (!row) return;
    this.expanded = this.expanded || {}; this.expanded[row.key] = !this.expanded[row.key]; this.load();
  },

  onToggle(event) {
    if (this.data.busy || this.pendingOperation) return;
    const rendered = renderedRow(this, event);
    if (!rendered || rendered.archived || rendered.merged) return;
    const row = currentActionRow(this, rendered);
    if (!row) return;
    return this.changeTodo(row, rendered.completed ? 'reopen' : 'complete');
  },

  onMore(event) {
    if (this.data.busy || this.pendingOperation) return;
    const rendered = renderedRow(this, event);
    if (!rendered || rendered.archived || rendered.merged) return;
    const row = currentActionRow(this, rendered);
    if (!row) return;
    const expected = Object.assign({}, row, { todo: Object.assign({}, row.todo) });
    const isCurrent = pageGuard(this);
    wx.showActionSheet({ itemList: row.completed ? ['恢复待办', '移除待办'] : ['调整日期', '移除待办'],
      success: result => {
        if (!isCurrent() || this.pendingOperation) return;
        const actual = currentActionRow(this, expected);
        if (!actual) return;
        if (result.tapIndex === 1) { this.changeTodo(actual, 'remove'); return; }
        if (result.tapIndex !== 0) return;
        if (expected.completed) { this.changeTodo(actual, 'reopen'); return; }
        this.dateTargetTodo = Object.assign({}, actual.todo);
        this.setData({ dateVisible: true, dateKey: actual.key, dateValue: actual.todo.dueDate || localDate() });
      }
    });
  },
  onCloseDate() { this.dateTargetTodo = null; this.setData({ dateVisible: false, dateKey: '', dateValue: '' }); },
  noop() {},
  onDateQuick(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!['none', 'today', 'tomorrow'].includes(kind)) return;
    return this.saveDate(kind === 'none' ? null : kind === 'today' ? localDate() : dateAfter(1));
  },
  onDateSelected(event) { if (isValidDate(event.detail.value)) return this.saveDate(event.detail.value); },
  saveDate(dueDate) {
    const row = currentRows(this).find(item => item.key === this.data.dateKey);
    const expected = this.dateTargetTodo;
    this.onCloseDate();
    if (this.pendingOperation || this.visible === false || !expected) return;
    if (!row || row.archived || row.merged || row.completed || !sameTodo(row.todo, expected)) { changedItem(this); return; }
    return this.changeTodo(row, 'date', { dueDate });
  },

  onUnarchive(event) {
    if (this.data.busy || this.pendingOperation) return;
    const rendered = renderedRow(this, event);
    if (!rendered || !rendered.archived) return;
    const row = rowFromEvent(this, event);
    if (!row || !row.archived || row.archivedAt !== rendered.archivedAt) { changedItem(this); return; }
    const archivedAt = row.archivedAt;
    const isCurrent = pageGuard(this);
    wx.showModal({ title: '取消整条灵感归档？',
      content: '将恢复这条灵感及其中的全部补充，之后可以继续处理待办。',
      confirmText: '取消归档', cancelText: '返回', success: result => {
        if (!result.confirm || !isCurrent() || this.pendingOperation) return;
        const actual = currentRows(this).find(item => item.key === row.key);
        if (!actual || !actual.archived || actual.archivedAt !== archivedAt) { changedItem(this); return; }
        this.changeTodo(actual, 'unarchive');
      }
    });
  },

  async changeTodo(row, action, extra) {
    if (this.pendingOperation || this.data.busy || this.visible === false) return;
    let operation;
    try {
      operation = prepareTodoOperation(this.store, Object.assign({ inspirationId: row.inspirationId,
        supplementId: row.supplementId, action }, extra || {}));
    } catch (err) { this.setData({ operationError: actionError(err) }); this.load(); return; }
    this.undoOperation = null; clearTimer(this, 'undoTimer');
    this.pendingOperation = operation;
    this.setData({ undoVisible: false });
    return this.executeOperation(operation);
  },

  async executeOperation(operation) {
    const isCurrent = pageGuard(this);
    this.setData({ busy: true, blocked: true, operationError: '' });
    const promise = runTodoOperation(operation);
    this.operationPromise = promise;
    const result = await promise;
    if (this.operationPromise === promise) this.operationPromise = null;
    if (this.pendingOperation !== operation) return;
    if (!isCurrent()) { this.settledOperation = { operation, result }; return; }
    this.finishOperation(operation, result);
  },

  finishOperation(operation, result) {
    if (this.pendingOperation !== operation || this.store !== operation.store) return;
    this.settledOperation = null;
    if (result && result.ok && result.synced === true) {
      this.pendingOperation = null;
      this.setData({ busy: false, blocked: false, operationError: '' }); this.load();
      if (operation.action === 'complete') {
        this.undoOperation = operation; this.setData({ undoVisible: true });
        clearTimer(this, 'undoTimer');
        this.undoTimer = setTimeout(() => {
          this.undoOperation = null;
          if (this.visible !== false) this.setData({ undoVisible: false });
        }, 5000);
        if (this.undoTimer && this.undoTimer.unref) this.undoTimer.unref();
      }
      return;
    }
    const unknown = result && UNKNOWN_CODES.includes(result.code);
    if (!unknown) this.pendingOperation = null;
    this.setData({ busy: false, blocked: unknown,
      operationError: unknown ? '尚未确认操作结果，请重试确认。' : actionError(result) });
    this.load();
  },

  onRetryOperation() {
    if (!this.pendingOperation || this.operationPromise || this.visible === false) return;
    if (this.pendingOperation.store !== getApp().globalData.store || this.epoch !== getApp().globalData.sessionEpoch) {
      syncAccount(this); this.load(); return;
    }
    return this.executeOperation(this.pendingOperation);
  },

  onUndo() {
    if (!this.undoOperation || this.pendingOperation || this.data.busy) return;
    const previous = this.undoOperation;
    const row = currentRows(this).find(item => item.inspirationId === previous.inspirationId && item.supplementId === previous.supplementId);
    this.undoOperation = null; clearTimer(this, 'undoTimer'); this.setData({ undoVisible: false });
    if (!row || row.archived || row.merged || !sameTodo(row.todo, previous.targetTodo)) {
      this.setData({ operationError: '事项已变化，请核对最新内容后重新操作。' }); this.load(); return;
    }
    return this.changeTodo(row, 'replace', { todo: previous.beforeTodo });
  }
});
