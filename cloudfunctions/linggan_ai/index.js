'use strict';
const cloud = require('wx-server-sdk');
const { getCallerIdentity } = require('./server/wx-identity');
const { createAiHandler, createCloudModel } = require('./server/ai-service');
const { createCloudAiQuota } = require('./server/ai-quota');
const contract = require('./core/ai-contract');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const enabled = process.env.LINGGAN_AI_ENABLED === 'true' && Boolean(process.env.LINGGAN_AI_MODEL);
let model;
if (enabled) {
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV, timeout: 50000 });
  model = createCloudModel({ app, modelName: process.env.LINGGAN_AI_MODEL });
}
const handler = createAiHandler({
  enabled, generate: model, contract,
  quota: createCloudAiQuota({ db: cloud.database(), dailyLimit: process.env.LINGGAN_AI_DAILY_LIMIT, minuteLimit: process.env.LINGGAN_AI_MINUTE_LIMIT }),
  async moderate(text, context) {
    // 任何分块的结果未知或不通过，整条结果都不展示。
    // 单块至多 600 个 Unicode 字符（UTF-8 至多 2400 字节），不切断代理对。
    const chars = Array.from(text);
    for (let offset = 0; offset < chars.length; offset += 600) {
      const result = await cloud.openapi({ appid: context.appid }).security.msgSecCheck({ content: chars.slice(offset, offset + 600).join(''), version: 2, scene: 1, openid: context.openid });
      if (!result || (result.errCode !== 0 && result.errcode !== 0) || !result.result || result.result.suggest !== 'pass') return false;
    }
    return true;
  }
});
exports.main = (event) => {
  const caller = getCallerIdentity(cloud.getWXContext());
  return handler(caller || { accountKey: '' }, event);
};
