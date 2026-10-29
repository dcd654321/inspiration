'use strict';
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(x);
const text = (x, max) => typeof x === 'string' && Boolean(x.trim()) && x.length <= max;
const time = (x) => Number.isSafeInteger(x) && x >= 0;
const unique = (rows) => new Set(rows.map((x) => x && x.id)).size === rows.length;
function validHistory(rows, field, max) {
  return Array.isArray(rows) && unique(rows) && rows.every((x) => x && id(x.id) && text(x[field], max) && time(x.replacedAt));
}
function validSources(rows) { return rows === undefined || Array.isArray(rows) && rows.length <= 20 && new Set(rows).size === rows.length && rows.every(id); }
function validTodo(value) {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['createdAt', 'completedAt', 'dueDate'].includes(key)) ||
      !time(value.createdAt) || value.completedAt !== null && !time(value.completedAt)) return false;
  if (value.dueDate == null) return true;
  if (typeof value.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)) return false;
  const [year, month, day] = value.dueDate.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function validRecord(item) {
  if (!item || !id(item.id) || !text(item.text, 2000) || !time(item.createdAt) || !time(item.updatedAt)) return false;
  if (!validHistory(item.textHistory || [], 'text', 2000) || !Array.isArray(item.supplements || []) || !Array.isArray(item.photos || [])) return false;
  if (item.stage !== undefined && !['seed', 'growing', 'ready'].includes(item.stage)) return false;
  if (item.source !== undefined && !['user', 'ai'].includes(item.source)) return false;
  if (item.templateId !== undefined && !['free', 'social', 'video', 'work', 'action'].includes(item.templateId)) return false;
  if (!validSources(item.summarySources)) return false;
  if (!validTodo(item.todo)) return false;
  if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 5 || new Set(item.tags).size !== item.tags.length || item.tags.some((x) => !text(x, 12) || x !== x.trim() || /[\r\n]/.test(x)))) return false;
  const supplements = item.supplements || [];
  if (!unique(supplements) || supplements.some((x) => !x || !id(x.id) || !text(x.content, x.source === 'ai' && (x.sourceIds || []).length >= 2 ? 2000 : 1000) ||
      !time(x.createdAt) || !['user', 'ai'].includes(x.source || 'user') || !validSources(x.sourceIds) || !validHistory(x.contentHistory || [], 'content', 2000) ||
      !validTodo(x.todo) || x.foldedAt != null && !time(x.foldedAt) || x.foldedAt && x.mergedInto)) return false;
  const byId = new Map(supplements.map((x) => [x.id, x]));
  for (const supplement of supplements) {
    const seen = new Set([supplement.id]); let target = supplement.mergedInto;
    while (target) { if (!id(target) || seen.has(target) || !byId.has(target)) return false; seen.add(target); target = byId.get(target).mergedInto; }
  }
  if (item.mergedInto != null && !id(item.mergedInto)) return false;
  if (Object.prototype.hasOwnProperty.call(item, 'archivedAt') && item.archivedAt !== null && !time(item.archivedAt)) return false;
  if (item.archivedAt != null && item.mergedInto) return false;
  return (item.photos || []).length <= 9 && unique(item.photos || []) && (item.photos || []).every((x) => x && id(x.id) && typeof x.fileId === 'string' && x.fileId.length <= 512 && time(x.createdAt));
}
module.exports = { validRecord };
