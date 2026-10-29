'use strict';

const time = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function failure(code, message) { const error = new Error(message); error.code = code; throw error; }

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isValidTodo(value) {
  return value == null || object(value) &&
    Object.keys(value).every((key) => ['createdAt', 'completedAt', 'dueDate'].includes(key)) &&
    time(value.createdAt) && (value.completedAt === null || time(value.completedAt)) &&
    (value.dueDate == null || isValidDate(value.dueDate));
}

function normalizeTodo(value, existing) {
  if (value === undefined) return existing === undefined ? null : normalizeTodo(existing);
  if (!object(value)) return value;
  return Object.assign({}, value, { dueDate: value.dueDate !== undefined ? value.dueDate
    : existing && existing.dueDate !== undefined ? existing.dueDate : null });
}

function makeTodo(now, dueDate = null) {
  const todo = { createdAt: now, completedAt: null, dueDate };
  if (!isValidTodo(todo)) failure('INVALID_TODO', '待办时间或日期不正确');
  return Object.freeze(todo);
}

function updateTodo(item, options) {
  const source = options || {};
  if (!item || item.deletedAt != null) failure('NOT_FOUND', '找不到这条灵感');
  if (item.archivedAt != null) failure('INSPIRATION_ARCHIVED', '请先取消归档，再处理待办');
  if (item.mergedInto) failure('ALREADY_MERGED', '请先恢复为独立灵感，再处理待办');
  const supplementId = source.supplementId || '';
  const target = supplementId ? (item.supplements || []).find((row) => row.id === supplementId) : item;
  if (!target) failure('SUPPLEMENT_NOT_FOUND', '这条补充已经不存在');
  const before = normalizeTodo(target.todo);
  let next;
  switch (source.action) {
    case 'add': next = before || makeTodo(source.now, source.dueDate == null ? null : source.dueDate); break;
    case 'complete':
      if (!before) failure('TODO_NOT_FOUND', '这条内容还没有设为待办');
      if (!time(source.now)) failure('INVALID_TODO', '完成时间不正确');
      next = before.completedAt === null ? Object.assign({}, before, { completedAt: source.now }) : before; break;
    case 'reopen':
      if (!before) failure('TODO_NOT_FOUND', '这条内容还没有设为待办');
      next = Object.assign({}, before, { completedAt: null }); break;
    case 'date':
      if (!before) failure('TODO_NOT_FOUND', '这条内容还没有设为待办');
      next = Object.assign({}, before, { dueDate: source.dueDate == null ? null : source.dueDate }); break;
    case 'remove': next = null; break;
    case 'replace': next = normalizeTodo(source.todo); break;
    default: failure('INVALID_TODO_ACTION', '请选择要执行的待办操作');
  }
  if (!isValidTodo(next)) failure('INVALID_TODO', '待办时间或日期不正确');
  if (next) next = Object.freeze(Object.assign({}, next));
  return Object.freeze(Object.assign({}, item, supplementId ? {
    supplements: Object.freeze((item.supplements || []).map((row) => row.id === supplementId
      ? Object.freeze(Object.assign({}, row, { todo: next })) : row))
  } : { todo: next }));
}

function localDate(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function dateAfter(days, timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return localDate(date.getTime());
}

// 日期字符串表示本地日历日；用 UTC 日历分量计算星期和次日，避免时区、夏令时及 0—99 年构造偏移。
function calendarDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function nextCalendarDate(value) {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return String(date.getUTCFullYear()).padStart(4, '0') + '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function formatTodoDate(dueDate, today = localDate()) {
  if (!dueDate) return '未安排日期';
  const date = calendarDate(dueDate), monthDay = (date.getUTCMonth() + 1) + '月' + date.getUTCDate() + '日';
  const year = dueDate.slice(0, 4) === today.slice(0, 4) ? '' : date.getUTCFullYear() + '年';
  if (dueDate === today) return '今天 · ' + monthDay;
  if (dueDate === nextCalendarDate(today)) return '明天 · ' + year + monthDay;
  return year + monthDay + ' 周' + ['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()];
}

function collectTodos(inspirations) {
  const rows = [];
  (inspirations || []).filter((item) => item && item.deletedAt == null).forEach((item) => {
    const add = (target, supplementId) => {
      if (!target.todo) return;
      const todo = normalizeTodo(target.todo);
      rows.push({ key: item.id + ':' + supplementId, inspirationId: item.id, supplementId,
        text: supplementId ? target.content : item.text, parentText: supplementId ? item.text : '', todo,
        archived: item.archivedAt != null, merged: Boolean(item.mergedInto),
        archivedAt: item.archivedAt == null ? null : item.archivedAt,
        hidden: Boolean(supplementId && (target.foldedAt != null || target.mergedInto)),
        completed: todo.completedAt !== null });
    };
    add(item, ''); (item.supplements || []).forEach((entry) => add(entry, entry.id));
  });
  return rows;
}

function todoCounts(item) {
  const rows = collectTodos(item ? [item] : []);
  const done = rows.filter((row) => row.completed).length;
  return { pending: rows.length - done, done, total: rows.length };
}

function boardView(inspirations, options = {}) {
  const rows = collectTodos(inspirations), today = options.today || localDate();
  const tomorrow = nextCalendarDate(today);
  const done = rows.filter((row) => row.completed).length;
  const counts = { all: rows.length, pending: rows.length - done, done };
  const scope = options.scope || 'pending', query = String(options.query || '').trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => (scope === 'all' || (scope === 'done') === row.completed) &&
    (!query || (row.text + '\n' + row.parentText).toLocaleLowerCase().includes(query)));
  const futureDates = Array.from(new Set(filtered.filter(row => !row.completed && !row.archived &&
    row.todo.dueDate && row.todo.dueDate > tomorrow).map(row => row.todo.dueDate))).sort();
  const groups = [ ['overdue', '已逾期'], ['today', '今天'], ['tomorrow', '明天'],
    ...futureDates.map(date => ['date:' + date, formatTodoDate(date, today)]), ['undated', '未安排'],
    ['archived', '已归档的待办'], ['done', '已办'] ].map(([id, label]) => ({ id, label, items: [] }));
  const groupById = new Map(groups.map(group => [group.id, group]));
  filtered.forEach((row) => {
    const due = row.todo.dueDate;
    const id = row.completed ? 'done' : row.archived ? 'archived' : !due ? 'undated'
      : due < today ? 'overdue' : due === today ? 'today' : due === tomorrow ? 'tomorrow' : 'date:' + due;
    groupById.get(id).items.push(row);
  });
  groups.forEach((group) => group.items.sort((a, b) => group.id === 'done'
    ? b.todo.completedAt - a.todo.completedAt || a.key.localeCompare(b.key)
    : group.id === 'archived' ? b.archivedAt - a.archivedAt || a.todo.createdAt - b.todo.createdAt || a.key.localeCompare(b.key)
      : String(a.todo.dueDate || '').localeCompare(String(b.todo.dueDate || '')) || a.todo.createdAt - b.todo.createdAt || a.key.localeCompare(b.key)));
  return { counts, groups: groups.filter((group) => group.items.length), matchCount: filtered.length };
}

module.exports = { makeTodo, updateTodo, todoCounts, collectTodos, boardView, localDate, dateAfter, formatTodoDate,
  isValidDate, isValidTodo, normalizeTodo };
