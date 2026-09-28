'use strict';
const crypto = require('node:crypto');
const PROJECT_APPID = 'wxed8fdc5d559d973d';

// Only call with cloud.getWXContext(), never with event/payload.
function getCallerIdentity(context) {
  const value = context || {};
  const shared = (value.FROM_APPID !== undefined && value.FROM_APPID !== '') ||
    (value.FROM_OPENID !== undefined && value.FROM_OPENID !== '');
  const appid = shared ? value.FROM_APPID : value.APPID;
  const openid = shared ? value.FROM_OPENID : value.OPENID;
  if (appid !== PROJECT_APPID || typeof openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(openid)) return null;
  return { appid, openid, accountKey: crypto.createHash('sha256').update(appid + '|' + openid).digest('hex').slice(0, 32) };
}

module.exports = { PROJECT_APPID, getCallerIdentity };
