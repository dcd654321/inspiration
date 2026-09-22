'use strict';
// 格式化函数的单元测试。
// 阈值是产品决定，所以边界值全部断言——改阈值就会红，逼着人回头确认设计文档。

const test = require('node:test');
const assert = require('node:assert');

const { formatRelative, formatAbsolute, summarize, countLabel } = require('../miniprogram/core/format');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1758500000000;

function ago(delta) {
  return formatRelative(NOW - delta, NOW);
}

test('一分钟内显示「刚刚」', () => {
  assert.strictEqual(ago(0), '刚刚');
  assert.strictEqual(ago(59 * 1000), '刚刚');
});

test('一小时内按分钟计', () => {
  assert.strictEqual(ago(MINUTE), '1 分钟前');
  assert.strictEqual(ago(59 * MINUTE), '59 分钟前');
});

test('一天内按小时计', () => {
  assert.strictEqual(ago(HOUR), '1 小时前');
  assert.strictEqual(ago(23 * HOUR), '23 小时前');
});

test('24 到 48 小时显示「昨天」', () => {
  assert.strictEqual(ago(DAY), '昨天');
  assert.strictEqual(ago(2 * DAY - 1), '昨天');
});

test('两天到 30 天按天计', () => {
  assert.strictEqual(ago(2 * DAY), '2 天前');
  assert.strictEqual(ago(29 * DAY), '29 天前');
});

test('超过 30 天改显示绝对日期', () => {
  const out = ago(60 * DAY);
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/, '应退化为 YYYY-MM-DD，实际是 ' + out);
});

test('时间戳在未来时显示「刚刚」，不出现负数', () => {
  // 设备时间被调过时会走到这里，不能给用户看「-3 小时前」
  assert.strictEqual(formatRelative(NOW + 5 * HOUR, NOW), '刚刚');
});

test('非法输入返回空串，不抛错也不显示「NaN 分钟前」', () => {
  assert.strictEqual(formatRelative(0, NOW), '');
  assert.strictEqual(formatRelative(undefined, NOW), '');
  assert.strictEqual(formatRelative(NaN, NOW), '');
  assert.strictEqual(formatRelative('1758500000000', NOW), '');
  assert.strictEqual(formatRelative(NOW, undefined), '');
});

test('补零：日期部分始终是两位', () => {
  // 1 月 5 日这类日期不能输出成 2026-1-5
  const ts = new Date(2020, 0, 5, 12, 0, 0).getTime();
  const out = formatRelative(ts, ts + 400 * DAY);
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(out.indexOf('-0') !== -1, '月份或日期应补零，实际是 ' + out);
});

// ---------------------------------------------------------------- 绝对时间

test('绝对时间格式为 YYYY-MM-DD HH:mm，各段补零', () => {
  const ts = new Date(2020, 0, 5, 9, 7, 0).getTime();
  assert.strictEqual(formatAbsolute(ts), '2020-01-05 09:07');
});

test('绝对时间对非法输入返回空串', () => {
  assert.strictEqual(formatAbsolute(0), '');
  assert.strictEqual(formatAbsolute(undefined), '');
  assert.strictEqual(formatAbsolute(NaN), '');
});

// ---------------------------------------------------------------- 摘要

test('摘要取首行', () => {
  assert.strictEqual(summarize('第一行\n第二行'), '第一行');
  assert.strictEqual(summarize(' 前后有空格 \n下一行'), '前后有空格');
});

test('摘要超长时截断并加省略号', () => {
  const out = summarize('啊'.repeat(100), 10);
  assert.strictEqual(out, '啊'.repeat(10) + '…');
});

test('摘要没超长时不加省略号', () => {
  assert.strictEqual(summarize('很短', 10), '很短');
  assert.strictEqual(summarize('正好十个字啊啊啊啊啊', 10), '正好十个字啊啊啊啊啊');
});

test('摘要对非字符串输入返回空串', () => {
  assert.strictEqual(summarize(null), '');
  assert.strictEqual(summarize(undefined), '');
  assert.strictEqual(summarize(123), '');
});

// ---------------------------------------------------------------- 计数

test('计数为 0 时返回空串——「0 条补充」是噪音', () => {
  assert.strictEqual(countLabel(0, '条补充'), '');
  assert.strictEqual(countLabel(-1, '条补充'), '');
  assert.strictEqual(countLabel(3, '条补充'), '3 条补充');
  assert.strictEqual(countLabel(1, '张照片'), '1 张照片');
});
