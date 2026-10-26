'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const inspiration = require('../miniprogram/core/inspiration');
const todo = require('../miniprogram/core/todo');
const { validRecord } = require('../server/record-validation');

const original = (id = 'idea') => inspiration.createInspiration({ id, text: '做一次城市漫步', now: 10 });
const supplemented = () => inspiration.appendSupplement(original(), { id: 'route', content: '提前查路线', now: 20 });

test('待办领域：正文和补充独立完成恢复移除且不改文字时间历史', () => {
  const note = supplemented();
  assert.equal(note.todo, null); assert.equal(note.supplements[0].todo, null);
  let item = todo.updateTodo(note, { action: 'add', now: 30, dueDate: '2026-10-21' });
  item = todo.updateTodo(item, { supplementId: 'route', action: 'add', now: 31 });
  item = todo.updateTodo(item, { supplementId: 'route', action: 'complete', now: 40 });
  assert.deepEqual(todo.todoCounts(item), { pending: 1, done: 1, total: 2 });
  assert.equal(item.todo.completedAt, null);
  assert.equal(item.supplements[0].todo.completedAt, 40);
  item = todo.updateTodo(item, { action: 'complete', now: 50 });
  item = todo.updateTodo(item, { action: 'reopen' });
  assert.deepEqual(item.todo, todo.makeTodo(30, '2026-10-21'));
  item = todo.updateTodo(item, { supplementId: 'route', action: 'remove' });
  assert.equal(item.supplements[0].content, note.supplements[0].content);
  assert.equal(item.supplements[0].todo, null);
  assert.equal(item.updatedAt, note.updatedAt);
  assert.deepEqual(item.textHistory, note.textHistory);
  assert.deepEqual(item.supplements[0].contentHistory, note.supplements[0].contentHistory);
  assert.equal(note.todo, null, '操作不改入参');
});

test('待办领域：记录补充原子携带日期，非法日期和待办结构双端拒绝', () => {
  const meta = todo.makeTodo(30, '2028-02-29');
  const note = inspiration.createInspiration({ id: 'new', text: '要执行', now: 30, todo: meta });
  const item = inspiration.appendSupplement(note, { id: 'step', content: '下一步', now: 31, todo: todo.makeTodo(31) });
  assert.equal(validRecord(item), true);
  for (const date of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '0000-01-01', '', 1]) {
    assert.equal(todo.isValidDate(date), false);
    assert.throws(() => todo.makeTodo(1, date));
    assert.equal(validRecord({ ...note, todo: { ...meta, dueDate: date } }), false);
  }
  for (const bad of [false, [], { ...meta, createdAt: -1 }, { ...meta, completedAt: undefined }, { ...meta, extra: 1 }]) {
    assert.equal(validRecord({ ...note, todo: bad }), false);
    assert.throws(() => inspiration.createInspiration({ id: 'bad', text: '错误', now: 1, todo: bad }));
    assert.throws(() => inspiration.appendSupplement(note, { id: 'bad', content: '错误', now: 1, todo: bad }));
  }
  assert.equal(todo.isValidDate('2000-02-29'), true);
  assert.equal(todo.isValidDate('1900-02-29'), false);
});

test('待办领域：文字修改和并入正文保留任务，另存默认无待办', () => {
  let item = todo.updateTodo(supplemented(), { supplementId: 'route', action: 'add', now: 30 });
  item = inspiration.editSupplement(item, { supplementId: 'route', content: '确认新的路线', historyId: 'h1', now: 40 });
  item = inspiration.foldIntoText(item, { supplementId: 'route', historyId: 'h2', now: 50 });
  const rows = todo.collectTodos([item]);
  assert.equal(rows.length, 1); assert.equal(rows[0].hidden, true);
  assert.equal(rows[0].text, '确认新的路线'); assert.equal(rows[0].supplementId, 'route');
  assert.equal(rows[0].todo.createdAt, 30);
  const saved = inspiration.createInspiration({ id: 'saved', text: item.text, now: 60 });
  assert.equal(todo.todoCounts(saved).total, 0);
});

test('待办看板：数量包含归档收起合并来源，搜索仅筛当前范围', () => {
  const pending = { ...original('pending'), todo: todo.makeTodo(10, '2026-10-20') };
  const done = { ...original('done'), todo: { ...todo.makeTodo(20), completedAt: 60 } };
  const archived = { ...supplemented(), archivedAt: 30,
    supplements: [{ ...supplemented().supplements[0], todo: todo.makeTodo(5), foldedAt: 0 }] };
  const merged = { ...original('merged'), mergedInto: 'pending', todo: todo.makeTodo(25) };
  const deleted = { ...original('deleted'), deletedAt: 0, todo: todo.makeTodo(1) };
  const items = [pending, done, archived, merged, deleted];
  const view = todo.boardView(items, { scope: 'all', today: '2026-10-21' });
  assert.deepEqual(view.counts, { all: 4, pending: 3, done: 1 });
  assert.deepEqual(view.groups.map((row) => row.id), ['overdue', 'undated', 'archived', 'done']);
  const searched = todo.boardView(items, { scope: 'pending', query: '提前', today: '2026-10-21' });
  assert.deepEqual(searched.counts, view.counts); assert.equal(searched.matchCount, 1);
  assert.equal(searched.groups[0].items[0].hidden, true);
  assert.equal(todo.boardView(items, { scope: 'done', query: '提前' }).matchCount, 0);
  assert.equal(todo.boardView(items, { scope: 'pending', query: '城市漫步' }).matchCount, 3, '补充也能按所属灵感查找');
});

test('待办日期：相对日期具体日期跨年和闰日统一展示', () => {
  const cases = [
    [null, '2026-10-24', '未安排日期'],
    [undefined, '2026-10-24', '未安排日期'],
    ['2026-10-23', '2026-10-24', '10月23日 周五'],
    ['2026-10-24', '2026-10-24', '今天 · 10月24日'],
    ['2026-10-25', '2026-10-24', '明天 · 10月25日'],
    ['2026-10-26', '2026-10-24', '10月26日 周一'],
    ['2027-01-02', '2026-10-24', '2027年1月2日 周六'],
    ['2025-12-31', '2026-10-24', '2025年12月31日 周三'],
    ['2028-02-29', '2028-02-28', '明天 · 2月29日'],
    ['2028-02-29', '2028-02-27', '2月29日 周二'],
    ['2026-11-01', '2026-10-31', '明天 · 11月1日'],
    ['2027-01-01', '2026-12-31', '明天 · 2027年1月1日']
  ];
  for (const [dueDate, today, label] of cases) assert.equal(todo.formatTodoDate(dueDate, today), label);
});

test('待办看板：本地日期分组跨日重算且各组稳定排序', () => {
  const item = (id, dueDate, createdAt) => ({ ...original(id), todo: todo.makeTodo(createdAt, dueDate) });
  const items = [item('future2', '2026-10-23', 1), item('today2', '2026-10-21', 3),
    item('today1', '2026-10-21', 2), item('future1', '2026-10-22', 4), item('none', null, 6)];
  const view = todo.boardView(items, { today: '2026-10-21' });
  assert.deepEqual(view.groups.map((row) => row.id), ['today', 'tomorrow', 'date:2026-10-23', 'undated']);
  assert.deepEqual(view.groups[0].items.map((row) => row.inspirationId), ['today1', 'today2']);
  assert.deepEqual(view.groups[1].items.map((row) => row.inspirationId), ['future1']);
  assert.deepEqual(view.groups[2].items.map((row) => row.inspirationId), ['future2']);
  assert.deepEqual(todo.boardView(items, { today: '2026-10-22' }).groups.map((row) => row.id), ['overdue', 'today', 'tomorrow', 'undated']);
  const beforeMidnight = new Date(2026, 9, 21, 23, 59).getTime();
  assert.equal(todo.localDate(beforeMidnight), '2026-10-21');
  assert.equal(todo.dateAfter(1, beforeMidnight), '2026-10-22');
  assert.equal(todo.dateAfter(1, new Date(2026, 11, 31, 23).getTime()), '2027-01-01');
});

test('待办看板：逐日分组按日期排序，归档完成优先且同日按加入时间稳定排列', () => {
  const item = (id, dueDate, createdAt, extra = {}) => ({ ...original(id), todo: todo.makeTodo(createdAt, dueDate), ...extra });
  const done = (id, dueDate, completedAt) => item(id, dueDate, 1, { todo: { ...todo.makeTodo(1, dueDate), completedAt } });
  const items = [item('far', '2027-01-02', 1), item('same_z', '2026-10-26', 3),
    item('tomorrow', '2026-10-25', 8), item('same_first', '2026-10-26', 2),
    item('same_a', '2026-10-26', 3), item('next', '2026-10-27', 1), item('none', null, 7),
    item('today', '2026-10-24', 9), item('old', '2026-10-23', 4),
    item('archived_old', '2026-10-01', 5, { archivedAt: 10 }),
    done('done_old', '2026-10-01', 100), done('done_new', '2026-10-25', 200),
    { ...done('archived_done', null, 150), archivedAt: 20 }];
  const view = todo.boardView(items, { scope: 'all', today: '2026-10-24' });
  assert.deepEqual(view.groups.map(({ id, label }) => [id, label]), [
    ['overdue', '已逾期'], ['today', '今天'], ['tomorrow', '明天'],
    ['date:2026-10-26', '10月26日 周一'], ['date:2026-10-27', '10月27日 周二'],
    ['date:2027-01-02', '2027年1月2日 周六'], ['undated', '未安排'],
    ['archived', '已归档的待办'], ['done', '已办']
  ]);
  assert.deepEqual(view.counts, { all: 13, pending: 10, done: 3 });
  const groupIds = (view, id) => view.groups.find(row => row.id === id).items.map(row => row.inspirationId);
  assert.deepEqual(groupIds(view, 'date:2026-10-26'), ['same_first', 'same_a', 'same_z']);
  assert.deepEqual(groupIds(todo.boardView([...items].reverse(), { scope: 'all', today: '2026-10-24' }), 'date:2026-10-26'),
    ['same_first', 'same_a', 'same_z'], '相同加入时间不依赖快照顺序');
  assert.deepEqual(groupIds(view, 'archived'), ['archived_old']);
  assert.deepEqual(groupIds(view, 'done'), ['done_new', 'archived_done', 'done_old']);
  assert.deepEqual(todo.boardView(items, { scope: 'done', today: '2026-10-24' }).groups.map(group => group.id), ['done']);
  const searched = todo.boardView(items, { scope: 'pending', query: 'same_', today: '2026-10-24' });
  assert.deepEqual(searched.groups, [], '查询仍匹配内容和所属灵感，不使用任务ID');
  assert.deepEqual(searched.counts, view.counts);
  const snapshot = structuredClone(items);
  todo.boardView(items, { scope: 'all', today: '2026-10-25' });
  assert.deepEqual(items, snapshot, '重算不修改待办日期或来源');
});

test('待办看板：显式今天按日历推导明天，支持跨月跨年闰日并隐藏空组', () => {
  for (const [today, tomorrow, later, laterLabel] of [
    ['2026-10-31', '2026-11-01', '2026-11-02', '11月2日 周一'],
    ['2026-12-31', '2027-01-01', '2027-01-02', '2027年1月2日 周六'],
    ['2028-02-28', '2028-02-29', '2028-03-01', '3月1日 周三'],
    ['2028-02-29', '2028-03-01', '2028-03-02', '3月2日 周四']
  ]) {
    const items = [{ ...original('later'), todo: todo.makeTodo(1, later) },
      { ...original('tomorrow'), todo: todo.makeTodo(2, tomorrow) }];
    const view = todo.boardView(items, { today });
    assert.deepEqual(view.groups.map(({ id, label }) => [id, label]), [['tomorrow', '明天'], ['date:' + later, laterLabel]]);
    assert.deepEqual(todo.boardView(items, { today: tomorrow }).groups.map(row => row.id), ['today', 'tomorrow']);
    assert.deepEqual(todo.boardView(items, { today: later }).groups.map(row => row.id), ['overdue', 'today']);
  }
  assert.deepEqual(todo.boardView([], { today: '2026-10-24' }),
    { counts: { all: 0, pending: 0, done: 0 }, groups: [], matchCount: 0 });
});

test('待办领域：归档和合并来源只读，收起补充仍能独立完成', () => {
  const item = todo.updateTodo(supplemented(), { supplementId: 'route', action: 'add', now: 30 });
  for (const action of ['add', 'complete', 'reopen', 'date', 'remove', 'replace']) {
    assert.throws(() => todo.updateTodo({ ...item, archivedAt: 0 }, { action, now: 40 }), { code: 'INSPIRATION_ARCHIVED' });
    assert.throws(() => todo.updateTodo({ ...item, mergedInto: 'target' }, { action, now: 40 }), { code: 'ALREADY_MERGED' });
  }
  const folded = inspiration.foldIntoText(item, { supplementId: 'route', historyId: 'h1', now: 40 });
  const completed = todo.updateTodo(folded, { supplementId: 'route', action: 'complete', now: 50 });
  assert.equal(completed.supplements[0].todo.completedAt, 50);
  assert.throws(() => todo.updateTodo(item, { supplementId: 'missing', action: 'add', now: 50 }), { code: 'SUPPLEMENT_NOT_FOUND' });
});
