'use strict';
// 时间与计数的展示格式化。纯函数，零 wx 依赖。
//
// 放在 core/ 而不是页面里，是因为「多久算『刚刚』」「几天之后改显示日期」是
// **产品决定**，不是渲染细节——列表、详情、历史版本三处都要用它，散在页面里
// 迟早会出现三套不同的阈值。
//
// **按经过时间分桶，不做日历日运算。** 日历日要用本地时区算当天零点，结果依赖
// 运行环境的时区，测试没法稳定断言。经过时间桶对同一组 (ts, now) 永远给同一个结果。
// 代价是「昨天」按 24—48 小时计，与严格日历日可能差几小时——这个精度对「上次什么时候动的」
// 这个用途足够了。

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * 绝对时间，`YYYY-MM-DD HH:mm`。
 *
 * 用在原文历史上：那里要把几个版本放在一起比，相对时间（「3 天前」）看不出先后，
 * 也看不出是同一天改的还是隔了很久。
 *
 * 用本地时区——**跨时区运行可能差几小时**，这是刻意的取舍，见文件头。
 */
function formatAbsolute(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * 把时间戳转成相对描述。
 *
 * @param {number} ts  要描述的时间戳
 * @param {number} now 当前时间，由调用方注入
 *
 * 超过 30 天则改显示绝对日期。绝对值那一段用本地时区，因此**跨时区运行可能差一天**——
 * 这是刻意的取舍，见文件头。
 */
function formatRelative(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '';
  if (typeof now !== 'number' || !Number.isFinite(now)) return '';

  const delta = now - ts;
  if (delta < 0) return '刚刚';            // 设备时间被调过，不显示「-3 小时前」这种荒唐值
  if (delta < MINUTE) return '刚刚';
  if (delta < HOUR) return Math.floor(delta / MINUTE) + ' 分钟前';
  if (delta < DAY) return Math.floor(delta / HOUR) + ' 小时前';
  if (delta < 2 * DAY) return '昨天';
  if (delta < 30 * DAY) return Math.floor(delta / DAY) + ' 天前';

  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 长文摘要：取首行，超长截断加省略号。列表项用它。 */
function summarize(text, maxLength) {
  if (typeof text !== 'string') return '';
  const limit = typeof maxLength === 'number' ? maxLength : 60;
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= limit) return firstLine;
  return firstLine.slice(0, limit) + '…';
}

/** 计数描述。为 0 时返回空串——界面上「0 条补充」是噪音，不该出现。 */
function countLabel(count, unit) {
  if (typeof count !== 'number' || count <= 0) return '';
  return count + ' ' + unit;
}

module.exports = { formatRelative, formatAbsolute, summarize, countLabel };
