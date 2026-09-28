'use strict';
const EVENTS = ['record_saved', 'supplement_saved', 'output_copied', 'output_saved', 'search_opened', 'review_opened', 'save_failed', 'backup_pending'];
function createUsageMetrics({ storage, cacheScope, now = Date.now }) {
  if (!/^[a-f0-9]{32}$/.test(cacheScope)) throw Error('INVALID_USAGE_SCOPE');
  const key = 'linggan:v2:' + cacheScope + ':usage';
  const today = () => new Date(now() + 28800000).toISOString().slice(0, 10);
  function read() {
    const value = storage.get(key);
    const state = { enabled: Boolean(value && value.enabled === true), days: {} };
    const minDay = new Date(now() - 29 * 86400000 + 28800000).toISOString().slice(0, 10);
    if (state.enabled && value.days && typeof value.days === 'object') for (const [day, counters] of Object.entries(value.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < minDay || day > today() || !counters) continue;
      state.days[day] = {};
      for (const event of EVENTS) if (Number.isSafeInteger(counters[event]) && counters[event] > 0) state.days[day][event] = Math.min(100000, counters[event]);
    }
    return state;
  }
  function setEnabled(enabled) { const previous = read(); storage.set(key, { enabled: enabled === true, days: enabled && previous.enabled ? previous.days : {} }); }
  function track(event) {
    try {
      if (!EVENTS.includes(event)) return false;
      const state = read(); if (!state.enabled) return false;
      const day = today(); state.days[day] = state.days[day] || {};
      state.days[day][event] = Math.min(100000, (state.days[day][event] || 0) + 1);
      storage.set(key, state); return true;
    } catch (err) { return false; }
  }
  return { read, setEnabled, track, report: () => JSON.stringify({ schema: 1, days: read().days }, null, 2) };
}
module.exports = { createUsageMetrics, EVENTS };
