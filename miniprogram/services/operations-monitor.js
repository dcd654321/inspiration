'use strict';

const { getCloudClient } = require('./cloud-client');
const TYPES = new Set(['app_start', 'error', 'unhandled_rejection', 'performance', 'output_copied', 'output_exported']);
const codeOf = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'UNKNOWN';
function monitorSafely(monitor, method, ...args) {
  try {
    const result = monitor && typeof monitor[method] === 'function' ? monitor[method](...args) : undefined;
    if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
    return result;
  } catch (_) { return undefined; }
}
function routeOf() {
  try { const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; return pages.length ? pages[pages.length - 1].route : ''; }
  catch (_) { return ''; }
}

function createOperationsMonitor(options = {}) {
  const now = options.now || Date.now;
  const schedule = options.setInterval || setInterval;
  const cancel = options.clearInterval || clearInterval;
  const getRoute = options.getRoute || routeOf;
  const envVersion = ['develop', 'trial', 'release'].includes(options.envVersion) ? options.envVersion : 'develop';
  const getClient = options.getClient || getCloudClient;
  const newId = options.newId || (() => 'lg_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 14));
  let generation = 0, session = null, boundScope = '';

  function valid(owner, ending) {
    return owner && owner.generation === generation && owner.scope === boundScope && owner.scope &&
      (ending && owner.closed || session === owner && !owner.closed && owner.isCurrent());
  }
  function send(owner, data, ending = false, onAccepted) {
    return (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!valid(owner, ending)) return false;
        try {
          const client = await getClient();
          if (!valid(owner, ending)) return false;
          const sentAt = now();
          const response = await client.callFunction({ name: 'monitorApi', data });
          const result = response && response.result;
          if (!valid(owner, ending)) return false;
          if (result && (result.success === true || result.ok === true)) {
            if (onAccepted) onAccepted(result.data, sentAt);
            return true;
          }
        } catch (_) { /* 单次内存重试；不记录监控请求的异常或原文。 */ }
      }
      return false;
    })();
  }
  function usage(owner, eventType, ending = false) {
    const reportedAt = owner.closed ? owner.endedAt : now();
    const allowEnding = ending || eventType === 'start';
    const dispatch = async () => {
      if (!valid(owner, allowEnding)) return false;
      if (!owner.startConfirmed) {
        const accepted = await send(owner, { action: 'trackUsage', eventType: 'start', sessionId: owner.id,
          accountGeneration: owner.accountGeneration, elapsedMs: 0 }, allowEnding, (data, sentAt) => {
          const aligned = data && Number.isSafeInteger(data.startedAtMs) && data.startedAtMs >= 0 &&
            Number.isSafeInteger(data.observedAtMs) && data.observedAtMs >= data.startedAtMs &&
            data.observedAtMs - data.startedAtMs <= 36 * 3600000 &&
            Number.isSafeInteger(data.elapsedMs) && data.elapsedMs >= 0 && data.elapsedMs <= 36 * 3600000;
          owner.startedAt = sentAt - (aligned ? data.observedAtMs - data.startedAtMs : 0);
          owner.startConfirmed = true;
        });
        if (!accepted) return false;
      }
      if (eventType === 'start') return true;
      if (!valid(owner, ending)) return false;
      return send(owner, { action: 'trackUsage', eventType, sessionId: owner.id, accountGeneration: owner.accountGeneration,
        elapsedMs: Math.max(0, Math.floor(reportedAt - owner.startedAt)) }, ending);
    };
    owner.usageWork = owner.usageWork ? owner.usageWork.then(dispatch) : dispatch();
    return owner.usageWork;
  }
  function event(type, input = {}, eventId) {
    const owner = session;
    if (!TYPES.has(type) || !owner || owner.closed || owner.generation !== generation || owner.scope && !valid(owner, false)) return Promise.resolve(false);
    const payload = { sessionId: owner.id, envVersion };
    const route = input.route === undefined ? getRoute() : input.route;
    if (typeof route === 'string' && /^pages\/[a-z0-9-]+\/index$/.test(route)) payload.route = route;
    if (typeof input.functionName === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(input.functionName)) payload.functionName = input.functionName;
    if (input.code !== undefined) payload.code = codeOf(input.code);
    if (Number.isFinite(input.durationMs)) payload.durationMs = Math.max(0, Math.min(3600000, Math.floor(input.durationMs)));
    const data = { action: 'ingestEvent', type, eventId: eventId || owner.id + ':' + (++owner.sequence), payload };
    if (!owner.scope) {
      if (owner.pendingEvents.length < 8) owner.pendingEvents.push(data);
      return Promise.resolve(false);
    }
    return send(owner, { ...data, accountGeneration: owner.accountGeneration });
  }
  function start() {
    if (session && session.timer) cancel(session.timer);
    generation += 1;
    session = { id: newId(), generation, startedAt: now(), startConfirmed: false, scope: '', isCurrent: () => false, sequence: 0, closed: false, pendingEvents: [] };
    const owner = session;
    owner.timer = schedule(() => { if (valid(owner, false)) void usage(owner, 'heartbeat'); }, 60000);
    if (owner.timer && typeof owner.timer.unref === 'function') owner.timer.unref();
    return owner.id;
  }
  function bindAccount(scope, accountGeneration, isCurrent = () => true) {
    if (!session || session.closed || !/^[a-f0-9]{32}$/.test(scope || '') || !Number.isSafeInteger(accountGeneration) || accountGeneration < 1 || !isCurrent()) return false;
    if (session.scope && (session.scope !== scope || session.accountGeneration !== accountGeneration)) start();
    const owner = session, first = !owner.scope;
    owner.scope = scope; owner.accountGeneration = accountGeneration; owner.isCurrent = isCurrent; boundScope = scope;
    if (first) {
      owner.startedAt = now();
      void usage(owner, 'start'); void event('app_start', {}, owner.id + ':start');
      for (const data of owner.pendingEvents) void send(owner, { ...data, accountGeneration });
      owner.pendingEvents = [];
    }
    return true;
  }
  function end() {
    const owner = session;
    if (!owner) return Promise.resolve(false);
    if (owner.timer) cancel(owner.timer);
    const ready = valid(owner, false);
    owner.closed = true; owner.endedAt = now(); session = null;
    return ready ? usage(owner, 'end', true) : Promise.resolve(false);
  }
  function requestFinished(functionName, durationMs, code) {
    if (functionName === 'monitorApi') return;
    void event('performance', { functionName, durationMs, ...(code ? { code } : {}) });
    if (code) void event('error', { functionName, code });
  }
  return { start, bindAccount, end, event, requestFinished,
    error: (code, type = 'error') => event(type, { code: codeOf(code) }) };
}

module.exports = { createOperationsMonitor, monitorSafely };
